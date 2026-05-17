-- M-166 — orphan-turn sweep + conversation_locked guard relaxation.
--
-- Background. The conversation_locked check in /api/director/message
-- (POST) rejects new messages if a director_turn for the conversation
-- is still status='in_progress'. M-165 handles the case where the
-- LATEST iteration crashes — that path now marks the parent turn
-- status='failed'. But there's a third failure mode it doesn't catch:
--
--   The latest iteration completes cleanly, yields turn_complete=false
--   + next_iteration_job_id for the next iteration, but the SSE
--   connection severs (user closes tab, route timeout, etc.) before
--   the next iteration is dispatched. Result:
--     - All iterations terminal (queue_status='completed')
--     - Turn stays status='in_progress' forever
--     - No crashed iteration → M-165 sweep ignores it
--     - User is locked out of the conversation
--
-- Discovered 2026-05-17 during continued testing — the Stage 2
-- "Burning Dark" turn from morning testing had stalled this way and
-- blocked all new messages on the same conversation hours later.
--
-- Fix: extend the recovery sweep to also catch this orphan pattern:
--   - director_turns.status = 'in_progress'
--   - All director_iteration agent_jobs for this turn are terminal
--     (queue_status IN ('completed','failed','cancelled','crashed'))
--   - The latest iteration finished >5 minutes ago (gives the SSE
--     route handler plenty of time to either dispatch the next
--     iteration or write the terminal turn status itself)
--
-- Orphaned turns get status='failed' + a system event in the
-- conversation thread explaining the conversation can be continued.
-- Same event_type='failure_class_b' as the heartbeat-stale path —
-- this is functionally the same outcome from the user's perspective:
-- the Director got interrupted and won't continue.
--
-- The 5-minute threshold is conservative. A fast Director turn
-- (single iteration, Haiku, no tools) can chain a follow-up iteration
-- within seconds; a slow one with extended_thinking + 30 tool calls
-- might pause briefly between iterations. 5 minutes is well past
-- both ends of that range.

CREATE OR REPLACE FUNCTION scheduler_sweep_interrupted_iterations(
  p_stale_threshold_seconds INTEGER DEFAULT 60
)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_swept INTEGER := 0;
  v_now TIMESTAMPTZ := NOW();
  v_row RECORD;
  v_conversation_id UUID;
  v_next_sequence INTEGER;
BEGIN
  -- Step 1 — original heartbeat-stale sweep (Director iterations with
  -- a director_turn_id). Mark crashed + parent turn failed + emit
  -- conversation event. (Carried forward from M-165.)
  FOR v_row IN
    SELECT id, director_turn_id, error_message
    FROM agent_jobs
    WHERE queue_status IN ('dispatched','running')
      AND last_heartbeat_at IS NOT NULL
      AND last_heartbeat_at < v_now - (p_stale_threshold_seconds || ' seconds')::INTERVAL
      AND operation_type = 'director_iteration'
    FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE agent_jobs
    SET queue_status  = 'crashed',
        status        = 'failed',
        failure_class = 'B',
        crashed_at    = v_now,
        error_message = format('heartbeat stale (>%s seconds)', p_stale_threshold_seconds)
    WHERE id = v_row.id;

    IF v_row.director_turn_id IS NOT NULL THEN
      UPDATE director_turns
      SET status       = 'failed',
          completed_at = v_now
      WHERE id = v_row.director_turn_id
        AND status = 'in_progress';

      SELECT conversation_id INTO v_conversation_id
      FROM director_turns
      WHERE id = v_row.director_turn_id;

      IF v_conversation_id IS NOT NULL THEN
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
            'reason', format('heartbeat stale (>%s seconds)', p_stale_threshold_seconds)
          ),
          'recovery_sweep'
        );
      END IF;
    END IF;

    v_swept := v_swept + 1;
  END LOOP;

  -- Step 2 — NEW M-166 — orphan-turn sweep. Catches director_turns
  -- stuck at status='in_progress' whose iterations are ALL terminal
  -- AND whose latest iteration finished >5 minutes ago. The SSE route
  -- handler must have died before either dispatching the next
  -- iteration or writing the terminal turn status.
  FOR v_row IN
    SELECT dt.id AS turn_id, dt.conversation_id
    FROM director_turns dt
    WHERE dt.status = 'in_progress'
      AND dt.started_at < v_now - INTERVAL '5 minutes'
      -- Either no iterations at all (somehow inserted without one) OR
      -- all iterations are terminal AND latest finished >5 min ago.
      AND (
        NOT EXISTS (
          SELECT 1 FROM agent_jobs aj
          WHERE aj.director_turn_id = dt.id
            AND aj.operation_type = 'director_iteration'
            AND aj.queue_status NOT IN ('completed','failed','cancelled','crashed','skipped')
        )
        AND COALESCE(
          (SELECT MAX(COALESCE(crashed_at, completed_at))
           FROM agent_jobs aj
           WHERE aj.director_turn_id = dt.id
             AND aj.operation_type = 'director_iteration'),
          dt.started_at
        ) < v_now - INTERVAL '5 minutes'
      )
    FOR UPDATE OF dt SKIP LOCKED
  LOOP
    UPDATE director_turns
    SET status       = 'failed',
        completed_at = v_now
    WHERE id = v_row.turn_id
      AND status = 'in_progress';

    IF v_row.conversation_id IS NOT NULL THEN
      SELECT COALESCE(MAX(sequence), 0) + 1
      INTO v_next_sequence
      FROM conversation_messages
      WHERE conversation_id = v_row.conversation_id;

      INSERT INTO conversation_messages (
        conversation_id, role, content, sequence, event_type, event_payload, cause
      ) VALUES (
        v_row.conversation_id,
        'system',
        'Director was interrupted before it could finish responding. The conversation is paused. Send another message to continue, or open the Scheduler to cancel any leftover jobs.',
        v_next_sequence,
        'failure_class_b',
        jsonb_build_object(
          'director_turn_id', v_row.turn_id,
          'failure_class', 'B',
          'reason', 'turn orphaned (latest iteration completed >5 minutes ago without follow-up)'
        ),
        'orphan_turn_sweep'
      );
    END IF;

    v_swept := v_swept + 1;
  END LOOP;

  -- Step 3 — preserve the M-107 fallback for non-Director rows
  -- (workflow_step agent_jobs etc).
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

  RETURN v_swept;
