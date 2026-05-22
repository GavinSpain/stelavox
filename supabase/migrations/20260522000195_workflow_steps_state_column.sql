-- M-195 — workflow_steps: add `state` column + backfill + triggers.
--
-- Apollo-grade state machine, Phase 0.A.5. 1:1 backfill from status.
--
-- Source: docs/stelavox_brief_orchestration_phase0_design_v1_0.md §1.workflow_steps.

BEGIN;

ALTER TABLE public.workflow_steps
  ADD COLUMN state TEXT;

COMMENT ON COLUMN public.workflow_steps.state IS
  'Single source of truth for workflow_step lifecycle. State machine: see allowed_transitions WHERE entity_name=''workflow_steps''.';

UPDATE workflow_steps SET state = status;

DO $$
DECLARE v_bad INT;
BEGIN
  SELECT COUNT(*) INTO v_bad FROM workflow_steps
   WHERE state IS NULL
      OR state NOT IN ('pending','running','completed','failed','skipped','removed');
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'workflow_steps backfill: % bad rows', v_bad;
  END IF;
END;
$$;

ALTER TABLE public.workflow_steps
  ALTER COLUMN state SET NOT NULL,
  ADD CONSTRAINT workflow_steps_state_check
    CHECK (state IN ('pending','running','completed','failed','skipped','removed'));

CREATE TRIGGER trg_workflow_steps_enforce_transition
  BEFORE UPDATE OF state ON public.workflow_steps
  FOR EACH ROW
  WHEN (OLD.state IS DISTINCT FROM NEW.state)
  EXECUTE FUNCTION enforce_legal_transition();

CREATE OR REPLACE FUNCTION public.workflow_steps_auto_derive_state()
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

CREATE TRIGGER trg_workflow_steps_auto_derive_state
  BEFORE INSERT OR UPDATE ON public.workflow_steps
  FOR EACH ROW EXECUTE FUNCTION workflow_steps_auto_derive_state();

DO $$
DECLARE v_null INT;
BEGIN
  SELECT COUNT(*) INTO v_null FROM workflow_steps WHERE state IS NULL;
  IF v_null > 0 THEN
    RAISE EXCEPTION 'M-195: % workflow_steps rows with NULL state', v_null;
  END IF;
END;
$$;

COMMIT;
