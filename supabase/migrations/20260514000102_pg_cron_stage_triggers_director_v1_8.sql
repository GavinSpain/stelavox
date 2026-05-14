-- Migration 102 — V1.x-B.1.1 session 3a:
--   1. Install pg_cron extension + schedule M-099 sweep procedures.
--   2. Add evaluate_ready_stage_triggers() SQL procedure + cron schedule.
--   3. Director config v1.8 — adds trigger_config example block (FU-2 fix
--      for the Director self-correction loop the user hit during testing
--      against the "create scenes and the beats for the first scene" prompt).
--
-- Source: stelavox_v1x_b_1_1_build_checklist_v1_0.md §3.1 T-1.9 (cron install)
--         + Director Architecture v2.0 §8.4 (scheduler-invokes-Director-on-stage-triggers)
--         + project_v1x_b_1_1_followups.md FU-2.

-- ---------------------------------------------------------------------------
-- 1. pg_cron install
-- ---------------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS pg_cron;

-- M-099 sweep procedures: schedule both at 30-second cadence (default
-- per platform_config defaults seeded in M-101).
SELECT cron.schedule(
  'scheduler_sweep_throttle_reservations',
  '30 seconds',
  $$SELECT scheduler_sweep_throttle_reservations();$$
);

SELECT cron.schedule(
  'scheduler_sweep_interrupted_iterations',
  '30 seconds',
  $$SELECT scheduler_sweep_interrupted_iterations(60);$$
);

-- ---------------------------------------------------------------------------
-- 2. evaluate_ready_stage_triggers() — find ready after_stage triggers.
-- ---------------------------------------------------------------------------
-- Walks brief_stages where:
--   - stage.status = 'planned'
--   - stage.trigger_type = 'after_stage'
--   - the referenced predecessor stage is in status='completed'
--   - the parent brief is in status='active'
-- For each, marks the stage 'proposing' (Director Arch v2.0 §8.4 step 1)
-- and inserts a stage_trigger_fired system event into the document's
-- most-recent conversation. This makes the trigger visible to the
-- Director on its next conversational turn.
--
-- Session 3a scope: pull-model (Director sees the trigger on next user
-- engagement). Session 3b adds the push-model — a system-initiated
-- Director iteration job enqueued automatically from this evaluator.
--
-- The procedure is idempotent: a stage already in 'proposing' or
-- 'approved' or beyond is skipped. Multiple invocations within a
-- single window emit at most one event per stage.
--
-- Returns the count of triggers fired.

CREATE OR REPLACE FUNCTION evaluate_ready_stage_triggers()
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_fired INTEGER := 0;
  v_stage RECORD;
  v_predecessor_completed BOOLEAN;
  v_predecessor_order INTEGER;
  v_brief RECORD;
BEGIN
  FOR v_stage IN
    SELECT bs.id, bs.brief_id, bs."order" AS stage_order, bs.title,
           bs.trigger_type, bs.trigger_config
    FROM brief_stages bs
    JOIN briefs b ON b.id = bs.brief_id
    WHERE bs.status = 'planned'
      AND bs.trigger_type = 'after_stage'
      AND b.status = 'active'
  LOOP
    v_predecessor_order := NULLIF(v_stage.trigger_config->>'after_stage_order', '')::INTEGER;
    IF v_predecessor_order IS NULL THEN
      CONTINUE;  -- malformed trigger_config; skip without firing
    END IF;

    -- Predecessor must exist on the same brief and be in 'completed'.
    SELECT EXISTS (
      SELECT 1 FROM brief_stages
      WHERE brief_id = v_stage.brief_id
        AND "order" = v_predecessor_order
        AND status = 'completed'
    ) INTO v_predecessor_completed;

    IF NOT v_predecessor_completed THEN
      CONTINUE;
    END IF;

    -- Mark the stage proposing.
    UPDATE brief_stages
    SET status = 'proposing'
    WHERE id = v_stage.id AND status = 'planned';

    -- Emit the system event. Need brief.document_id for routing.
    SELECT document_id INTO v_brief
    FROM briefs WHERE id = v_stage.brief_id;

    PERFORM _emit_system_event(
      v_brief.document_id,
      'stage_trigger_fired',
      jsonb_build_object(
        'brief_id',     v_stage.brief_id,
        'stage_id',     v_stage.id,
        'stage_order',  v_stage.stage_order,
        'stage_title',  v_stage.title
      ),
      'scheduler_trigger',
      format('Stage %s "%s" trigger fired — Director should plan its workflow.',
             v_stage.stage_order, v_stage.title)
    );

    v_fired := v_fired + 1;
  END LOOP;

  RETURN v_fired;
