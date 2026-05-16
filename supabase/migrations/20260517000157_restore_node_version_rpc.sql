-- Migration 157: restore_node_version RPC
--
-- Phase 6.C — Version Restore.
--
-- Per Phase 6 deep-dive decisions D8/D9/D10:
--   - Additive: creates a new version, never destroys history. The
--     current content snapshot goes into node_versions; the chosen
--     target version's content overwrites the live nodes row.
--   - Content-only: overwrites summary / prose / notes / metadata.
--     Preserves name / short_description / tags / status / lock /
--     tree position / etc.
--   - Concurrency: 409 on version conflict. p_expected_version must
--     match current nodes.version, else returns error 'version_conflict'.
--   - Write-gate: blocked by Author Lock, Edit Session, or Agent
--     In-Flight via check_node_writable RPC.
--   - Audit: change_reason = 'restore_from_v{N}' on the new version
--     row so VersionHistory can render the source.
--
-- Returns JSONB:
--   { ok: true,  new_version: N,
--     restored_from: M }
--   { ok: false, error: 'version_conflict' | 'version_not_found' |
--                       'author_locked' | 'node_in_use' |
--                       'node_in_progress' | 'not_found',
--     details: { ... } }
--
-- SET search_path = public per H-13.

CREATE OR REPLACE FUNCTION restore_node_version(
  p_node_id UUID,
  p_target_version INTEGER,
  p_expected_version INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_node nodes%ROWTYPE;
  v_target node_versions%ROWTYPE;
  v_caller UUID := auth.uid();
  v_writable JSONB;
  v_new_version INTEGER;
BEGIN
  -- Step 1: load and lock the live node.
  SELECT * INTO v_node FROM nodes WHERE id = p_node_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found', 'details', NULL);
  END IF;

  -- Step 2: optimistic-concurrency check (D10: 409, no proceed-anyway).
  IF v_node.version != p_expected_version THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'version_conflict',
      'details', jsonb_build_object(
        'expected_version', p_expected_version,
        'current_version', v_node.version
      )
    );
  END IF;

  -- Step 3: load the target historical version.
  SELECT * INTO v_target
    FROM node_versions
   WHERE node_id = p_node_id
     AND version = p_target_version;
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'version_not_found',
      'details', jsonb_build_object(
        'node_id', p_node_id,
        'target_version', p_target_version
      )
    );
  END IF;

  -- Step 4: write-gate check (D11). Author Lock, Edit Session,
  -- Agent In-Flight all block restore.
  IF v_caller IS NOT NULL THEN
    v_writable := check_node_writable(p_node_id, v_caller);
    IF (v_writable->>'writable')::BOOLEAN = FALSE THEN
      RETURN jsonb_build_object(
        'ok', false,
        'error', v_writable->>'blocker',
        'details', v_writable->'details'
      );
    END IF;
  END IF;

  -- Step 5: snapshot the current content into node_versions BEFORE
  -- overwriting. This preserves history additively per D8.
  -- (The M-035 BEFORE trigger only fires on UPDATE; the explicit
  -- INSERT here mirrors accept_agent_job's pattern in M-090.)
  INSERT INTO node_versions (
    node_id, organisation_id, version,
    summary, prose, notes, metadata,
    changed_by, change_reason
  ) VALUES (
    v_node.id, v_node.organisation_id, v_node.version,
    v_node.summary, v_node.prose, v_node.notes, v_node.metadata,
    COALESCE(v_caller::TEXT, 'system'),
    'pre_restore_snapshot'
  );

  -- Step 6: bump version + content_revision; overwrite content.
  -- Mirrors accept_agent_job's GUC pattern (M-036/090): set
  -- stelavox.bump_version='true' before the UPDATE so the BEFORE
  -- trigger bumps version (not just content_revision). The
  -- post-UPDATE INSERT in step 7 records the restore intent.
  PERFORM set_config('stelavox.bump_version', 'true', true);
  UPDATE nodes SET
    summary = v_target.summary,
    prose = v_target.prose,
    notes = v_target.notes,
    metadata = COALESCE(v_target.metadata, '{}'::jsonb)
  WHERE id = p_node_id
  RETURNING version INTO v_new_version;
  PERFORM set_config('stelavox.bump_version', 'false', true);

  -- Step 7: record the new "restored from v{N}" version row.
  -- The M-035 trigger only updates nodes.version + content_revision;
  -- it does NOT create node_versions rows (that's caller responsibility,
  -- matching the accept_agent_job pattern in M-090). Insert the new
  -- version snapshot here with the restore tag so VersionHistory can
  -- render "restored from v{N}" per Phase 6 wireframe §05 callout 15.
  INSERT INTO node_versions (
    node_id, organisation_id, version,
    summary, prose, notes, metadata,
    changed_by, change_reason
  ) VALUES (
    v_node.id, v_node.organisation_id, v_new_version,
    v_target.summary, v_target.prose, v_target.notes,
    COALESCE(v_target.metadata, '{}'::jsonb),
    COALESCE(v_caller::TEXT, 'system'),
    'restore_from_v' || p_target_version
  );

  RETURN jsonb_build_object(
    'ok', true,
    'new_version', v_new_version,
    'restored_from', p_target_version
  );
END;
$$;

GRANT EXECUTE ON FUNCTION restore_node_version(UUID, INTEGER, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION restore_node_version(UUID, INTEGER, INTEGER) TO service_role;

COMMENT ON FUNCTION restore_node_version(UUID, INTEGER, INTEGER) IS
  'Phase 6.C — restore a node to a prior version content. Additive (preserves history), content-only (rewrites summary/prose/notes/metadata; keeps name/tags/structure/lock/status), 409 on version conflict, gated by check_node_writable.';
