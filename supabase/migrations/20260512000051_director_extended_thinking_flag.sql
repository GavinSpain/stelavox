-- Migration 051 — enable extended_thinking on the production Director config.
--
-- V1.x-LB launch-blocker fix-pack, task 5.
-- Source: docs/stelavox_director_architecture_v2_0.md §16.2,
--         project_v1x_lb_next_session_prep.md (task 5).
--
-- Flips director_configs.model_params.extended_thinking from false to true
-- on whichever row is currently 'production'. The provider gates activation
-- on model support via modelSupportsExtendedThinking() — true for Opus 4.7+
-- and Sonnet 4.6+, false for Haiku 4.5 (the V1 default Director model).
--
-- For the default deployment (model=claude-haiku-4-5-20251001), the flag
-- is dormant: the provider omits the `thinking` request parameter and the
-- API call is byte-identical to before this migration. The flag activates
-- the moment an operator bumps `director_configs.model_id` to a thinking-
-- capable model — no further migration required.
--
-- Why ship the flag enabled rather than leaving it false until an operator
-- opts in? Operationally, the failure mode of "thinking model selected but
-- thinking flag forgotten" is a silent quality regression — the model
-- produces lower-quality reasoning without anyone noticing. Reverse failure
-- mode "flag set on a model that doesn't support it" is silently safe
-- thanks to the provider gating. So default-on is the safer posture.
--
-- This change does NOT bump the prompt version. extended_thinking lives in
-- model_params, not in system_prompt; the Director v1.2 prompt remains
-- production. Flipping the flag is a config tweak, not a prompt revision.

UPDATE director_configs
SET model_params = jsonb_set(
  model_params,
  '{extended_thinking}',
  'true'::jsonb,
  true
)
WHERE status = 'production';
