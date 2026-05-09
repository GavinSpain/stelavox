-- Migration 035 — separate content_revision (autosave anchor) from version (semantic checkpoint)
-- Source: SU-J14-1 (docs/stelavox_phase5d_su_j14_1_version_semantics.md)
--
-- Phase 2's bump_node_version_on_content_change() trigger bumped `version`
-- on every content-changing UPDATE. Autosave produces such an UPDATE every
-- 1.5s of typing, so `version` accumulated noise. The agent_jobs concurrency
-- gate (target_node_version_at_capture) and the VersionHistory surface both
-- treated `version` as a semantic checkpoint, but the field's actual
-- semantics were "every keystroke saves a version."
--
-- This migration splits the field:
--   `content_revision` — increments on every content change (autosave anchor)
--   `version`          — increments only on agent Accept (synthesise / refine /
--                        generate_context) and future user "Save as version"
--
-- Callers that want a version bump set the session GUC `stelavox.bump_version`
-- to 'true' before the UPDATE. Default behaviour: content_revision bumps,
-- version stays.

ALTER TABLE nodes
  ADD COLUMN content_revision INTEGER NOT NULL DEFAULT 0;

-- Backfill: content_revision starts equal to version for existing rows.
UPDATE nodes SET content_revision = version;

-- Same shape on node_versions snapshots so VersionHistory keeps its anchor.
-- (Existing snapshots remain valid; this just records the revision at the
-- time the snapshot was taken.)
ALTER TABLE node_versions
  ADD COLUMN content_revision INTEGER;

UPDATE node_versions SET content_revision = version;

-- Rewrite the trigger.
CREATE OR REPLACE FUNCTION bump_node_version_on_content_change()
RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_should_bump_version BOOLEAN;
BEGIN
  -- The session GUC is unset by default; current_setting('...', true) returns
  -- empty string in that case, which COALESCE turns into NULL → FALSE.
  BEGIN
    v_should_bump_version := COALESCE(
      NULLIF(current_setting('stelavox.bump_version', true), '')::boolean,
      FALSE
    );
  EXCEPTION WHEN OTHERS THEN
    v_should_bump_version := FALSE;
  END;

  IF NEW.summary  IS DISTINCT FROM OLD.summary
     OR NEW.prose IS DISTINCT FROM OLD.prose
     OR NEW.notes IS DISTINCT FROM OLD.notes
     OR NEW.metadata IS DISTINCT FROM OLD.metadata THEN
    -- Always bump content_revision on content change.
    NEW.content_revision := COALESCE(OLD.content_revision, 0) + 1;
    IF v_should_bump_version THEN
      NEW.version := OLD.version + 1;
    ELSE
      -- Force NEW.version := OLD.version even if the caller mistakenly
      -- set it themselves. Migration 023's invariant remains: version is
      -- strictly server-controlled.
      NEW.version := OLD.version;
    END IF;
  ELSE
    NEW.content_revision := OLD.content_revision;
    NEW.version := OLD.version;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON COLUMN nodes.content_revision IS
  'Always-current durability anchor. Bumps on every content-changing UPDATE. '
  'Used for autosave concurrency. SU-J14-1.';

COMMENT ON COLUMN nodes.version IS
  'Semantic checkpoint. Bumps only when caller opts in via SET LOCAL '
  'stelavox.bump_version = ''true''. Used for agent_jobs.target_node_version_'
  'at_capture and VersionHistory snapshots. SU-J14-1.';

COMMENT ON FUNCTION bump_node_version_on_content_change() IS
  'BEFORE UPDATE trigger on nodes. Bumps content_revision on any content '
  'change; bumps version only when the GUC stelavox.bump_version is set to '
  'true (e.g., from inside accept_agent_job RPC).';
