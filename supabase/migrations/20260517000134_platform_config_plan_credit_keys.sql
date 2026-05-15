-- V1.x-C.2 — platform_config plan credit allocation keys + backfill.
--
-- Source: stelavox_v1x_c_build_checklist_v1_0.md §2 C.2 M-134.
--
-- Adds six platform_config keys for the credit-based admission gate:
--   plan.<slug>_token_allocation_credits  (four: trial / writer / author / pro)
--   plan.period_length_days
--   plan.over_limit_grace_credits
--
-- Then backfills organisations.token_allocation_credits per-row from
-- the matching key. BYOK plans (byok_solo / byok_team) get NULL — the
-- gate's isByok() bypass fires before the column is read.
--
-- Defaults preserve the existing token_budget.<plan> numerical values
-- as credit allocations (interpretation 1 of "leave seed values as is";
-- documented decision 2026-05-17). Values are tunable via platform_config
-- post-launch using live metrics from V1.x-E without a migration.
--
-- The pre-existing token_budget.<plan> keys are LEFT IN PLACE for
-- backward-compat / audit reference. They are no longer read by
-- lib/llm/token-budget.ts after V1.x-C.2 lands.

INSERT INTO platform_config (key, value, description, value_type) VALUES
  ('plan.trial_token_allocation_credits',  '1000000',  'V1.x-C.2 — credit allocation for trial organisations (full 30-day period). Tunable via platform_config; admission gate refuses dispatch when usage+estimated > allocation + grace.', 'integer'),
  ('plan.writer_token_allocation_credits', '1000000',  'V1.x-C.2 — credit allocation for Writer tier per billing period.', 'integer'),
  ('plan.author_token_allocation_credits', '4000000',  'V1.x-C.2 — credit allocation for Author tier per billing period.', 'integer'),
  ('plan.pro_token_allocation_credits',    '16000000', 'V1.x-C.2 — credit allocation for Pro tier per billing period.', 'integer'),
  ('plan.period_length_days',              '30',       'V1.x-C.2 — length of a billing period in days. Cron rollover (V1.x-C.4 close-out) resets organisations.token_usage_credits=0 and advances current_period_start by this many days.', 'integer'),
  ('plan.over_limit_grace_credits',        '0',        'V1.x-C.2 — credits of overrun allowed past the hard cap. Default 0 = strict hard cap. Future per-org override path lives in agent.<org_id>_grace_credits.', 'integer')
ON CONFLICT (key) DO NOTHING;

-- Backfill organisations.token_allocation_credits per-row from the
-- matching plan key. NULL for any plan slug not in the four non-BYOK
-- list — BYOK plans bypass the gate via isByok() already, and any
-- other slug (none in V1; defensive) gets NULL = "not enforced".

UPDATE organisations
SET token_allocation_credits = (
  CASE plan
    WHEN 'trial'  THEN (SELECT (value)::TEXT::NUMERIC FROM platform_config WHERE key = 'plan.trial_token_allocation_credits')
    WHEN 'writer' THEN (SELECT (value)::TEXT::NUMERIC FROM platform_config WHERE key = 'plan.writer_token_allocation_credits')
    WHEN 'author' THEN (SELECT (value)::TEXT::NUMERIC FROM platform_config WHERE key = 'plan.author_token_allocation_credits')
    WHEN 'pro'    THEN (SELECT (value)::TEXT::NUMERIC FROM platform_config WHERE key = 'plan.pro_token_allocation_credits')
    ELSE NULL
  END
)
WHERE token_allocation_credits IS NULL;
