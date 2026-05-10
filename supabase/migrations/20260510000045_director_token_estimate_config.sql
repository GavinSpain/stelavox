-- Migration 045 — seed agent.director_estimated_tokens_per_turn
-- (round-3 audit B5.5; closes F-187).
--
-- The Director message route (fixed in this batch) calls
-- checkTokenBudget with a per-turn token estimate. The estimate is
-- intentionally conservative (worst-case Director turn = many tool
-- calls + conversation history + response) so the gate catches
-- obvious budget exhaustion. Actual usage is recorded post-turn via
-- the existing usage_records pipeline; this is a soft pre-check, not
-- a precise accounting.
--
-- Default 30000 tokens — covers a typical Director turn that uses
-- ~10 tool iterations with conversation history. Admins can tune
-- per-deployment via platform_config.

INSERT INTO platform_config (key, value, description, value_type)
VALUES (
  'agent.director_estimated_tokens_per_turn',
  '30000',
  'Soft per-turn token estimate used by /api/director/message budget gate. Worst-case Director turn (full conversation history + many tool calls + response).',
  'integer'
)
ON CONFLICT (key) DO NOTHING;
