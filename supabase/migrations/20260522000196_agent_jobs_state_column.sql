-- M-196 — agent_jobs: add `state` column + backfill + bidirectional triggers.
--
-- Apollo-grade state machine, Phase 0.A.6. Collapses the two-column
-- model (status + queue_status) into a single canonical `state` column.
-- The legacy columns are KEPT for now (auto-synced by trigger) and
-- dropped in Phase 0.D.
--
-- State set (9 values):
--   queued | dispatched | running | awaiting_accept |
--   accepted | dismissed | failed | crashed | cancelled
--
-- Note: `awaiting_accept` REPLACES the (status='completed',
-- queue_status='completed') tuple. Explicit name for "work done, awaiting
-- user Accept" — the source of the longest-running confusion in the
-- prior two-column model.
--
-- Backfill mapping (per phase0_design §6):
--   (pending, queued)             → queued
--   (pending, dispatched)         → dispatched   [transient]
--   (running, dispatched/running) → running
--   (completed, completed)        → awaiting_accept
--   (accepted, completed)         → accepted
--   (dismissed, completed)        → dismissed
--   (failed, failed)              → failed
--   (failed, crashed)             → crashed
--   (cancelled, cancelled)        → cancelled
--
-- Auto-derive trigger is BIDIRECTIONAL — see auto_derive_agent_jobs_state
-- function comment for details.
--
-- Source: docs/stelavox_brief_orchestration_phase0_design_v1_0.md §1.agent_jobs.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Add column
-- ---------------------------------------------------------------------------

ALTER TABLE public.agent_jobs
  ADD COLUMN state TEXT;

COMMENT ON COLUMN public.agent_jobs.state IS
  'Single source of truth for agent_job lifecycle (collapses legacy status+queue_status). State machine: see allowed_transitions WHERE entity_name=''agent_jobs''. ''awaiting_accept'' = work done, awaiting user Accept.';

-- ---------------------------------------------------------------------------
-- 2. Backfill
-- ---------------------------------------------------------------------------

UPDATE agent_jobs SET state = CASE
  WHEN status = 'pending'   AND queue_status = 'queued'       THEN 'queued'
  WHEN status = 'pending'   AND queue_status = 'dispatched'   THEN 'dispatched'
  WHEN status = 'running'   AND queue_status IN ('dispatched','running') THEN 'running'
  WHEN status = 'completed' AND queue_status = 'completed'    THEN 'awaiting_accept'
  WHEN status = 'accepted'  AND queue_status = 'completed'    THEN 'accepted'
  WHEN status = 'dismissed' AND queue_status = 'completed'    THEN 'dismissed'
  WHEN status = 'failed'    AND queue_status = 'failed'       THEN 'failed'
  WHEN status = 'failed'    AND queue_status = 'crashed'      THEN 'crashed'
  WHEN status = 'cancelled' AND queue_status = 'cancelled'    THEN 'cancelled'
  -- Defensive: any pre-existing zombies from before M-190's backfill.
  WHEN status = 'completed'                                   THEN 'awaiting_accept'
  WHEN status = 'accepted'                                    THEN 'accepted'
  WHEN status = 'dismissed'                                   THEN 'dismissed'
  WHEN status = 'failed'                                      THEN 'failed'
  WHEN status = 'cancelled'                                   THEN 'cancelled'
  ELSE NULL
END;

DO $$
DECLARE v_bad INT;
BEGIN
  SELECT COUNT(*) INTO v_bad FROM agent_jobs
   WHERE state IS NULL
      OR state NOT IN ('queued','dispatched','running','awaiting_accept',
                       'accepted','dismissed','failed','crashed','cancelled');
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'agent_jobs backfill: % bad rows. Investigate.', v_bad;
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. NOT NULL + CHECK
-- ---------------------------------------------------------------------------

ALTER TABLE public.agent_jobs
  ALTER COLUMN state SET NOT NULL,
  ADD CONSTRAINT agent_jobs_state_check
    CHECK (state IN ('queued','dispatched','running','awaiting_accept',
                     'accepted','dismissed','failed','crashed','cancelled'));

-- ---------------------------------------------------------------------------
-- 4. enforce_legal_transition trigger
-- ---------------------------------------------------------------------------

CREATE TRIGGER trg_agent_jobs_enforce_transition
  BEFORE UPDATE OF state ON public.agent_jobs
  FOR EACH ROW
  WHEN (OLD.state IS DISTINCT FROM NEW.state)
  EXECUTE FUNCTION enforce_legal_transition();

-- ---------------------------------------------------------------------------
-- 5. Bidirectional auto-derive
-- ---------------------------------------------------------------------------
-- Helper: state → (status, queue_status) and (status, queue_status) → state.
-- Single source of truth for the mapping.

