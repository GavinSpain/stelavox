-- M-167 — sweep also clears stuck interim conversation_messages.
--
-- Background. The Phase 5b I-12 single-flight check in
-- /api/director/message rejects new POSTs with 409 conversation_locked
-- when ANY conversation_message in that conversation has
-- turn_state='interim'. Interim rows are the partial assistant text
-- the SSE stream writes while it's still arriving — they transition
-- to 'final' (success) or 'interrupted' (disconnect/error) when the
-- route handler exits.
--
-- If the route handler dies mid-stream (Vercel timeout, browser tab
-- closed, SSE connection severed), the interim row never gets
-- transitioned. The single-flight check then permanently rejects every
-- subsequent send. M-166 fixed director_turns.status; M-165 surfaced
-- iteration crashes — neither touches turn_state on conversation_messages.
--
-- Discovered 2026-05-17 immediately after M-166 was applied: the user
-- could still not send messages because the interim row from the
-- earlier interrupted Director turn had been left behind. Manual
-- UPDATE unblocked the user; this migration ensures the every-minute
-- sweep handles future occurrences without operator intervention.
--
-- Fix: extend the sweep to also UPDATE conversation_messages SET
-- turn_state='interrupted' for interim rows whose author director_turn
-- is no longer in_progress. The two state transitions (turn → failed,
-- message → interrupted) happen together so the conversation lock
-- always releases when the turn terminates.

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
  v_interim_cleared INTEGER;
BEGIN
  -- Step 1 — heartbeat-stale Director iterations (M-165 path).
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
      SET status='failed', completed_at=v_now
      WHERE id=v_row.director_turn_id AND status='in_progress';

      SELECT conversation_id INTO v_conversation_id
      FROM director_turns WHERE id=v_row.director_turn_id;

      IF v_conversation_id IS NOT NULL THEN
        SELECT COALESCE(MAX(sequence),0)+1 INTO v_next_sequence
        FROM conversation_messages WHERE conversation_id=v_conversation_id;

        INSERT INTO conversation_messages (
          conversation_id, role, content, sequence, event_type, event_payload, cause
        ) VALUES (
          v_conversation_id, 'system',
          'Director was interrupted before it could finish responding. The conversation is paused. Send another message to continue, or open the Scheduler to cancel any leftover jobs.',
          v_next_sequence, 'failure_class_b',
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

  -- Step 2 — orphan turns (M-166 path).
  FOR v_row IN
    SELECT dt.id AS turn_id, dt.conversation_id
    FROM director_turns dt
    WHERE dt.status='in_progress'
      AND dt.started_at < v_now - INTERVAL '5 minutes'
      AND NOT EXISTS (
        SELECT 1 FROM agent_jobs aj
        WHERE aj.director_turn_id = dt.id
          AND aj.operation_type = 'director_iteration'
          AND aj.queue_status NOT IN ('completed','failed','cancelled','crashed','skipped')
      )
      AND COALESCE(
        (SELECT MAX(COALESCE(crashed_at, completed_at))
         FROM agent_jobs aj WHERE aj.director_turn_id=dt.id AND aj.operation_type='director_iteration'),
        dt.started_at
      ) < v_now - INTERVAL '5 minutes'
    FOR UPDATE OF dt SKIP LOCKED
  LOOP
    UPDATE director_turns SET status='failed', completed_at=v_now
    WHERE id=v_row.turn_id AND status='in_progress';

    IF v_row.conversation_id IS NOT NULL THEN
      SELECT COALESCE(MAX(sequence),0)+1 INTO v_next_sequence
      FROM conversation_messages WHERE conversation_id=v_row.conversation_id;

      INSERT INTO conversation_messages (
        conversation_id, role, content, sequence, event_type, event_payload, cause
      ) VALUES (
        v_row.conversation_id, 'system',
        'Director was interrupted before it could finish responding. The conversation is paused. Send another message to continue, or open the Scheduler to cancel any leftover jobs.',
        v_next_sequence, 'failure_class_b',
        jsonb_build_object('director_turn_id', v_row.turn_id, 'failure_class', 'B', 'reason', 'turn orphaned'),
        'orphan_turn_sweep'
      );
    END IF;

    v_swept := v_swept + 1;
  END LOOP;

  -- Step 3 — NEW M-167: clear stuck interim conversation_messages.
  -- An assistant message with turn_state='interim' blocks the
  -- single-flight check forever if its author turn died without the
  -- route handler flipping it. Match by: interim AND created_at >
  -- 5 minutes ago AND no in-flight director_turn or agent_job still
  -- running for the same conversation.
  UPDATE conversation_messages cm
  SET turn_state = 'interrupted'
  WHERE cm.turn_state = 'interim'
    AND cm.created_at < v_now - INTERVAL '5 minutes'
    AND NOT EXISTS (
      SELECT 1 FROM director_turns dt
      WHERE dt.conversation_id = cm.conversation_id
        AND dt.status = 'in_progress'
        AND dt.started_at > cm.created_at - INTERVAL '1 minute'
    )
    AND NOT EXISTS (
      SELECT 1 FROM agent_jobs aj
      WHERE aj.operation_type = 'director_iteration'
        AND aj.queue_status IN ('queued','dispatched','running')
        AND aj.director_turn_id IN (
          SELECT id FROM director_turns dt2 WHERE dt2.conversation_id = cm.conversation_id
        )
    );

  GET DIAGNOSTICS v_interim_cleared = ROW_COUNT;
  v_swept := v_swept + v_interim_cleared;

  -- Step 4 — non-Director fallback (M-107).
  UPDATE agent_jobs
  SET queue_status='crashed', status='failed', failure_class='B',
      crashed_at=v_now,
      error_message=format('heartbeat stale (>%s seconds)', p_stale_threshold_seconds)
  WHERE queue_status IN ('dispatched','running')
    AND last_heartbeat_at IS NOT NULL
    AND last_heartbeat_at < v_now - (p_stale_threshold_seconds || ' seconds')::INTERVAL
    AND (operation_type != 'director_iteration' OR director_turn_id IS NULL);

  RETURN v_swept;
END;
$$;

REVOKE ALL ON FUNCTION scheduler_sweep_interrupted_iterations(INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION scheduler_sweep_interrupted_iterations(INTEGER) TO service_role;

-- Backfill: clear any other stuck interim rows (older than 5 minutes,
-- no live turn / job in their conversation). Limited to the last 30
-- days for boundedness.
UPDATE public.conversation_messages cm
SET turn_state = 'interrupted'
WHERE cm.turn_state = 'interim'
  AND cm.created_at > NOW() - INTERVAL '30 days'
  AND cm.created_at < NOW() - INTERVAL '5 minutes'
  AND NOT EXISTS (
    SELECT 1 FROM director_turns dt
    WHERE dt.conversation_id = cm.conversation_id
      AND dt.status = 'in_progress'
      AND dt.started_at > cm.created_at - INTERVAL '1 minute'
  );
