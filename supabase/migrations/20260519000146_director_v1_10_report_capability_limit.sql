-- V1.x-F.1 — Director config v1.10: adds report_capability_limit synthetic tool.
--
-- Source: stelavox_v1x_f_build_checklist_v1_1.md §2 M-146 + §3.
--
-- The Director-knows-its-limits operating philosophy (locked V1.x-LB
-- session memory). When the Director detects the user's request exceeds
-- its capability boundaries (per-iteration cap; token-budget headroom;
-- tool-count overflow; multi-batch protocol not viable), it invokes
-- report_capability_limit to surface a structured "I cannot do this in
-- one go because X; here's the closest thing I can do" artefact rather
-- than silently truncating or failing.
--
-- The tool is propose-only per H-08 — there's no underlying DB write.
-- The user "approves" by reading the suggested alternative and
-- reformulating their request. UI renders as CapabilityLimitCard in the
-- conversation thread (no verdigris — informational, no action to take).
--
-- v1.10 tool_suite = v1.9's 18 + report_capability_limit (now 19 tools).
-- v1.10 system_prompt = v1.9's body + appended self-rejection paragraph.

UPDATE director_configs
SET status = 'deprecated', deprecated_at = NOW()
WHERE version_number = '1.9' AND status = 'production';

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
  '1.10',
  'Director v1.10 — report_capability_limit',
  'production',
  -- Append a self-rejection paragraph to the v1.9 system prompt.
  system_prompt || E'\n\n## When you cannot do what was asked\n\nIf a request exceeds your capability boundaries — per-iteration node cap (typically 30), token-budget headroom, tool-count overflow, or a multi-step batch protocol that doesn''t fit in one workflow — call `report_capability_limit` BEFORE attempting partial execution. Detail what you detected and what you CAN do (e.g. "I can plan chapters 1-10 in this workflow; once those land I''ll plan 11-20"). This is preferable to silent truncation or partial failure. Do not call `propose_brief` or `propose_workflow` for the over-capacity request after reporting the limit — wait for the user to reformulate.',
  -- v1.10 tool_suite = v1.9's JSONB array + report_capability_limit
  (SELECT tool_suite || '["report_capability_limit"]'::jsonb
   FROM director_configs
   WHERE version_number = '1.9'),
  model_id,
  model_params,
  capability_flags,
  'V1.x-F.1 (v1.10) — adds report_capability_limit synthetic write tool (19 tools = v1.9''s 18 + 1). Director-knows-its-limits operating philosophy locked V1.x-LB session memory. Propose-only per H-08; user approves by reformulating request after reading suggested alternative. UI: CapabilityLimitCard renders in conversation thread (--color-info border; text-link "Adjust request"; no verdigris).'
FROM director_configs
WHERE version_number = '1.9';
