-- Migration 043 — config-ify the Director tool-call rate-limit window
-- (round-3 audit B5.6a; partial close on F-74 hygiene).
--
-- The window length was a 60_000ms hardcode in
-- lib/security/tool-validator.ts:241 — H-12 violation. The full F-74
-- remediation (fail-open vs throttle-and-pace, per-user vs per-conv vs
-- global tiers, workflow execution pacing, Anthropic-throttle logging)
-- is deferred to the Director architecture deep review per the user
-- decision 2026-05-10. This migration only does the H-12 hygiene fix.
--
-- See project_director_architecture_review.md for the deferred scope.

INSERT INTO platform_config (key, value, description, value_type)
VALUES (
  'agent.director_tool_call_rate_limit_window_ms',
  '60000',
  'Window length (ms) over which the Director per-conversation tool-call rate limit counts. The full rate-limit subsystem (fail-open semantics, per-user/global tiers, workflow pacing) is deferred to the Director architecture deep review.',
  'integer'
)
ON CONFLICT (key) DO NOTHING;
