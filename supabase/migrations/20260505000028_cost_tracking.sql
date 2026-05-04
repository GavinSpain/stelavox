-- Migration 028 — Cost tracking column + price config keys
-- Source: stelavox_phase5_api_contract_v1_0.md v1.2 §1.4 + §5 G-13
-- Build Checklist: T-1.4 (v1.1)
--
-- Adds the cost-as-first-class plumbing per G-13:
--   1. agent_jobs.cost_usd column — populated by the Edge Function at job
--      completion via lib/llm/cost.ts → computeCostUsd(). Frozen at completion
--      so historical rows show the cost as it was on the day the operation
--      ran, insulated from later Anthropic price changes.
--   2. Six platform_config price keys (input + output per million tokens) for
--      Haiku 4.5, Sonnet 4.6, Opus 4.6. Cache pricing is derived in code as
--      Anthropic-published multipliers (cache_write = 1.25× input,
--      cache_read = 0.10× input).
--
-- UI implications: NONE. Per Product Spec §3.2 and Component Spec §5.9,
-- platform-paid users see allocation percentage, BYOK users see raw token
-- usage; no dollar amounts in any V1 user-facing surface. cost_usd surfaces
-- only in scripts/cost-report.ts and the Phase 5 Test Report's §10 Cost
-- Analysis section.

-- 1. agent_jobs.cost_usd column
ALTER TABLE agent_jobs ADD COLUMN cost_usd DECIMAL(10,6);
COMMENT ON COLUMN agent_jobs.cost_usd IS
  'USD cost computed at job completion from tokens_* and model_id against platform_config price keys. Frozen at completion — historical rows unaffected by later Anthropic price changes. Internal-only field; not surfaced in V1 user-facing UI.';

-- 2. platform_config price keys
INSERT INTO platform_config (key, value, description, value_type) VALUES
  ('price.anthropic.claude-haiku-4-5-20251001.input_per_mtok',  '1.00',  'Anthropic Haiku 4.5 input price USD per million tokens',  'number'),
  ('price.anthropic.claude-haiku-4-5-20251001.output_per_mtok', '5.00',  'Anthropic Haiku 4.5 output price USD per million tokens', 'number'),
  ('price.anthropic.claude-sonnet-4-6.input_per_mtok',          '3.00',  'Anthropic Sonnet 4.6 input price USD per million tokens',  'number'),
  ('price.anthropic.claude-sonnet-4-6.output_per_mtok',         '15.00', 'Anthropic Sonnet 4.6 output price USD per million tokens', 'number'),
  ('price.anthropic.claude-opus-4-6.input_per_mtok',            '15.00', 'Anthropic Opus 4.6 input price USD per million tokens',    'number'),
  ('price.anthropic.claude-opus-4-6.output_per_mtok',           '75.00', 'Anthropic Opus 4.6 output price USD per million tokens',   'number')
ON CONFLICT (key) DO NOTHING;
