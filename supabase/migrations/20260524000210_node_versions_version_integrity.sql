-- M-210 — node_versions integrity: bump-on-GUC-regardless-of-content +
--         skip-snapshot-on-expand + UNIQUE (node_id, version) backstop +
--         one-shot renumber of duplicate-version rows.
--
-- Discovered 2026-05-24 via VersionHistory click-to-preview UI: clicking
-- any version row produced "Could not load v{N}" because the lookup
-- helper `getVersion(node_id, version_number)` uses `.maybeSingle()`,
-- which errors when multiple rows match the same `(node_id, version)`
-- pair. Investigation surfaced that some nodes had several snapshot
-- rows all numbered v=1 in node_versions despite multiple agent Accepts
-- across different days. The live `nodes.prose` was correct in every
-- case; only the history numbering was corrupted.
--
-- Two root causes combine to produce duplicate snapshot rows:
--
--   1. The M-035 trigger `bump_node_version_on_content_change` requires
--      BOTH the session GUC `stelavox.bump_version='true'` AND a real
--      content delta (`NEW.prose IS DISTINCT FROM OLD.prose` for any of
--      summary/prose/notes/metadata) to bump nodes.version. When
--      `accept_agent_job` applies content that happens to be byte-
--      identical to what's already on the node — possible when an
--      agent retry submits the same result, when a low-temperature
--      synthesise re-runs deterministically, or when autosave wrote the
--      same content between dispatch and accept — the trigger sees no
--      diff and silently skips the bump. The accept-side snapshot
--      INSERT runs unconditionally, so each idempotent-content accept
--      stacks another snapshot row at the unchanged version number.
--      *Verified empirically*: a fresh accept_agent_job call with
--      target_prose equal to current nodes.prose produced snapshot v=1
--      and left nodes.version at 1.
--
--   2. The current `accept_agent_job` unconditionally INSERTs a
--      snapshot row at the top of the function — including for
--      `expand` operations, which per M-034 don't modify the parent's
--      content fields and therefore don't trip the trigger's bump
--      branch. Every repeated expand on the same parent produces
--      another snapshot at the same version. Node `8706dfed-...` in
--      the live DB had four agent_expand snapshots all at v=1 for
--      exactly this reason. The snapshot's content is identical to the
--      live content (expand changes structure, not content), so the
--      snapshot rows carry no history signal — they're pure noise.
--
-- Fix shape (single migration, six steps in one transaction):
--
--   A. Renumber duplicate snapshot rows in-place. For each node with
--      duplicates, order by created_at ASC and assign version =
--      ROW_NUMBER(). Snapshots are not FK targets, so renumbering is
--      safe. Chronologically faithful: the oldest snapshot keeps its
--      original v=1 (or moves to the lowest free number), subsequent
--      ones take v=2, v=3, …. No data lost.
--
--   B. Reconcile nodes.version against the renumbered snapshots:
--      nodes.version = MAX(node_versions.version) + 1 for every node
--      that has snapshots. Restores the invariant that nodes.version
--      points one past the highest snapshot.
--
--   C. Add UNIQUE (node_id, version) on node_versions. Structural
--      backstop: any future regression of either root cause fails
--      loudly with a constraint violation instead of silently
--      corrupting history.
--
--   D. Rewrite the trigger to GUC-first logic. When the caller sets
--      `stelavox.bump_version='true'`, ALWAYS bump version AND
--      content_revision regardless of content delta — the caller's
--      intent (this is an agent accept) is the bump signal, not the
--      byte diff. Autosave path (GUC unset) preserves the existing
--      "bump content_revision only on real content change" behaviour.
--      TC-A-11 ("Same content does not bump version") still passes
--      because that test doesn't set the GUC.
--
--   E. Rewrite accept_agent_job to skip the snapshot INSERT for
--      `expand` operations. Expand changes structure, not content;
--      the pre-expand and post-expand snapshot would be identical, so
--      the row carries no history. The structural change is recorded
--      by the child rows' creation timestamps.
--
--   F. session_replication_role = replica during step A/B so the
--      trigger doesn't fire on the renumber UPDATEs.
--
-- After M-210, the GUC is the single source of truth for "is this a
-- version-bump-worthy event" — both for synth/refine/generate_context
-- (set via accept_agent_job) and for restore (set via
-- restore_node_version). Hazard H-26 documents the invariant.

