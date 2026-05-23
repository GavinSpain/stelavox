-- M-165 — surface iteration crashes in the conversation thread.
--
-- Background. The V1.x-B.2 recovery sweep (M-107) detects iterations
-- whose runner has died (heartbeat stale > 60s) and marks them
-- queue_status='crashed'. The SchedulerPanel sees this; the
-- conversation thread does NOT — neither a system event nor a
-- conversation_message is emitted, so the author sees their question
-- in the thread, the start of the Director's response, and then…
-- silence. There's no indication anything went wrong.
--
-- Discovered 2026-05-17 during continued testing — a "review the beats
-- in this scene" question crashed mid-preparation (4 read-tool turns
-- completed; the runner died before composing the answer). The author
-- only learned about the failure from the SchedulerPanel.
--
-- This migration extends the sweep to:
--   1. Insert a role='system' conversation_message of
--      event_type='iteration_crashed' for each crashed iteration's
--      conversation (looked up via its director_turn).
--   2. Mark the parent director_turn status='failed' + completed_at=NOW()
--      so the turn doesn't sit at 'in_progress' forever.
--
-- The conversation thread already renders system events (stage_completed,
-- brief_completed, stage_trigger_fired) — adding iteration_crashed slots
-- in naturally. No client-side changes required for visibility; a future
-- Phase 8 polish step can mount a richer FailureBanner with a Resume
-- affordance (Class B failures save iteration_state and support resume
-- per the V1.x-F design).

CREATE OR REPLACE FUNCTION scheduler_sweep_interrupted_iterations(
  p_stale_threshold_seconds INTEGER DEFAULT 60
)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_swept INTEGER;
  v_now TIMESTAMPTZ := NOW();
  v_row RECORD;
  v_conversation_id UUID;
  v_next_sequence INTEGER;
BEGIN
  -- Step 1: identify crash candidates BEFORE mutating, so we can use
  -- their director_turn_id to look up the conversation surface.
  -- We re-mutate inside the loop body to keep the sweep idempotent
  -- under contention (concurrent sweep ticks would just no-op the
  -- second-mover).
  v_swept := 0;
  FOR v_row IN
    SELECT id, director_turn_id, error_message
    FROM agent_jobs
    WHERE queue_status IN ('dispatched','running')
      AND last_heartbeat_at IS NOT NULL
      AND last_heartbeat_at < v_now - (p_stale_threshold_seconds || ' seconds')::INTERVAL
      AND operation_type = 'director_iteration'
    FOR UPDATE SKIP LOCKED
  LOOP
    -- Mark crashed.
    UPDATE agent_jobs
    SET queue_status  = 'crashed',
        status        = 'failed',
        failure_class = 'B',
        crashed_at    = v_now,
        error_message = format('heartbeat stale (>%s seconds)', p_stale_threshold_seconds)
    WHERE id = v_row.id;

    -- Mark parent turn failed if not already terminal.
    IF v_row.director_turn_id IS NOT NULL THEN
      UPDATE director_turns
      SET status       = 'failed',
          completed_at = v_now
      WHERE id = v_row.director_turn_id
        AND status = 'in_progress';

      -- Look up the conversation surface for this turn.
      SELECT conversation_id INTO v_conversation_id
      FROM director_turns
      WHERE id = v_row.director_turn_id;

      IF v_conversation_id IS NOT NULL THEN
        SELECT COALESCE(MAX(sequence), 0) + 1
        INTO v_next_sequence
        FROM conversation_messages
        WHERE conversation_id = v_conversation_id;

        -- Emit the iteration_crashed system event. Use language that
        -- tells the author what happened + what to do, without surfacing
        -- raw infra detail like "heartbeat".
        INSERT INTO conversation_messages (
          conversation_id, role, content, sequence, event_type, event_payload, cause
        ) VALUES (
          v_conversation_id,
          'system',
          'Director was interrupted before it could finish responding. The conversation is paused. Send another message to continue, or open the Scheduler to cancel any leftover jobs.',
          v_next_sequence,
          'failure_class_b',
          jsonb_build_object(
            'agent_job_id', v_row.id,
            'director_turn_id', v_row.director_turn_id,
            'failure_class', 'B',
            'reason', format('heartbeat stale (>%s seconds)', p_stale_threshold_seconds)
          ),
          'recovery_sweep'
        );
      END IF;
    END IF;

    v_swept := v_swept + 1;
  END LOOP;

  -- Step 2: catch the pre-V1.x-B.2 path too — V1.x-B.1.1 dispatch path
  -- doesn't always populate director_turn_id (some workflow_step
  -- agent_jobs). For those, just mark crashed without a conversation
  -- event. This branch matches the old behaviour for non-Director rows.
  UPDATE agent_jobs
  SET queue_status   = 'crashed',
      status         = 'failed',
      failure_class  = 'B',
      crashed_at     = v_now,
      error_message  = format('heartbeat stale (>%s seconds)', p_stale_threshold_seconds)
  WHERE queue_status IN ('dispatched','running')
    AND last_heartbeat_at IS NOT NULL
    AND last_heartbeat_at < v_now - (p_stale_threshold_seconds || ' seconds')::INTERVAL
    AND (operation_type != 'director_iteration' OR director_turn_id IS NULL);

  GET DIAGNOSTICS v_swept = ROW_COUNT;
  RETURN v_swept;
