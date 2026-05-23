-- M-202 — bidirectional auto-derive across all entities.
--
-- Discovered via the Apollo capsule Playwright test (CK-A1..CK-A5):
-- the auto-derive triggers from M-192..M-198 only synced one direction
-- (legacy status → new state). When new code writes state directly,
-- legacy status stays stale — which BREAKS the partial unique index
-- `briefs_strict_one_active_per_document_uidx` because the index
-- predicate is `status IN ('planned','active')`. A cancelled brief
-- (state='cancelled', status='active') still occupies an index slot.
--
-- M-198 already fixed agent_jobs to be bidirectional. This migration
-- adds the same to briefs, brief_stages, workflows, workflow_steps,
-- director_turns. Plus a one-off backfill to fix rows that were
-- mid-migration when the test surfaced the gap.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Briefs — bidirectional
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.briefs_auto_derive_state()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.state = 'active' AND NEW.status IS NOT NULL AND NEW.status <> 'active' THEN
      NEW.state := NEW.status;
    END IF;
    NEW.status := NEW.state;
    RETURN NEW;
  END IF;
  IF NEW.state IS DISTINCT FROM OLD.state THEN
    NEW.status := NEW.state;
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.state := NEW.status;
  END IF;
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. Workflows — bidirectional
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.workflows_auto_derive_state()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.state = 'draft' AND NEW.status IS NOT NULL AND NEW.status <> 'draft' THEN
      NEW.state := NEW.status;
    END IF;
    NEW.status := NEW.state;
    RETURN NEW;
  END IF;
  IF NEW.state IS DISTINCT FROM OLD.state THEN
    NEW.status := NEW.state;
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.state := NEW.status;
  END IF;
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. Workflow_steps — bidirectional
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.workflow_steps_auto_derive_state()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.state = 'pending' AND NEW.status IS NOT NULL AND NEW.status <> 'pending' THEN
      NEW.state := NEW.status;
    END IF;
    NEW.status := NEW.state;
    RETURN NEW;
  END IF;
  IF NEW.state IS DISTINCT FROM OLD.state THEN
    NEW.status := NEW.state;
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.state := NEW.status;
  END IF;
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. Director_turns — bidirectional
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.director_turns_auto_derive_state()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.state = 'in_progress' AND NEW.status IS NOT NULL AND NEW.status <> 'in_progress' THEN
      NEW.state := NEW.status;
    END IF;
    NEW.status := NEW.state;
    RETURN NEW;
  END IF;
  IF NEW.state IS DISTINCT FROM OLD.state THEN
    NEW.status := NEW.state;
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.state := NEW.status;
  END IF;
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. Brief_stages — bidirectional (more complex due to legacy 4-value status vs new 6-value state)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.brief_stages_auto_derive_state()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_derived TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_derived := brief_stages_derive_state(NEW.status, NEW.workflow_id, NEW.prompt);
    IF NEW.state = 'planned' AND v_derived <> 'planned' THEN
      NEW.state := v_derived;
    END IF;
    NEW.status := CASE NEW.state
      WHEN 'planned'   THEN 'planned'
      WHEN 'planning'  THEN 'planning'
      WHEN 'ready'     THEN 'planned'    -- legacy 'planned' covers both planned + ready
      WHEN 'completed' THEN 'completed'
      WHEN 'cancelled' THEN 'cancelled'
      WHEN 'failed'    THEN 'cancelled'  -- legacy has no 'failed'; collapse to cancelled
      ELSE NEW.status
    END;
    RETURN NEW;
  END IF;

  IF NEW.state IS DISTINCT FROM OLD.state THEN
    NEW.status := CASE NEW.state
      WHEN 'planned'   THEN 'planned'
      WHEN 'planning'  THEN 'planning'
      WHEN 'ready'     THEN 'planned'
      WHEN 'completed' THEN 'completed'
      WHEN 'cancelled' THEN 'cancelled'
      WHEN 'failed'    THEN 'cancelled'
      ELSE NEW.status
    END;
  ELSIF (NEW.status IS DISTINCT FROM OLD.status OR NEW.workflow_id IS DISTINCT FROM OLD.workflow_id) THEN
    v_derived := brief_stages_derive_state(NEW.status, NEW.workflow_id, NEW.prompt);
    IF v_derived <> OLD.state THEN NEW.state := v_derived; END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. Backfill — rows with state/status disagreement from M-192..M-198 era.
-- ---------------------------------------------------------------------------
-- The discriminator: `state` is the new source of truth (per M-192..M-197
-- bool-CHECK constraints); `status` should mirror it. Sync legacy to new.

UPDATE briefs SET status = state WHERE status <> state;

UPDATE brief_stages SET status = CASE state
  WHEN 'planned'   THEN 'planned'
  WHEN 'planning'  THEN 'planning'
  WHEN 'ready'     THEN 'planned'
  WHEN 'completed' THEN 'completed'
  WHEN 'cancelled' THEN 'cancelled'
  WHEN 'failed'    THEN 'cancelled'
  ELSE status
END
WHERE status <> CASE state
  WHEN 'planned'   THEN 'planned'
  WHEN 'planning'  THEN 'planning'
  WHEN 'ready'     THEN 'planned'
  WHEN 'completed' THEN 'completed'
  WHEN 'cancelled' THEN 'cancelled'
  WHEN 'failed'    THEN 'cancelled'
  ELSE status
END;

UPDATE workflows SET status = state WHERE status <> state;
UPDATE workflow_steps SET status = state WHERE status <> state;
UPDATE director_turns SET status = state WHERE status <> state;

COMMIT;
