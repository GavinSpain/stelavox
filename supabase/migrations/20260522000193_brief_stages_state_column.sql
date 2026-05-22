-- M-193 — brief_stages: add `state` column + backfill + triggers.
--
-- Apollo-grade state machine, Phase 0.A.3. Adds the new `'ready'` state
-- (Q2 in the spec) to distinguish "workflow attached, awaiting run"
-- from "no workflow yet" — eliminating the planning→planned round-trip
-- overload that confused the prior model.
--
-- Backfill mapping (from current legacy columns):
--   status='planned'  AND workflow_id IS NULL  → state='planned'
--   status='planned'  AND workflow_id NOT NULL → state='ready'
--   status='planning'                          → state='planning'
--   status='completed'                         → state='completed'
--   status='cancelled'                         → state='cancelled'
--
-- The 'failed' state has no legacy equivalent; populated only by new
-- code paths in Phase 5 (Director expected-output check).
--
-- Source: docs/stelavox_brief_orchestration_phase0_design_v1_0.md §1.brief_stages.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Add column
-- ---------------------------------------------------------------------------

ALTER TABLE public.brief_stages
  ADD COLUMN state TEXT;

COMMENT ON COLUMN public.brief_stages.state IS
  'Single source of truth for brief_stage lifecycle. State machine: see allowed_transitions WHERE entity_name=''brief_stages''. New ''ready'' state (Q2) distinguishes workflow-attached from no-workflow-yet.';

-- ---------------------------------------------------------------------------
-- 2. Backfill
-- ---------------------------------------------------------------------------

UPDATE brief_stages SET state = CASE
  WHEN status = 'planned'   AND workflow_id IS NULL     THEN 'planned'
  WHEN status = 'planned'   AND workflow_id IS NOT NULL THEN 'ready'
  WHEN status = 'planning'                              THEN 'planning'
  WHEN status = 'completed'                             THEN 'completed'
  WHEN status = 'cancelled'                             THEN 'cancelled'
  ELSE NULL  -- triggers verification error below
END;

DO $$
DECLARE
  v_bad INT;
BEGIN
  SELECT COUNT(*) INTO v_bad FROM brief_stages
   WHERE state IS NULL
      OR state NOT IN ('planned','planning','ready','completed','cancelled','failed');
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'brief_stages backfill failed: % rows with NULL or out-of-set state. Dead legacy values "approved"/"scheduled" found?', v_bad;
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. NOT NULL + CHECK
-- ---------------------------------------------------------------------------

ALTER TABLE public.brief_stages
  ALTER COLUMN state SET NOT NULL,
  ADD CONSTRAINT brief_stages_state_check
    CHECK (state IN ('planned','planning','ready','completed','cancelled','failed'));

-- ---------------------------------------------------------------------------
-- 4. enforce_legal_transition trigger
-- ---------------------------------------------------------------------------

CREATE TRIGGER trg_brief_stages_enforce_transition
  BEFORE UPDATE OF state ON public.brief_stages
  FOR EACH ROW
  WHEN (OLD.state IS DISTINCT FROM NEW.state)
  EXECUTE FUNCTION enforce_legal_transition();

-- ---------------------------------------------------------------------------
-- 5. auto_derive_state trigger
-- ---------------------------------------------------------------------------
-- More complex than briefs because brief_stages derives state from a
-- COMBINATION of (status, workflow_id). When a legacy writer:
--   * INSERTs a row (status='planned', workflow_id NULL, prompt set) —
--     state should be 'planned'.
--   * UPDATEs workflow_id (the brief-approve route does this to attach
--     a workflow to stage 1) — state should flip 'planned'→'ready'.
--   * UPDATEs status='completed' — state should become 'completed'.
--
-- We compute a "derived state" from current row values and apply it
-- when the writer left state untouched.

CREATE OR REPLACE FUNCTION public.brief_stages_derive_state(
  p_status      TEXT,
  p_workflow_id UUID,
  p_prompt      TEXT
) RETURNS TEXT
LANGUAGE plpgsql IMMUTABLE
AS $$
BEGIN
  RETURN CASE
    WHEN p_status = 'planned' AND p_workflow_id IS NOT NULL THEN 'ready'
    WHEN p_status = 'planned'                               THEN 'planned'
    WHEN p_status = 'planning'                              THEN 'planning'
    WHEN p_status = 'completed'                             THEN 'completed'
    WHEN p_status = 'cancelled'                             THEN 'cancelled'
    ELSE 'planned'  -- defensive default for unknown legacy values
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public.brief_stages_auto_derive_state()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_derived TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.state IS NULL THEN
      NEW.state := brief_stages_derive_state(NEW.status, NEW.workflow_id, NEW.prompt);
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    -- If state was NOT explicitly set by the caller (unchanged from OLD)
    -- but status or workflow_id changed, re-derive.
    IF NEW.state IS NOT DISTINCT FROM OLD.state
       AND (NEW.status      IS DISTINCT FROM OLD.status
         OR NEW.workflow_id IS DISTINCT FROM OLD.workflow_id) THEN
      v_derived := brief_stages_derive_state(NEW.status, NEW.workflow_id, NEW.prompt);
      IF v_derived <> OLD.state THEN
        NEW.state := v_derived;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_brief_stages_auto_derive_state
  BEFORE INSERT OR UPDATE ON public.brief_stages
  FOR EACH ROW
  EXECUTE FUNCTION brief_stages_auto_derive_state();

-- ---------------------------------------------------------------------------
-- 6. Verification
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_null INT;
BEGIN
  SELECT COUNT(*) INTO v_null FROM brief_stages WHERE state IS NULL;
  IF v_null > 0 THEN
    RAISE EXCEPTION 'M-193: % brief_stages rows still have NULL state', v_null;
  END IF;
END;
$$;

COMMIT;
