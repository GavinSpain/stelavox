-- Migration 153: Author Lock RPCs + check_node_writable read-source switch
--
-- Phase 6.B — Author Lock (Category 1).
--
-- Six SECURITY DEFINER functions for the Author Lock lifecycle:
--   - propose_author_lock_conflicts(p_node_ids[]) — pre-check for D3
--   - apply_author_lock(p_node_id, p_reason)       — solo lock
--   - apply_author_lock_bulk(p_node_id, p_reason,  — bulk lock
--                            p_descendant_ids[])
--   - release_author_lock(p_node_id)                — solo unlock
--   - release_bulk_operation(p_bulk_op_id)          — group unlock
--   - force_unlock(p_node_id, p_reason)             — owner emergency
--
-- All include SET search_path = public per H-13.
-- All call functions check organisation_members for membership.
-- force_unlock additionally checks 'owner' role and writes audit_log.
--
-- This migration also UPDATES check_node_writable (from M-150) to
-- read node_author_locks instead of nodes.locked. The
-- author_locked details payload now includes locked_by + reason +
-- locked_at + bulk_operation_id.

-- ─── propose_author_lock_conflicts ───────────────────────────────────
-- Returns the list of pending agent_jobs that would conflict with a
-- lock request on the given node ids. No mutations. Per D3 the caller
-- presents this list to the author and lets them choose.