CREATE OR REPLACE FUNCTION public.agent_jobs_derive_state(
  p_status TEXT, p_queue_status TEXT
) RETURNS TEXT
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  -- Terminal status values determine state regardless of queue_status
  -- (catches buggy legacy writers that updated status without queue_status —
  -- the G-06 class. The state machine still wins.)
  RETURN CASE
    WHEN p_status = 'accepted'  THEN 'accepted'
    WHEN p_status = 'dismissed' THEN 'dismissed'
    WHEN p_status = 'cancelled' THEN 'cancelled'
    WHEN p_status = 'failed'    THEN CASE WHEN p_queue_status = 'crashed' THEN 'crashed' ELSE 'failed' END
    WHEN p_status = 'completed' THEN 'awaiting_accept'
    WHEN p_status = 'running'   THEN 'running'
    WHEN p_status = 'pending'   THEN CASE WHEN p_queue_status = 'dispatched' THEN 'dispatched' ELSE 'queued' END
    ELSE 'queued'  -- defensive
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public.agent_jobs_legacy_columns_from_state(
  p_state TEXT, OUT out_status TEXT, OUT out_queue_status TEXT
)
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  CASE p_state
    WHEN 'queued'          THEN out_status := 'pending';   out_queue_status := 'queued';
    WHEN 'dispatched'      THEN out_status := 'pending';   out_queue_status := 'dispatched';
    WHEN 'running'         THEN out_status := 'running';   out_queue_status := 'running';
    WHEN 'awaiting_accept' THEN out_status := 'completed'; out_queue_status := 'completed';
    WHEN 'accepted'        THEN out_status := 'accepted';  out_queue_status := 'completed';
    WHEN 'dismissed'       THEN out_status := 'dismissed'; out_queue_status := 'completed';
    WHEN 'failed'          THEN out_status := 'failed';    out_queue_status := 'failed';
    WHEN 'crashed'         THEN out_status := 'failed';    out_queue_status := 'crashed';
    WHEN 'cancelled'       THEN out_status := 'cancelled'; out_queue_status := 'cancelled';
    ELSE out_status := NULL; out_queue_status := NULL;
  END CASE;
END;
$$;

-- Bidirectional sync. On INSERT or UPDATE:
--   * If the caller wrote state explicitly, derive status + queue_status.
--   * If the caller wrote status/queue_status but not state, derive state.
--   * If both written, trust the caller's state and ALSO sync the
--     legacy columns to that state (in case the caller's status/qs were
--     transient or stale).

CREATE OR REPLACE FUNCTION public.agent_jobs_auto_derive_state()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_derived_state TEXT;
  v_status_from_state TEXT;
  v_qs_from_state TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.state IS NOT NULL THEN
      -- Caller set state. Sync legacy columns.
      SELECT out_status, out_queue_status INTO v_status_from_state, v_qs_from_state
        FROM agent_jobs_legacy_columns_from_state(NEW.state);
      NEW.status       := v_status_from_state;
      NEW.queue_status := v_qs_from_state;
    ELSE
      -- Caller used legacy columns. Derive state.
      NEW.state := agent_jobs_derive_state(NEW.status, NEW.queue_status);
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE branch.
  IF NEW.state IS DISTINCT FROM OLD.state THEN
    -- Caller updated state directly. Sync legacy columns to match.
    SELECT out_status, out_queue_status INTO v_status_from_state, v_qs_from_state
      FROM agent_jobs_legacy_columns_from_state(NEW.state);
    NEW.status       := v_status_from_state;
    NEW.queue_status := v_qs_from_state;
  ELSIF (NEW.status      IS DISTINCT FROM OLD.status)
     OR (NEW.queue_status IS DISTINCT FROM OLD.queue_status) THEN
    -- Caller updated legacy columns only. Re-derive state and ALSO
    -- correct the legacy columns to be consistent with the derived
    -- state (this is what fixes G-06: caller wrote status='cancelled'
    -- only, queue_status stale → trigger normalises both to 'cancelled').
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

CREATE TRIGGER trg_agent_jobs_auto_derive_state
  BEFORE INSERT OR UPDATE ON public.agent_jobs
  FOR EACH ROW
  EXECUTE FUNCTION agent_jobs_auto_derive_state();

-- ---------------------------------------------------------------------------
-- 6. Verification
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_null INT;
  v_inconsistent INT;
BEGIN
  SELECT COUNT(*) INTO v_null FROM agent_jobs WHERE state IS NULL;
  IF v_null > 0 THEN
    RAISE EXCEPTION 'M-196: % agent_jobs rows with NULL state', v_null;
  END IF;

  -- After backfill the legacy columns may still drift; that's OK because
  -- the trigger normalises on next write. But the NEW state column must
  -- correctly derive from current legacy values.
  SELECT COUNT(*) INTO v_inconsistent FROM agent_jobs
   WHERE state <> agent_jobs_derive_state(status, queue_status);
  IF v_inconsistent > 0 THEN
    RAISE NOTICE 'M-196: % rows have state that doesn''t match derive(status, queue_status). Legacy drift; will normalise on next write.', v_inconsistent;
  END IF;
END;
$$;

COMMIT;
