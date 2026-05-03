-- Migration 023 — Version-bump trigger on content-field UPDATE
-- Phase 2 task T-1.3
-- Spec: stelavox_phase2_api_contract_v1_0.md §1.4
--       stelavox_phase2_test_plan_v1_0.md TC-A-44, TC-A-45, TC-A-46, TC-A-47
--
-- BEFORE UPDATE trigger on nodes that increments version when at least one of
-- summary, prose, notes, metadata changes (IS DISTINCT FROM, so NULL ↔ value
-- transitions count; jsonb metadata uses semantic equality). Non-content
-- updates (rename, status, target, instruction, lock state, parent_id /
-- order / depth, etc.) leave version untouched. A single PATCH that changes
-- both name and summary fires the trigger once and bumps version by exactly 1
-- (TC-A-46: rename + summary in one statement → version advances by 1).
--
-- The ELSE branch explicitly forces NEW.version := OLD.version. This makes
-- version strictly server-controlled: even an UPDATE that mistakenly sets
-- version itself is overridden. The PATCH /api/nodes/[id] route already
-- forbids the version field on the request body (API Contract §2.5); this
-- trigger codifies the same invariant at the row layer.
--
-- Migration number 022 is intentionally skipped — reserved gap per
-- API Contract §1.4 (clean-slate pre-launch; no rename/backfill needed).
--
-- The function is SECURITY INVOKER (default) — it only mutates NEW, so it
-- does not need elevated privileges. Matches the M-012 trg_attachment_count
-- pattern. SET search_path = public is included as defensive practice
-- against same-named function shadowing in the caller's search_path.

CREATE OR REPLACE FUNCTION bump_node_version_on_content_change()
RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.summary  IS DISTINCT FROM OLD.summary
     OR NEW.prose IS DISTINCT FROM OLD.prose
     OR NEW.notes IS DISTINCT FROM OLD.notes
     OR NEW.metadata IS DISTINCT FROM OLD.metadata THEN
    NEW.version := OLD.version + 1;
  ELSE
    NEW.version := OLD.version;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_node_version_bump
BEFORE UPDATE ON nodes
FOR EACH ROW
EXECUTE FUNCTION bump_node_version_on_content_change();