END;
$$;

REVOKE ALL ON FUNCTION scheduler_sweep_interrupted_iterations(INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION scheduler_sweep_interrupted_iterations(INTEGER) TO service_role;

-- Backfill: emit the conversation event for the existing crashed
-- iteration the user just hit (c7e8b872) so they can verify the fix
-- without having to trigger another crash. Bounded to crashed rows
-- in the last hour whose parent turn isn't yet 'failed' AND whose
-- conversation has no iteration_crashed event yet.
DO $$
DECLARE
  v_row RECORD;
  v_conversation_id UUID;
  v_next_sequence INTEGER;
BEGIN
  FOR v_row IN
    SELECT aj.id, aj.director_turn_id, aj.error_message
    FROM agent_jobs aj
    WHERE aj.queue_status = 'crashed'
      AND aj.operation_type = 'director_iteration'
      AND aj.crashed_at > NOW() - INTERVAL '1 hour'
      AND aj.director_turn_id IS NOT NULL
  LOOP
    -- Skip if parent turn already terminal
    UPDATE director_turns
    SET status       = 'failed',
        completed_at = COALESCE(completed_at, NOW())
    WHERE id = v_row.director_turn_id
      AND status = 'in_progress';

    SELECT conversation_id INTO v_conversation_id
    FROM director_turns
    WHERE id = v_row.director_turn_id;

    IF v_conversation_id IS NOT NULL THEN
      -- Skip if we've already emitted an iteration_crashed for this row
      IF NOT EXISTS (
        SELECT 1 FROM conversation_messages
        WHERE conversation_id = v_conversation_id
          AND event_type = 'failure_class_b'
          AND (event_payload->>'agent_job_id')::UUID = v_row.id
      ) THEN
        SELECT COALESCE(MAX(sequence), 0) + 1
        INTO v_next_sequence
        FROM conversation_messages
        WHERE conversation_id = v_conversation_id;

        INSERT INTO conversation_messages (
          conversation_id, role, content, sequence, event_type, event_payload, cause
        ) VALUES (
          v_conversation_id,
          'system',
          'Director was interrupted before it could finish responding. The conversation is paused. Send another message to continue, or open the Scheduler to cancel any leftover jobs.',
          v_next_sequence,
          'failure_class_b',
          jsonb_build_object(
            'agent_job_id', v_row.id,
            'director_turn_id', v_row.director_turn_id,
            'failure_class', 'B',
            'reason', COALESCE(v_row.error_message, 'iteration crashed')
          ),
          'recovery_sweep_backfill'
        );
      END IF;
    END IF;
  END LOOP;
END $$;