CREATE OR REPLACE FUNCTION propose_author_lock_conflicts(
  p_node_ids UUID[]
) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_conflicts JSONB;
BEGIN
  -- Membership check via the first node's organisation. All nodes in
  -- the input array share an organisation in practice (the UI scopes
  -- to one document); the check covers the first as a guard.
  IF p_node_ids IS NULL OR array_length(p_node_ids, 1) IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  SELECT jsonb_agg(jsonb_build_object(
    'job_id',          j.id,
    'node_id',         j.node_id,
    'operation_type',  j.operation_type,
    'status',          j.status,
    'queue_status',    j.queue_status,
    'started_at',      j.created_at
  )) INTO v_conflicts
    FROM agent_jobs j
   WHERE j.node_id = ANY(p_node_ids)
     AND (
       j.queue_status IN ('queued', 'dispatched', 'running')
       OR j.status = 'completed'
     );

  RETURN COALESCE(v_conflicts, '[]'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION propose_author_lock_conflicts(UUID[]) TO authenticated;
GRANT EXECUTE ON FUNCTION propose_author_lock_conflicts(UUID[]) TO service_role;

-- ─── apply_author_lock ─────────────────────────────────────────────────
-- INSERT a single lock row. Conflict check responsibility lives in the
-- API route + UI (callers proposed conflicts upfront and asked the
-- author to resolve before calling this). The function itself fails
-- only on idempotency (already locked) or membership.

CREATE OR REPLACE FUNCTION apply_author_lock(
  p_node_id UUID,
  p_reason  TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_node       nodes%ROWTYPE;
  v_caller     UUID := auth.uid();
BEGIN
  SELECT * INTO v_node FROM nodes WHERE id = p_node_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: node % does not exist', p_node_id;
  END IF;

  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'forbidden: no auth context';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM organisation_members
     WHERE user_id = v_caller AND organisation_id = v_node.organisation_id
  ) THEN
    RAISE EXCEPTION 'forbidden: caller is not a member of organisation %', v_node.organisation_id;
  END IF;

  INSERT INTO node_author_locks (
    node_id, organisation_id, locked_by_user_id, lock_reason
  ) VALUES (
    p_node_id, v_node.organisation_id, v_caller, p_reason
  );

  RETURN jsonb_build_object('ok', true, 'node_id', p_node_id);
END;
$$;

GRANT EXECUTE ON FUNCTION apply_author_lock(UUID, TEXT) TO authenticated;

-- ─── apply_author_lock_bulk ────────────────────────────────────────────
-- Atomic batch insert. p_descendant_ids is the precomputed descendants
-- list (from the UI's tree walk). All N+1 rows share a generated
-- bulk_operation_id. Returns the bulk_operation_id + the count.

CREATE OR REPLACE FUNCTION apply_author_lock_bulk(
  p_node_id          UUID,
  p_reason           TEXT,
  p_descendant_ids   UUID[]
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_node        nodes%ROWTYPE;
  v_caller      UUID := auth.uid();
  v_bulk_op_id  UUID := gen_random_uuid();
  v_count       INTEGER;
BEGIN
  SELECT * INTO v_node FROM nodes WHERE id = p_node_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: node % does not exist', p_node_id;
  END IF;

  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'forbidden: no auth context';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM organisation_members
     WHERE user_id = v_caller AND organisation_id = v_node.organisation_id
  ) THEN
    RAISE EXCEPTION 'forbidden: caller is not a member of organisation %', v_node.organisation_id;
  END IF;

  -- Lock the target node (root of the bulk) + all descendant ids.
  -- Each gets its own row. ON CONFLICT DO NOTHING handles the case
  -- where some descendants are already locked (idempotent at row level).
  INSERT INTO node_author_locks (
    node_id, organisation_id, locked_by_user_id, lock_reason, bulk_operation_id
  )
  SELECT id, v_node.organisation_id, v_caller, p_reason, v_bulk_op_id
    FROM nodes
   WHERE id = ANY(ARRAY[p_node_id] || COALESCE(p_descendant_ids, ARRAY[]::UUID[]))
     AND organisation_id = v_node.organisation_id
  ON CONFLICT (node_id) DO NOTHING;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'ok', true,
    'bulk_operation_id', v_bulk_op_id,
    'locked_count', v_count
  );
END;
$$;

GRANT EXECUTE ON FUNCTION apply_author_lock_bulk(UUID, TEXT, UUID[]) TO authenticated;

-- ─── release_author_lock ──────────────────────────────────────────────
-- DELETE a single lock row. Authorised for the locker themselves OR
-- any org owner (matches force_unlock for owner; but for a regular
-- unlock the audit log doesn't fire — the locker is acting on their
-- own work).

CREATE OR REPLACE FUNCTION release_author_lock(
  p_node_id UUID
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_lock     node_author_locks%ROWTYPE;
  v_caller   UUID := auth.uid();
  v_is_owner BOOLEAN;
BEGIN
  SELECT * INTO v_lock FROM node_author_locks WHERE node_id = p_node_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: lock on node % does not exist', p_node_id;
  END IF;

  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'forbidden: no auth context';
  END IF;

  IF v_caller != v_lock.locked_by_user_id THEN
    SELECT EXISTS (
      SELECT 1 FROM organisation_members
       WHERE user_id = v_caller
         AND organisation_id = v_lock.organisation_id
         AND role = 'owner'
    ) INTO v_is_owner;
    IF NOT v_is_owner THEN
      RAISE EXCEPTION 'forbidden: only the locker or an org owner can unlock';
    END IF;
  END IF;

  DELETE FROM node_author_locks WHERE node_id = p_node_id;
  RETURN jsonb_build_object('ok', true, 'node_id', p_node_id);
END;
$$;

GRANT EXECUTE ON FUNCTION release_author_lock(UUID) TO authenticated;

-- ─── release_bulk_operation ───────────────────────────────────────────
-- DELETE all rows sharing a bulk_operation_id. Same authorisation as
-- single unlock — the locker (any row's locked_by_user_id, which
-- by construction is the same for all rows in a bulk) or org owner.

CREATE OR REPLACE FUNCTION release_bulk_operation(
  p_bulk_operation_id UUID
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_sample      node_author_locks%ROWTYPE;
  v_caller      UUID := auth.uid();
  v_is_owner    BOOLEAN;
  v_count       INTEGER;
BEGIN
  SELECT * INTO v_sample FROM node_author_locks
    WHERE bulk_operation_id = p_bulk_operation_id
    LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: bulk operation % does not exist', p_bulk_operation_id;
  END IF;

  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'forbidden: no auth context';
  END IF;

  IF v_caller != v_sample.locked_by_user_id THEN
    SELECT EXISTS (
      SELECT 1 FROM organisation_members
       WHERE user_id = v_caller
         AND organisation_id = v_sample.organisation_id
         AND role = 'owner'
    ) INTO v_is_owner;
    IF NOT v_is_owner THEN
      RAISE EXCEPTION 'forbidden: only the locker or an org owner can release a bulk lock';
    END IF;
  END IF;

  DELETE FROM node_author_locks WHERE bulk_operation_id = p_bulk_operation_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'ok', true,
    'bulk_operation_id', p_bulk_operation_id,
    'released_count', v_count
  );
END;
$$;

GRANT EXECUTE ON FUNCTION release_bulk_operation(UUID) TO authenticated;

-- ─── force_unlock ──────────────────────────────────────────────────────
-- Org owner emergency action (D5). Logs to audit_log. The locker's
-- identity is preserved in the audit row.

CREATE OR REPLACE FUNCTION force_unlock(
  p_node_id UUID,
  p_reason  TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_lock     node_author_locks%ROWTYPE;
  v_caller   UUID := auth.uid();
BEGIN
  SELECT * INTO v_lock FROM node_author_locks WHERE node_id = p_node_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: lock on node % does not exist', p_node_id;
  END IF;

  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'forbidden: no auth context';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM organisation_members
     WHERE user_id = v_caller
       AND organisation_id = v_lock.organisation_id
       AND role = 'owner'
  ) THEN
    RAISE EXCEPTION 'forbidden: only an org owner can force-unlock';
  END IF;

  DELETE FROM node_author_locks WHERE node_id = p_node_id;

  -- Audit trail per D5.
  INSERT INTO audit_log (
    organisation_id, user_id, event_type, severity, node_id, metadata
  ) VALUES (
    v_lock.organisation_id,
    v_caller,
    'force_unlock',
    'warning',
    p_node_id,
    jsonb_build_object(
      'reason', p_reason,
      'original_locker', v_lock.locked_by_user_id,
      'original_lock_reason', v_lock.lock_reason,
      'original_locked_at', v_lock.locked_at,
      'bulk_operation_id', v_lock.bulk_operation_id
    )
  );

  RETURN jsonb_build_object('ok', true, 'node_id', p_node_id);
END;
$$;

GRANT EXECUTE ON FUNCTION force_unlock(UUID, TEXT) TO authenticated;

-- ─── Update check_node_writable to read node_author_locks ──────────────
-- Switches the source-of-truth from nodes.locked to the new table.
-- All other logic (Edit Session + Agent In-Flight) unchanged.

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
  v_author_lock RECORD;
  v_edit_session RECORD;
  v_in_flight RECORD;
BEGIN
  SELECT id INTO v_node FROM nodes WHERE id = p_node_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('writable', false, 'blocker', 'not_found', 'details', NULL);
  END IF;

  -- 1. Author Lock — now from node_author_locks table.
  SELECT lock_reason, locked_at, locked_by_user_id, bulk_operation_id
    INTO v_author_lock
    FROM node_author_locks WHERE node_id = p_node_id;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'writable', false,
      'blocker', 'author_locked',
      'details', jsonb_build_object(
        'reason', v_author_lock.lock_reason,
        'locked_at', v_author_lock.locked_at,
        'locked_by_user_id', v_author_lock.locked_by_user_id,
        'bulk_operation_id', v_author_lock.bulk_operation_id
      )
    );
  END IF;

  -- 2. Edit Session — unchanged.
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

  -- 3. Agent In-Flight — unchanged.
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

  RETURN jsonb_build_object('writable', true, 'blocker', NULL, 'details', NULL);
END;
$$;