END;
$$;

REVOKE ALL ON FUNCTION evaluate_ready_stage_triggers() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION evaluate_ready_stage_triggers() TO service_role;

-- Schedule the evaluator at 30-second cadence (matches scheduler.tick_interval_ms
-- ~order-of-magnitude; we use 30s rather than 1s because pg_cron's minimum
-- granularity is 1 second and we want headroom). Session 3b's TypeScript
-- dispatcher may invoke the evaluator more frequently.
SELECT cron.schedule(
  'evaluate_ready_stage_triggers',
  '30 seconds',
  $$SELECT evaluate_ready_stage_triggers();$$
);

-- ---------------------------------------------------------------------------
-- 3. Director config v1.8 — FU-2: trigger_config example block.
-- ---------------------------------------------------------------------------
-- v1.7 system prompt mentioned trigger_config exactly once with no
-- example for the after_stage_order field shape. The Director's first
-- propose_brief attempt during the user's manual test failed with
-- 'invalid_trigger_config: stage 2 after_stage missing after_stage_order'.
-- Self-corrected via the validator's structured error, but cost ~3s + an
-- extra tool call.
--
-- v1.8 adds an explicit block under "Brief structure" showing the
-- shape for each trigger_type. tool_suite + model_id unchanged.

UPDATE director_configs
SET status = 'deprecated', deprecated_at = NOW()
WHERE version_number = '1.7' AND status = 'production';

INSERT INTO director_configs (
  version_number,
  display_name,
  status,
  system_prompt,
  tool_suite,
  model_id,
  model_params,
  capability_flags,
  release_notes
)
SELECT
  '1.8',
  'Director v1.8 — trigger_config example block',
  'production',
  -- The v1.8 prompt = v1.7 prompt with one targeted insertion.
  -- We surgical-replace the section header that introduces stages,
  -- adding a fenced trigger_config reference block right after.
  REPLACE(
    system_prompt,
    'Each stage has:
- **order** — 1-indexed.
- **title, description**.
- **trigger_type** — `manual` / `after_stage` / `scheduled_at` / `compound`. Stage 1 is typically `manual`; later stages `after_stage:N-1`.
- **trigger_config** — JSONB.',
    'Each stage has:
- **order** — 1-indexed.
- **title, description**.
- **trigger_type** — `manual` / `after_stage` / `scheduled_at` / `compound`. Stage 1 is typically `manual`; later stages `after_stage:N-1`.
- **trigger_config** — JSONB. Shape varies by trigger_type:
  - `manual` → `{}`
  - `after_stage` → `{ "after_stage_order": <N> }` (N = the predecessor stage order this depends on)
  - `scheduled_at` → `{ "scheduled_at": "<ISO 8601 timestamp>" }`
  - `compound` → `{ "conditions": [{ "type": "after_stage", "after_stage_order": <N> }, { "type": "scheduled_at", "scheduled_at": "<ISO 8601>" }] }`

  Always populate trigger_config with the matching fields when trigger_type is not `manual`. The validator rejects after_stage triggers without after_stage_order.'
  ),
  tool_suite,
  model_id,
  model_params,
  capability_flags,
  'V1.x-B.1.1 (v1.8) — FU-2 fix for trigger_config example. The v1.7 prompt had no example showing the after_stage_order field shape inside trigger_config; the Director''s first propose_brief attempt during user manual testing failed with invalid_trigger_config: stage 2 after_stage missing after_stage_order. Self-corrected within the same turn but cost an extra tool call. v1.8 adds an explicit shape-per-trigger-type example block under Brief structure. Tool suite + model unchanged.'
FROM director_configs
WHERE version_number = '1.7';