BEGIN;

-- ------------------------------------------------------------------
-- Step F: bypass triggers during backfill UPDATEs.
-- session_replication_role='replica' tells Postgres "we're applying
-- replication output", which skips user-defined triggers (the M-035
-- trigger refuses to honour caller-supplied version values — we need
-- to bypass it for the nodes.version backfill in step B).
-- ------------------------------------------------------------------
SET LOCAL session_replication_role = replica;

-- ------------------------------------------------------------------
-- Step A: renumber duplicate (node_id, version) snapshot rows.
-- For each affected node, ORDER BY created_at ASC and reassign
-- version = ROW_NUMBER(). Only rewrites affected nodes; nodes with
-- already-unique snapshots are untouched.
-- ------------------------------------------------------------------
WITH affected_nodes AS (
  SELECT DISTINCT node_id
  FROM node_versions
  GROUP BY node_id, version
  HAVING COUNT(*) > 1
),
renumbered AS (
  SELECT
    nv.id,
    ROW_NUMBER() OVER (PARTITION BY nv.node_id ORDER BY nv.created_at, nv.id) AS new_version
  FROM node_versions nv
  WHERE nv.node_id IN (SELECT node_id FROM affected_nodes)
)
UPDATE node_versions AS nv
SET    version = r.new_version
FROM   renumbered r
WHERE  nv.id = r.id
  AND  nv.version <> r.new_version;

-- ------------------------------------------------------------------
-- Step B: reconcile nodes.version to MAX(snapshot.version) + 1 for
-- each affected node. Restores the "live points one past highest
-- snapshot" invariant.
-- ------------------------------------------------------------------
UPDATE nodes AS n
SET    version = sub.next_version
FROM (
  SELECT node_id, MAX(version) + 1 AS next_version
  FROM   node_versions
  WHERE  node_id IN (
    SELECT DISTINCT nv.node_id
    FROM   node_versions nv
    GROUP  BY nv.node_id, nv.version
    HAVING COUNT(*) > 0  -- all snapshotted nodes; cheap to re-confirm
  )
  GROUP  BY node_id
) AS sub
WHERE  n.id = sub.node_id
  AND  n.version < sub.next_version;  -- only bump if we'd raise the value

-- Re-enable triggers for the rest of the migration.
SET LOCAL session_replication_role = origin;

-- ------------------------------------------------------------------
-- Step C: structural backstop.
-- Future regression of either root cause now fails loudly.
-- ------------------------------------------------------------------
ALTER TABLE node_versions
  ADD CONSTRAINT node_versions_node_id_version_unique UNIQUE (node_id, version);

COMMENT ON CONSTRAINT node_versions_node_id_version_unique ON node_versions IS
  'M-210: enforce that each (node_id, version) is unique. Backstop for '
  'the GUC-first invariant — see hazard H-26 + comment on '
  'bump_node_version_on_content_change.';

-- ------------------------------------------------------------------
-- Step D: rewrite the trigger function.
-- GUC-first: caller's intent is the bump signal, not the byte diff.
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION bump_node_version_on_content_change()
RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_should_bump_version BOOLEAN;
  v_content_changed     BOOLEAN;
