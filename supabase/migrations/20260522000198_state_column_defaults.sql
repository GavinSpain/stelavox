-- M-198 — add DEFAULT to each state column so existing INSERT call sites
-- (which don't yet pass `state`) keep compiling and behaving correctly.
--
-- The DEFAULT is the typical "initial INSERT" state. For INSERTs that
-- specify legacy columns indicating a non-initial state (e.g.
-- status='completed' specified explicitly), the auto-derive trigger
-- overrides the DEFAULT with the derived value.
--
-- TypeScript: with DEFAULTs in place, `supabase gen types` marks the
-- state column as optional on Insert. Existing call sites compile.
-- Phase 0.B will migrate writers to specify `state` directly (and may
-- DROP the DEFAULTs at that point).

BEGIN;

ALTER TABLE public.briefs          ALTER COLUMN state SET DEFAULT 'active';
ALTER TABLE public.brief_stages    ALTER COLUMN state SET DEFAULT 'planned';
ALTER TABLE public.workflows       ALTER COLUMN state SET DEFAULT 'draft';
ALTER TABLE public.workflow_steps  ALTER COLUMN state SET DEFAULT 'pending';
ALTER TABLE public.agent_jobs      ALTER COLUMN state SET DEFAULT 'queued';
ALTER TABLE public.director_turns  ALTER COLUMN state SET DEFAULT 'in_progress';

-- Patch the agent_jobs auto-derive trigger to detect "state matches
-- DEFAULT but legacy columns indicate something else" and override.
-- This is the common path for legacy INSERTs that pass status='completed'
-- (etc.) without specifying state.

CREATE OR REPLACE FUNCTION public.agent_jobs_auto_derive_state()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_derived_state TEXT;
  v_status_from_state TEXT;
  v_qs_from_state TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- On INSERT, the DEFAULT for state has already been applied if the
    -- caller didn't specify state. Detect "DEFAULT applied vs caller
    -- specified" by computing what state should be given the legacy
    -- columns. If they disagree AND state is the table DEFAULT, the
    -- caller is using the legacy two-column model — override state.
    v_derived_state := agent_jobs_derive_state(NEW.status, NEW.queue_status);
    IF NEW.state = 'queued' AND v_derived_state <> 'queued' THEN
      -- DEFAULT applied; legacy columns indicate a different state.
      NEW.state := v_derived_state;
    END IF;
    -- Sync legacy columns from final state (handles the new-code path
    -- where caller specifies state directly).
    SELECT out_status, out_queue_status INTO v_status_from_state, v_qs_from_state
      FROM agent_jobs_legacy_columns_from_state(NEW.state);
    NEW.status       := v_status_from_state;
    NEW.queue_status := v_qs_from_state;
    RETURN NEW;
  END IF;

  -- UPDATE branch (unchanged from M-196).
  IF NEW.state IS DISTINCT FROM OLD.state THEN
    SELECT out_status, out_queue_status INTO v_status_from_state, v_qs_from_state
      FROM agent_jobs_legacy_columns_from_state(NEW.state);
    NEW.status       := v_status_from_state;
    NEW.queue_status := v_qs_from_state;
  ELSIF (NEW.status      IS DISTINCT FROM OLD.status)
     OR (NEW.queue_status IS DISTINCT FROM OLD.queue_status) THEN
    v_derived_state := agent_jobs_derive_state(NEW.status, NEW.queue_status);
    IF v_derived_state <> OLD.state THEN
      NEW.state := v_derived_state;
      SELECT out_status, out_queue_status INTO v_status_from_state, v_qs_from_state
        FROM agent_jobs_legacy_columns_from_state(v_derived_state);
      NEW.status       := v_status_from_state;
      NEW.queue_status := v_qs_from_state;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Similar pattern for brief_stages (which has workflow_id as the
-- discriminator between 'planned' and 'ready'). On INSERT, if state is
-- 'planned' (the DEFAULT) but workflow_id is set, override to 'ready'.

CREATE OR REPLACE FUNCTION public.brief_stages_auto_derive_state()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_derived TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_derived := brief_stages_derive_state(NEW.status, NEW.workflow_id, NEW.prompt);
    -- If state is at the DEFAULT but derive() suggests otherwise, override.
    IF NEW.state = 'planned' AND v_derived <> 'planned' THEN
      NEW.state := v_derived;
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
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

-- briefs, workflows, workflow_steps, director_turns: legacy columns
-- are 1:1 with state. The simpler auto-derive logic already works:
-- if status differs from default ('pending' for workflow_steps, etc.)
-- the trigger overrides on INSERT.
--
-- Verify by amending each to handle the DEFAULT case the same way.

CREATE OR REPLACE FUNCTION public.briefs_auto_derive_state()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.state = 'active' AND NEW.status IS NOT NULL AND NEW.status <> 'active' THEN
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

CREATE OR REPLACE FUNCTION public.workflows_auto_derive_state()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.state = 'draft' AND NEW.status IS NOT NULL AND NEW.status <> 'draft' THEN
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

CREATE OR REPLACE FUNCTION public.workflow_steps_auto_derive_state()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.state = 'pending' AND NEW.status IS NOT NULL AND NEW.status <> 'pending' THEN
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

CREATE OR REPLACE FUNCTION public.director_turns_auto_derive_state()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.state = 'in_progress' AND NEW.status IS NOT NULL AND NEW.status <> 'in_progress' THEN
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

COMMIT;
