-- Migration M-215: increment_usage_record — atomic UPSERT for usage_records
--
-- Phase 9.1 / DR-100 (audit F-133 + F-134). The TypeScript
-- updateUsageRecords helper used a SELECT-then-INSERT-or-UPDATE pattern:
-- two concurrent jobs completing for the same (org, month, operation,
-- provider) could both read "no row", both INSERT, and the second INSERT
-- would be rejected by the M-008 UNIQUE constraint — with the error
-- silently swallowed by the caller (no { error } destructure). Result:
-- lost token rows in the billing/reconciliation archive.
--
-- Plain PostgREST upsert cannot express the additive update
-- (tokens_input = tokens_input + N), so the fix is a single SQL function
-- with INSERT ... ON CONFLICT ... DO UPDATE doing the addition
-- atomically. The TS helper now calls this RPC and CHECKS the error,
-- writing an audit_log entry on failure (no more silent loss).
--
-- Note: usage_records is the historical/reconciliation archive. Budget
-- enforcement runs on organisations.token_usage_credits via the
-- accumulate_cost_credits_into_org trigger (M-135) and is unaffected.

CREATE OR REPLACE FUNCTION increment_usage_record(
  p_organisation_id UUID,
  p_year_month TEXT,
  p_operation_type TEXT,
  p_provider TEXT,
  p_tokens_input BIGINT,
  p_tokens_output BIGINT,
  p_tokens_cache_write BIGINT,
  p_tokens_cache_read BIGINT
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO usage_records (
    organisation_id,
    year_month,
    operation_type,
    provider,
    tokens_input,
    tokens_output,
    tokens_cache_write,
    tokens_cache_read
  ) VALUES (
    p_organisation_id,
    p_year_month,
    p_operation_type,
    p_provider,
    p_tokens_input,
    p_tokens_output,
    p_tokens_cache_write,
    p_tokens_cache_read
  )
  ON CONFLICT (organisation_id, year_month, operation_type, provider)
  DO UPDATE SET
    tokens_input       = usage_records.tokens_input       + EXCLUDED.tokens_input,
    tokens_output      = usage_records.tokens_output      + EXCLUDED.tokens_output,
    tokens_cache_write = usage_records.tokens_cache_write + EXCLUDED.tokens_cache_write,
    tokens_cache_read  = usage_records.tokens_cache_read  + EXCLUDED.tokens_cache_read,
    updated_at         = NOW();
END;
$$;

-- The only writer is the service-role client (agent runner post-completion
-- paths). No authenticated grant — usage accounting is never client-driven.
REVOKE EXECUTE ON FUNCTION increment_usage_record(UUID, TEXT, TEXT, TEXT, BIGINT, BIGINT, BIGINT, BIGINT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION increment_usage_record(UUID, TEXT, TEXT, TEXT, BIGINT, BIGINT, BIGINT, BIGINT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION increment_usage_record(UUID, TEXT, TEXT, TEXT, BIGINT, BIGINT, BIGINT, BIGINT) TO service_role;
