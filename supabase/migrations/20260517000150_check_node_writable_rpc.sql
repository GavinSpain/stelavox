-- Migration 150: check_node_writable RPC + agent_jobs in-flight indexes
--
-- Phase 6.A — Locking and Workflow / unified write-gate.
--
-- Per Phase 6 deep-dive (2026-05-17), every node write operation
-- routes through ONE function that checks all three lock categories:
--
--   1. Author Lock      — durable author intent. Read from
--                          nodes.locked in this migration (will move
--                          to node_author_locks in 6.B M-151).
--   2. Edit Session     — coworker presence. Read from node_locks
--                          where user_id != requester AND not expired.
--                          5-minute auto-release per Phase 1 design.
--   3. Agent In-Flight  — derived from agent_jobs. A node is in-flight
--                          iff queue_status IN (queued, dispatched,
--                          running) OR status = 'completed' (the
--                          completed-pending-review state from V1.x-D
--                          is indefinite by design — also acts as the
--                          review-needed backlog signal).
--
-- The blocker order matches the user-facing priority: Author Lock
-- first (the most explicit author intent), then Edit Session, then
-- Agent In-Flight. Returns NULL details for the writable case.
--
-- Phase 6.A internally still reads nodes.locked. Phase 6.B M-152
-- updates this function to read node_author_locks instead, then
-- M-153 drops the nodes.locked columns. This staging keeps the write
-- endpoints stable across the 6.A → 6.B boundary.
--
-- Returns a JSONB:
--   { writable: true,  blocker: null,                  details: null }
--   { writable: false, blocker: 'author_locked',       details: {...} }
--   { writable: false, blocker: 'node_in_use',         details: {...} }
--   { writable: false, blocker: 'node_in_progress',    details: {...} }
--
-- SET search_path = public per H-13.

CREATE OR REPLACE FUNCTION check_node_writable(
  p_node_id UUID,
  p_requesting_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_node RECORD;
  v_edit_session RECORD;
  v_in_flight RECORD;
BEGIN
  SELECT id, locked, lock_reason, locked_at
    INTO v_node
    FROM nodes
   WHERE id = p_node_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'writable', false,
      'blocker', 'not_found',
      'details', NULL
    );
  END IF;

  -- 1. Author Lock (Category 1).
  IF v_node.locked THEN
    RETURN jsonb_build_object(
      'writable', false,
      'blocker', 'author_locked',
      'details', jsonb_build_object(
        'reason', v_node.lock_reason,
        'locked_at', v_node.locked_at
      )
    );
  END IF;

  -- 2. Edit Session (Category 2) — only blocks if held by a DIFFERENT user.
  SELECT user_id, locked_at, expires_at
    INTO v_edit_session
    FROM node_locks
   WHERE node_id = p_node_id
     AND user_id != p_requesting_user_id
     AND expires_at > NOW();

  IF FOUND THEN
    RETURN jsonb_build_object(
      'writable', false,
      'blocker', 'node_in_use',
      'details', jsonb_build_object(
        'held_by_user_id', v_edit_session.user_id,
        'expires_at', v_edit_session.expires_at
      )
    );
  END IF;

  -- 3. Agent In-Flight (Category 3). Predicate covers:
  --   - queue_status IN ('queued','dispatched','running') — actively
  --     in the scheduler or running
  --   - status = 'completed' — finished, awaiting author Accept (the
  --     indefinite review-pending state from V1.x-D §17.8 / D6)
  SELECT id, operation_type, status, queue_status, created_at
    INTO v_in_flight
    FROM agent_jobs
   WHERE node_id = p_node_id
     AND (
       queue_status IN ('queued', 'dispatched', 'running')
       OR status = 'completed'
     )
   ORDER BY created_at DESC
   LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'writable', false,
      'blocker', 'node_in_progress',
      'details', jsonb_build_object(
        'job_id', v_in_flight.id,
        'operation_type', v_in_flight.operation_type,
        'status', v_in_flight.status,
        'queue_status', v_in_flight.queue_status,
        'started_at', v_in_flight.created_at
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'writable', true,
    'blocker', NULL,
    'details', NULL
  );
END;
$$;

GRANT EXECUTE ON FUNCTION check_node_writable(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION check_node_writable(UUID, UUID) TO service_role;

-- Fast lookup for the in-flight check. Partial index keeps the index
-- tight (only active job rows). queue_status set covers the actively-
-- in-scheduler states; the completed-pending-review state uses status.
CREATE INDEX IF NOT EXISTS idx_agent_jobs_active_targets
  ON agent_jobs(node_id, queue_status)
  WHERE queue_status IN ('queued', 'dispatched', 'running');

CREATE INDEX IF NOT EXISTS idx_agent_jobs_completed_pending
  ON agent_jobs(node_id, status)
  WHERE status = 'completed';

COMMENT ON FUNCTION check_node_writable(UUID, UUID) IS
  'Unified write-gate covering all three Phase 6 lock categories: Author Lock, Edit Session, Agent In-Flight. Returns JSONB { writable, blocker, details }. Blocker order: author_locked → node_in_use → node_in_progress. Called by every write endpoint that mutates a node.';