END;
$$;

REVOKE ALL ON FUNCTION scheduler_sweep_interrupted_iterations(INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION scheduler_sweep_interrupted_iterations(INTEGER) TO service_role;

-- Backfill: catch any orphan turns currently stuck (excluding the
-- one we just manually cancelled). Limited to the last 30 days to
-- keep the backfill bounded — older test-detritus stays as-is.
DO $$
DECLARE
  v_row RECORD;
  v_conv UUID;
  v_seq INTEGER;
BEGIN
  FOR v_row IN
    SELECT dt.id AS turn_id, dt.conversation_id
    FROM director_turns dt
    WHERE dt.status = 'in_progress'
      AND dt.started_at > NOW() - INTERVAL '30 days'
      AND dt.started_at < NOW() - INTERVAL '5 minutes'
      AND NOT EXISTS (
        SELECT 1 FROM agent_jobs aj
        WHERE aj.director_turn_id = dt.id
          AND aj.operation_type = 'director_iteration'
          AND aj.queue_status NOT IN ('completed','failed','cancelled','crashed','skipped')
      )
  LOOP
    UPDATE director_turns
    SET status='failed', completed_at=NOW()
    WHERE id=v_row.turn_id AND status='in_progress';

    IF v_row.conversation_id IS NOT NULL THEN
      v_conv := v_row.conversation_id;
      SELECT COALESCE(MAX(sequence),0)+1 INTO v_seq
      FROM conversation_messages WHERE conversation_id = v_conv;

      -- Only emit the event if not already emitted for this turn
      IF NOT EXISTS (
        SELECT 1 FROM conversation_messages
        WHERE conversation_id = v_conv
          AND event_type = 'failure_class_b'
          AND (event_payload->>'director_turn_id')::UUID = v_row.turn_id
      ) THEN
        INSERT INTO conversation_messages (
          conversation_id, role, content, sequence, event_type, event_payload, cause
        ) VALUES (
          v_conv, 'system',
          'Director was interrupted before it could finish responding. The conversation is paused. Send another message to continue, or open the Scheduler to cancel any leftover jobs.',
          v_seq, 'failure_class_b',
          jsonb_build_object('director_turn_id', v_row.turn_id, 'failure_class', 'B', 'reason', 'turn orphaned (backfill)'),
          'orphan_turn_sweep_backfill'
        );
      END IF;
    END IF;
  END LOOP;
END $$;
