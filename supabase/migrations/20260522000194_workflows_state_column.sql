-- M-194 — workflows: add `state` column + backfill + triggers.
--
-- Apollo-grade state machine, Phase 0.A.4. The status column on
-- workflows already uses the canonical names (draft/approved/running/
-- paused/completed/cancelled), so backfill is 1:1.
--
-- Source: docs/stelavox_brief_orchestration_phase0_design_v1_0.md §1.workflows.

BEGIN;

ALTER TABLE public.workflows
  ADD COLUMN state TEXT;

COMMENT ON COLUMN public.workflows.state IS
  'Single source of truth for workflow lifecycle. State machine: see allowed_transitions WHERE entity_name=''workflows''.';

UPDATE workflows SET state = status;

DO $$
DECLARE v_bad INT;
BEGIN
  SELECT COUNT(*) INTO v_bad FROM workflows
   WHERE state IS NULL
      OR state NOT IN ('draft','approved','running','paused','completed','cancelled');
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'workflows backfill: % bad rows', v_bad;
  END IF;
END;
$$;

ALTER TABLE public.workflows
  ALTER COLUMN state SET NOT NULL,
  ADD CONSTRAINT workflows_state_check
    CHECK (state IN ('draft','approved','running','paused','completed','cancelled'));

CREATE TRIGGER trg_workflows_enforce_transition
  BEFORE UPDATE OF state ON public.workflows
  FOR EACH ROW
  WHEN (OLD.state IS DISTINCT FROM NEW.state)
  EXECUTE FUNCTION enforce_legal_transition();

CREATE OR REPLACE FUNCTION public.workflows_auto_derive_state()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.state IS NULL AND NEW.status IS NOT NULL THEN
      NEW.state := NEW.status;
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.status IS DISTINCT FROM OLD.status
       AND NEW.state IS NOT DISTINCT FROM OLD.state THEN
      NEW.state := NEW.status;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_workflows_auto_derive_state
  BEFORE INSERT OR UPDATE ON public.workflows
  FOR EACH ROW EXECUTE FUNCTION workflows_auto_derive_state();

DO $$
DECLARE v_null INT;
BEGIN
  SELECT COUNT(*) INTO v_null FROM workflows WHERE state IS NULL;
  IF v_null > 0 THEN
    RAISE EXCEPTION 'M-194: % workflows rows with NULL state', v_null;
  END IF;
END;
$$;

COMMIT;