BEGIN
  -- Session GUC unset → empty string → NULL → FALSE.
  BEGIN
    v_should_bump_version := COALESCE(
      NULLIF(current_setting('stelavox.bump_version', true), '')::boolean,
      FALSE
    );
  EXCEPTION WHEN OTHERS THEN
    v_should_bump_version := FALSE;
  END;

  v_content_changed :=
       NEW.summary  IS DISTINCT FROM OLD.summary
    OR NEW.prose    IS DISTINCT FROM OLD.prose
    OR NEW.notes    IS DISTINCT FROM OLD.notes
    OR NEW.metadata IS DISTINCT FROM OLD.metadata;

  IF v_should_bump_version THEN
    -- M-210 GUC-first: caller (accept_agent_job / restore_node_version)
    -- explicitly signalled intent to bump. Always bump BOTH
    -- content_revision and version, regardless of whether the content
    -- bytes actually changed. The caller is the source of truth for
    -- "is this a version-bump-worthy event"; the trigger's job is to
    -- honour that signal, not second-guess it via byte comparison.
    NEW.content_revision := COALESCE(OLD.content_revision, 0) + 1;
    NEW.version          := OLD.version + 1;
  ELSIF v_content_changed THEN
    -- Autosave path. Bump content_revision only — version stays a
    -- semantic-checkpoint anchor that increments only on caller-opted
    -- events (M-035 invariant preserved).
    NEW.content_revision := COALESCE(OLD.content_revision, 0) + 1;
    NEW.version          := OLD.version;
  ELSE
    -- No-op update (e.g., touching only updated_at or non-content
    -- columns). Preserve both anchors.
    NEW.content_revision := OLD.content_revision;
    NEW.version          := OLD.version;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION bump_node_version_on_content_change() IS
  'BEFORE UPDATE trigger on nodes. M-210 GUC-first: when the caller '
  'sets stelavox.bump_version=true, ALWAYS bump version AND '
  'content_revision regardless of content delta. Otherwise '
  '(autosave path), bump content_revision only when summary/prose/'
  'notes/metadata actually changed. Hazard H-26.';

