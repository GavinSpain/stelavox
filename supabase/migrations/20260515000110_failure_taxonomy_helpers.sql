-- Migration 110 — V1.x-B.2.1: failure taxonomy SQL helper.
--
-- Source: stelavox_v1x_b_2_build_checklist_v1_0.md §3.2.1 M-110
--         + Director Architecture v2.0 §10 (5-class failure taxonomy).
--
-- A pure SECURITY DEFINER function that classifies a failure into the
-- five-class taxonomy. The TS wrapper at lib/scheduler/failure-classifier.ts
-- calls this RPC; alternatively the wrapper can mirror the same logic
-- in TS for unit-test independence (the TS path is the primary; the RPC
-- exists so the dispatcher's recovery sweep can classify directly from
-- SQL without a round-trip).
--
-- Five classes (V2 §10):
--   A — TRANSIENT: HTTP 429, 5xx, network reset, body-parse failure.
--       Auto-retry up to agent.failure_class_a_max_retries (default 3).
--   B — INTERRUPTED: process crash mid-call (recovery sweep finds
--       expired heartbeat), Stop request, manual cancellation.
--       Resumable; surface to user.
--   C — CAPACITY: Anthropic concurrent-connections limit, our own bucket
--       exhaustion that exceeded requeue patience. Throttled; no user
--       surface unless wait exceeds threshold.
--   D — VALIDATION: tool input invalid, malformed JSON, canary leak,
--       injection-scanner trip. Fail hard; surface to user.
--   E — HARD SYSTEM: missing config, broken DB constraint, missing
--       migration, missing agent profile. Fail hard; operator action.
--
-- The classifier is conservative: when the inputs don't clearly map to
-- A/C/D/E, it returns 'B' (interrupted/resumable) — the safest default
-- because it surfaces to the user as recoverable.

CREATE OR REPLACE FUNCTION classify_failure(
  p_operation_type TEXT,
  p_error_code     TEXT,
  p_http_status    INTEGER,
  p_retry_count    INTEGER
) RETURNS CHAR(1)
LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Class C override — Anthropic 429 with concurrent-limit signature is
  -- capacity (C), NOT transient (A). Must be evaluated BEFORE the
  -- generic HTTP-status A check below, otherwise the C override is
  -- unreachable. Mirrors the TS classifier in lib/scheduler/failure-classifier.ts
  -- which has this override inside its CLASS_A_HTTP branch.
  IF p_http_status = 429 AND p_error_code = 'anthropic_concurrent_limit' THEN
    RETURN 'C';
  END IF;

  -- Class A — transient (auto-retry candidate)
  IF p_http_status IN (408, 429, 502, 503, 504) THEN
    RETURN 'A';
  END IF;

  IF p_error_code IN (
    'network_reset',
    'network_timeout',
    'body_parse_failure',
    'connection_reset',
    'econnreset',
    'etimedout',
    'eai_again'
  ) THEN
    RETURN 'A';
  END IF;

  -- Class B — interrupted (resumable)
  IF p_error_code IN (
    'stop_requested',
    'cancelled_by_user',
    'process_crash',
    'recovery_sweep_reclaim',
    'heartbeat_expired',
    'client_disconnect'
  ) THEN
    RETURN 'B';
  END IF;

  -- Class C — capacity (throttled)

  IF p_error_code IN (
    'bucket_exhausted',
    'capacity_unavailable',
    'reservation_expired',
    'requeue_patience_exhausted'
  ) THEN
    RETURN 'C';
  END IF;

  -- Class D — validation (fail hard, user-surfaced)
  IF p_error_code IN (
    'tool_input_invalid',
    'output_schema_invalid',
    'malformed_json',
    'canary_leak',
    'canary_leak_detected',
    'injection_blocked',
    'h08_invariant_violation',
    'tool_result_size_exceeded',
    'max_iterations_reached',
    'model_output_truncated'
  ) THEN
    RETURN 'D';
  END IF;

  -- Class E — hard system (operator action)
  IF p_error_code IN (
    'missing_config',
    'missing_migration',
    'missing_agent_profile',
    'agent_profile_not_found',
    'job_missing_profile_or_node',
    'broken_db_constraint',
    'configuration_error'
  ) THEN
    RETURN 'E';
  END IF;

  -- HTTP 5xx that didn't match the explicit list above → A by default.
  IF p_http_status >= 500 AND p_http_status < 600 THEN
    RETURN 'A';
  END IF;

  -- HTTP 4xx that didn't match the explicit list above → D by default
  -- (validation: caller did something wrong, not retryable).
  IF p_http_status >= 400 AND p_http_status < 500 THEN
    RETURN 'D';
  END IF;

  -- Conservative default: B (interrupted, resumable, user-visible).
  RETURN 'B';
END;
$$;

REVOKE ALL ON FUNCTION classify_failure(TEXT, TEXT, INTEGER, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION classify_failure(TEXT, TEXT, INTEGER, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION classify_failure(TEXT, TEXT, INTEGER, INTEGER) TO service_role;
