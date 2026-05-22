-- M-201 — brief_stages: add `planning_retry_count` + supporting config.
--
-- Supports Phase 5 (Director expected-output check). When the Director
-- iteration ends without emitting propose_workflow on a stage-trigger
-- turn, the iteration-runner increments this counter. When it reaches
-- `brief.max_planning_retries`, the stage transitions to 'failed'.
--
-- Source: docs/stelavox_brief_orchestration_v1_0.md §11.2.

BEGIN;

ALTER TABLE public.brief_stages
  ADD COLUMN planning_retry_count INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.brief_stages.planning_retry_count IS
  'Incremented each PLAN_FAIL event. When >= brief.max_planning_retries, stage transitions to failed. Reset to 0 by admin_retry_failed_stage.';

-- Platform config defaults (per spec §14).
INSERT INTO platform_config (key, value, value_type, description)
VALUES
  ('brief.max_stages_per_brief', '100', 'integer', 'Hard cap on stages per brief'),
  ('brief.max_planning_retries', '3', 'integer', 'PLAN_FAIL retries before stage moves to failed'),
  ('brief.planning_stale_threshold_seconds', '300', 'integer', 'Stage stuck in planning for this long → reconcile reverts to planned'),
  ('workflow.stuck_threshold_seconds', '90', 'integer', 'Workflow stuck in approved → reconcile kicks advanceWorkflow'),
  ('agent.runner_claim_max_seconds', '60', 'integer', 'pending/dispatched with no heartbeat for this long → swept to crashed'),
  ('agent.turn_stale_threshold_seconds', '300', 'integer', 'Director turn with no iteration progress → marked failed')
ON CONFLICT (key) DO NOTHING;

COMMIT;
