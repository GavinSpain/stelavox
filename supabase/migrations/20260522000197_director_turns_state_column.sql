-- M-197 — director_turns: add `state` column + backfill + triggers.
--
-- Apollo-grade state machine, Phase 0.A.7. 1:1 backfill from status.
--
-- Source: docs/stelavox_brief_orchestration_phase0_design_v1_0.md §1.director_turns.

BEGIN;

ALTER TABLE public.director_turns
  ADD COLUMN state TEXT;

COMMENT ON COLUMN public.director_turns.state IS
  'Single source of truth for director_turn lifecycle. State machine: see allowed_transitions WHERE entity_name=''director_turns''.';

UPDATE director_turns SET state = status;

DO $$
DECLARE v_bad INT;
BEGIN
  SELECT COUNT(*) INTO v_bad FROM director_turns
   WHERE state IS NULL
      OR state NOT IN ('in_progress','completed','failed','cancelled');
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'director_turns backfill: % bad rows', v_bad;
  END IF;
END;
$$;

ALTER TABLE public.director_turns
  ALTER COLUMN state SET NOT NULL,
  ADD CONSTRAINT director_turns_state_check
    CHECK (state IN ('in_progress','completed','failed','cancelled'));

CREATE TRIGGER trg_director_turns_enforce_transition
  BEFORE UPDATE OF state ON public.director_turns
  FOR EACH ROW
  WHEN (OLD.state IS DISTINCT FROM NEW.state)
  EXECUTE FUNCTION enforce_legal_transition();

CREATE OR REPLACE FUNCTION public.director_turns_auto_derive_state()
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

CREATE TRIGGER trg_director_turns_auto_derive_state
  BEFORE INSERT OR UPDATE ON public.director_turns
  FOR EACH ROW EXECUTE FUNCTION director_turns_auto_derive_state();

DO $$
DECLARE v_null INT;
BEGIN
  SELECT COUNT(*) INTO v_null FROM director_turns WHERE state IS NULL;
  IF v_null > 0 THEN
    RAISE EXCEPTION 'M-197: % director_turns rows with NULL state', v_null;
  END IF;
END;
$$;

COMMIT;