-- ------------------------------------------------------------------
-- Step E: rewrite accept_agent_job to skip snapshot for expand.
-- The function body is otherwise identical to M-190; only the snapshot
-- INSERT becomes conditional on operation_type <> 'expand'.
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION accept_agent_job(
  p_job_id UUID,
  p_actor_id TEXT,
  p_target_summary TEXT DEFAULT NULL,
  p_target_prose TEXT DEFAULT NULL,
  p_target_notes TEXT DEFAULT NULL,
  p_target_metadata JSONB DEFAULT NULL,
  p_child_nodes JSONB DEFAULT NULL
)
RETURNS TABLE (
  out_node_id UUID,
  out_new_version INTEGER,
  out_child_node_ids UUID[]
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job RECORD;
  v_node RECORD;
  v_new_child_ids UUID[] := ARRAY[]::UUID[];
  v_child JSONB;
  v_max_position INTEGER;
  v_new_node_id UUID;
  v_child_node_type TEXT;
  v_layer_stack_id UUID;
BEGIN
  SELECT * INTO v_job FROM agent_jobs WHERE id = p_job_id FOR UPDATE;
  IF v_job IS NULL THEN
    RAISE EXCEPTION 'agent_job_not_found' USING ERRCODE = 'P0001';
  END IF;

  IF v_job.status = 'accepted' THEN
    RETURN QUERY SELECT v_job.node_id, NULL::INTEGER, ARRAY[]::UUID[];
    RETURN;
  END IF;

  IF v_job.status != 'completed' THEN
    RAISE EXCEPTION 'agent_job_already_terminal:%', v_job.status USING ERRCODE = 'P0001';
  END IF;

  IF v_job.node_id IS NULL THEN
    RAISE EXCEPTION 'target_node_not_found' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_node FROM nodes WHERE id = v_job.node_id FOR UPDATE;
  IF v_node IS NULL THEN
    RAISE EXCEPTION 'target_node_not_found' USING ERRCODE = 'P0001';
  END IF;

  IF v_job.target_node_version_at_capture IS NOT NULL
     AND v_node.version != v_job.target_node_version_at_capture THEN
    RAISE EXCEPTION 'target_version_mismatch:%:%',
      v_node.version, v_job.target_node_version_at_capture USING ERRCODE = 'P0001';
  END IF;

  -- M-210: skip the snapshot for `expand`. Expand changes structure
  -- (adds child rows), not parent content. The pre-expand and
  -- post-expand snapshot would be byte-identical, so the row carries
  -- no history signal — it's pure noise that previously caused
  -- duplicate (node_id, version) rows on repeated expands. The
  -- structural change is recorded by the child rows' creation
  -- timestamps.
  IF v_job.operation_type <> 'expand' THEN
    INSERT INTO node_versions (
      node_id, organisation_id, version,
      summary, prose, notes, metadata,
      changed_by, change_reason
    ) VALUES (
      v_node.id, v_node.organisation_id, v_node.version,
      v_node.summary, v_node.prose, v_node.notes, v_node.metadata,
      p_actor_id, 'agent_' || v_job.operation_type
    );
  END IF;

  IF v_job.operation_type IN ('synthesise', 'refine', 'generate_context') THEN
    PERFORM set_config('stelavox.bump_version', 'true', true);
    UPDATE nodes SET
      summary = COALESCE(p_target_summary::JSONB, summary),
      prose = COALESCE(p_target_prose::JSONB, prose),
      notes = COALESCE(p_target_notes::JSONB, notes),
      metadata = CASE
        WHEN p_target_metadata IS NOT NULL
        THEN COALESCE(metadata, '{}'::jsonb) || p_target_metadata
        ELSE metadata
      END,
      last_ai_change_at = NOW()
    WHERE id = v_node.id;
    PERFORM set_config('stelavox.bump_version', 'false', true);
  END IF;

  IF v_job.operation_type = 'expand' AND p_child_nodes IS NOT NULL THEN
    SELECT layer_stack_id INTO v_layer_stack_id
    FROM documents WHERE id = v_node.document_id;

    SELECT layers->((v_node.layer_index + 1)::INT)->>'node_type'
    INTO v_child_node_type
    FROM layer_stacks WHERE id = v_layer_stack_id;

    IF v_child_node_type IS NULL THEN
      RAISE EXCEPTION 'no_child_layer' USING ERRCODE = 'P0001';
    END IF;

    SELECT COALESCE(MAX("order"), 0) INTO v_max_position
    FROM nodes WHERE parent_id = v_node.id;

    FOR v_child IN SELECT * FROM jsonb_array_elements(p_child_nodes)
    LOOP
      v_max_position := v_max_position + 1;
      INSERT INTO nodes (
        organisation_id, project_id, document_id, parent_id,
        node_category, node_type,
        layer_index, depth, "order",
        name, short_description, summary,
        metadata, word_count_target,
        status, version,
        last_ai_change_at
      ) VALUES (
        v_node.organisation_id, v_node.project_id, v_node.document_id, v_node.id,
        'structural', v_child_node_type,
        v_node.layer_index + 1, COALESCE(v_node.depth, 0) + 1, v_max_position,
        v_child->>'name',
        v_child->>'short_description',
        v_child->'summary',
        COALESCE(v_child->'metadata', '{}'::jsonb),
        NULLIF((v_child->>'word_count_target')::TEXT, '')::INTEGER,
        'draft', 1,
        NOW()
      ) RETURNING id INTO v_new_node_id;
      v_new_child_ids := array_append(v_new_child_ids, v_new_node_id);
    END LOOP;
  END IF;

  -- M-190: stamp the agent_jobs row terminal.
  UPDATE agent_jobs SET
    status = 'accepted',
    queue_status = 'completed',
    completed_at = NOW()
  WHERE id = p_job_id;

  RETURN QUERY SELECT
    v_node.id,
    (SELECT version FROM nodes WHERE id = v_node.id),
    v_new_child_ids;
END;
$$;

COMMENT ON FUNCTION accept_agent_job(UUID, TEXT, TEXT, TEXT, TEXT, JSONB, JSONB) IS
  'M-210: applies an accepted agent_job result atomically. Snapshots '
  'parent content into node_versions (skipped for expand — see H-26). '
  'For synth/refine/generate_context: sets stelavox.bump_version=true '
  'around the UPDATE so the M-035 trigger (post-M-210: GUC-first) bumps '
  'nodes.version regardless of content delta. For expand: inserts '
  'children, does not touch parent content fields. Stamps the agent_job '
  'row to accepted/completed in all paths.';

COMMIT;
