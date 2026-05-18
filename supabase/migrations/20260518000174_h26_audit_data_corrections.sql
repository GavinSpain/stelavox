-- M-174 — H-26 audit data corrections (2026-05-18).
--
-- Companion to M-172 (word_count_actual trigger) and M-173 (depth trigger).
-- M-172/173 fix two derived-field-staleness instances by installing
-- maintenance triggers. M-174 cleans up the two pre-existing data drifts
-- the audit also surfaced — neither of which needs a new mechanism,
-- both are one-off corrections.
--
-- #14 — agent_jobs.model_id NULL on every director_iteration row
-- (67/67 completed jobs). The iteration runner had model_id in scope at
-- completion but didn't persist it; fixed in
-- lib/director/iteration-runner.ts on this same commit. New rows land
-- with model_id populated. The 67 existing rows need backfilling — every
-- director_config since v1.0 used `claude-haiku-4-5-20251001` so a
-- single value covers all of them. If a future config switches model,
-- backfill must reflect that; in 2026-05-18's audit it's a uniform fill.
--
-- #12 — director_turns.iteration_count off by 1 on turn `d6018da2`.
-- Root cause: iteration `2e45fcae` was cancelled via the legacy
-- `status` column only (queue_status stayed 'queued'), so the
-- rollup trigger never fired. The cancel-endpoint bug that produced
-- this was already fixed today on a separate commit; this data fix
-- aligns queue_status with the status column, which fires the existing
-- trigger and bumps iteration_count to match the row count.

-- ---------------------------------------------------------------------------
-- #14 — backfill agent_jobs.model_id for director_iteration rows
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_haiku TEXT := 'claude-haiku-4-5-20251001';
  v_distinct_count INTEGER;
  v_updated INTEGER;
BEGIN
  -- Sanity check: confirm every director_config seen so far used the
  -- same model. If a future migration introduces a config with a
  -- different model_id, this assumption breaks and the migration
  -- exits before writing wrong data.
  SELECT COUNT(DISTINCT model_id) INTO v_distinct_count
  FROM public.director_configs;

  IF v_distinct_count > 1 THEN
    RAISE EXCEPTION 'M-174 #14 backfill: director_configs has % distinct model_ids; uniform-fill assumption invalid. Backfill must time-window match instead', v_distinct_count;
  END IF;

  UPDATE public.agent_jobs
  SET model_id = v_haiku
  WHERE operation_type = 'director_iteration'
    AND model_id IS NULL
    AND cost_credits IS NOT NULL;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RAISE NOTICE 'M-174 #14: backfilled model_id on % director_iteration rows', v_updated;
END $$;

-- ---------------------------------------------------------------------------
-- #12 — fix iteration_count drift on turn d6018da2
-- ---------------------------------------------------------------------------
--
-- The drifted iteration's queue_status is 'queued' but status is
-- 'cancelled'. Updating queue_status to 'cancelled' fires
-- trg_director_turns_rollup_iteration which increments iteration_count
-- by 1 (from 5 to 6, matching the row count).

DO $$
DECLARE
  v_iter_id UUID;
  v_turn_id UUID;
  v_before INTEGER;
  v_after INTEGER;
BEGIN
  -- Find the half-cancelled iteration. Generic shape so the migration
  -- self-no-ops if the row was already corrected manually before this
  -- migration runs.
  SELECT id, director_turn_id
  INTO v_iter_id, v_turn_id
  FROM public.agent_jobs
  WHERE operation_type = 'director_iteration'
    AND status = 'cancelled'
    AND queue_status NOT IN ('cancelled', 'completed', 'failed', 'crashed', 'skipped')
  LIMIT 1;

  IF v_iter_id IS NULL THEN
    RAISE NOTICE 'M-174 #12: no half-cancelled iterations found — nothing to fix';
    RETURN;
  END IF;

  SELECT iteration_count INTO v_before FROM public.director_turns WHERE id = v_turn_id;

  UPDATE public.agent_jobs
  SET queue_status = 'cancelled',
      completed_at = COALESCE(completed_at, NOW())
  WHERE id = v_iter_id;

  SELECT iteration_count INTO v_after FROM public.director_turns WHERE id = v_turn_id;
  RAISE NOTICE 'M-174 #12: fixed iteration % on turn %; iteration_count % → %', v_iter_id, v_turn_id, v_before, v_after;
END $$;

-- ---------------------------------------------------------------------------
-- Sanity sweep
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_null_model INTEGER;
  v_iter_drift INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_null_model
  FROM public.agent_jobs
  WHERE operation_type = 'director_iteration'
    AND model_id IS NULL
    AND cost_credits IS NOT NULL;

  WITH t AS (
    SELECT dt.id, dt.iteration_count AS stored, COUNT(aj.id) AS actual
    FROM public.director_turns dt
    LEFT JOIN public.agent_jobs aj ON aj.director_turn_id = dt.id
    GROUP BY dt.id, dt.iteration_count
  )
  SELECT COUNT(*) INTO v_iter_drift FROM t WHERE stored <> actual;

  IF v_null_model > 0 THEN
    RAISE EXCEPTION 'M-174 sanity: % director_iteration rows still have NULL model_id after backfill', v_null_model;
  END IF;
  IF v_iter_drift > 0 THEN
    RAISE EXCEPTION 'M-174 sanity: % director_turns still drift on iteration_count', v_iter_drift;
  END IF;

  RAISE NOTICE 'M-174 sanity: all H-26 audit drifts cleared (model_id, iteration_count)';
END $$;
