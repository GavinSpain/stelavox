-- Migration 109 — V1.x-B.2.1: agent_jobs completion trigger v2 (notify only).
--
-- Source: stelavox_v1x_b_2_build_checklist_v1_0.md §3.2.1 M-109
--         + Director Architecture v2.0 §8 (universal scheduler).
--
-- A lightweight AFTER UPDATE trigger on agent_jobs that fires when the
-- queue_status reaches a terminal value. The trigger emits a pg_notify
-- on channel 'scheduler_completion' so the dispatcher (lib/scheduler/listener.ts)
-- can react in <100ms instead of waiting for the next pg_cron tick.
--
-- The two paths (LISTEN reaction + pg_cron tick) are idempotent — if
-- both fire concurrently, the FOR UPDATE SKIP LOCKED claim in the
-- dispatcher ensures no double-dispatch.
--
-- The B.2.3 push-model upgrade (M-120) extends this trigger function to
-- ALSO insert the next director_iteration row when a stage's last
-- workflow step completes. B.2.1 ships notify-only.
--
-- The trigger fires on queue_status (not status); business outcome
-- (status) and queue lifecycle (queue_status) are tracked separately
-- per M-106.

-- ---------------------------------------------------------------------------
-- Notification function
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION agent_jobs_notify_completion()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_payload JSONB;
BEGIN
  -- Only notify on transition INTO a terminal queue_status. Skip if the
  -- new value is already terminal but the old value was also terminal
  -- (idempotent UPDATE).
  IF NEW.queue_status NOT IN ('completed','failed','crashed','cancelled','skipped') THEN
    RETURN NEW;
  END IF;

  IF OLD.queue_status = NEW.queue_status THEN
    RETURN NEW;
  END IF;

  v_payload := jsonb_build_object(
    'agent_job_id',     NEW.id,
    'queue_status',     NEW.queue_status,
    'operation_type',   NEW.operation_type,
    'organisation_id',  NEW.organisation_id,
    'document_id',      NEW.document_id,
    'director_turn_id', NEW.director_turn_id,
    'iteration_number', NEW.iteration_number,
    'failure_class',    NEW.failure_class,
    'completed_at',     extract(epoch from NEW.completed_at)
  );

  -- pg_notify payload is capped at 8000 bytes; the JSONB above is well
  -- under that limit even with longest UUIDs + timestamps.
  PERFORM pg_notify('scheduler_completion', v_payload::TEXT);

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION agent_jobs_notify_completion() FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- Trigger
-- ---------------------------------------------------------------------------

DROP TRIGGER IF EXISTS trg_agent_jobs_notify_completion ON agent_jobs;

CREATE TRIGGER trg_agent_jobs_notify_completion
  AFTER UPDATE OF queue_status ON agent_jobs
  FOR EACH ROW
  WHEN (NEW.queue_status IN ('completed','failed','crashed','cancelled','skipped'))
  EXECUTE FUNCTION agent_jobs_notify_completion();

-- ---------------------------------------------------------------------------
-- Director-turn iteration_count + totals rollup helper
-- ---------------------------------------------------------------------------
-- When a director_iteration completes, increment the parent turn's
-- iteration_count and roll up token usage. When the LAST iteration of a
-- turn completes (model returned a terminal response, no next iteration
-- queued), the lib-side runner sets director_turns.status='completed'.
-- This trigger only owns the rolling counters.

CREATE OR REPLACE FUNCTION director_turns_rollup_iteration()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.operation_type <> 'director_iteration' THEN
    RETURN NEW;
  END IF;

  IF NEW.director_turn_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.queue_status NOT IN ('completed','failed','crashed','cancelled') THEN
    RETURN NEW;
  END IF;

  IF OLD.queue_status = NEW.queue_status THEN
    RETURN NEW;
  END IF;

  UPDATE director_turns
     SET iteration_count = iteration_count + 1,
         total_input_tokens  = total_input_tokens
                              + COALESCE(NEW.actual_input_tokens, 0),
         total_output_tokens = total_output_tokens
                              + COALESCE(NEW.actual_output_tokens, 0),
         total_cost_credits  = total_cost_credits
                              + COALESCE(NEW.cost_credits, 0)
   WHERE id = NEW.director_turn_id;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION director_turns_rollup_iteration() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_director_turns_rollup_iteration ON agent_jobs;

CREATE TRIGGER trg_director_turns_rollup_iteration
  AFTER UPDATE OF queue_status ON agent_jobs
  FOR EACH ROW
  WHEN (NEW.operation_type = 'director_iteration'
        AND NEW.director_turn_id IS NOT NULL
        AND NEW.queue_status IN ('completed','failed','crashed','cancelled'))
  EXECUTE FUNCTION director_turns_rollup_iteration();
