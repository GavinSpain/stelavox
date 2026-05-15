-- V1.x-B.3 — Director config v1.9: adds propose_brief_amendment write tool.
--
-- Source: stelavox_v1x_b_3_build_checklist_v1_0.md §3 (line 86):
--   "MODIFY lib/director/tool-definitions.ts — add propose_brief_amendment
--    write-tool (Director registry version V1.9 — 18 tools = V1.8's 17 +
--    propose_brief_amendment)."
--
-- v1.9 system_prompt = v1.8's system_prompt + brief amendment tool guidance
-- inserted under "Write tools (proposal-only — H-08)". Tool_suite = v1.8 + one.

UPDATE director_configs
SET status = 'deprecated', deprecated_at = NOW()
WHERE version_number = '1.8' AND status = 'production';

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
  '1.9',
  'Director v1.9 — propose_brief_amendment',
  'production',
  -- Append a brief paragraph to the v1.8 system prompt describing the new tool.
  system_prompt || E'\n\n## Brief amendments\n\nWhen the user asks you to modify an in-flight Brief (change goal_text, update preferences, add/modify/remove a pending stage), call `propose_brief_amendment`. The tool returns a proposal artefact; the user approves via UI before `apply_brief_amendment` fires. Already-running stages are immutable — you can only modify or remove stages whose status is still `planned`.',
  -- v1.9 tool_suite = v1.8's JSONB array + propose_brief_amendment
  (SELECT tool_suite || '["propose_brief_amendment"]'::jsonb
   FROM director_configs
   WHERE version_number = '1.8'),
  model_id,
  model_params,
  capability_flags,
  'V1.x-B.3 (v1.9) — adds propose_brief_amendment write tool (18 tools = v1.8''s 17 + 1). Brief amendments allow Director to modify an in-flight Brief''s goal_text / preferences / pending-stage roadmap. Same propose-only invariant as other write tools (H-08); user approves via BriefAmendmentCard UI before apply_brief_amendment RPC fires.'
FROM director_configs
WHERE version_number = '1.8';
