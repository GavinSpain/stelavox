-- V1.x-C.2 — organisations credit columns.
--
-- Source: stelavox_v1x_c_build_checklist_v1_0.md §2 C.2 M-133.
--
-- Adds two NUMERIC columns to organisations for the plan-based admission
-- gate's credit accounting:
--   - token_allocation_credits: per-period credit allocation (populated
--     by M-134's backfill per-plan; BYOK plans get NULL — gate's
--     isByok() bypass short-circuits before the column is read)
--   - token_usage_credits: running counter incremented atomically by
--     the M-135 trigger when agent_jobs.cost_credits becomes non-NULL
--
-- The existing organisations.plan CHECK constraint is UNTOUCHED — V1.x-C.2
-- keeps Product Spec v1.9 §3.1 locked plan slugs (trial / byok_solo /
-- byok_team / writer / author / pro). The build checklist's original
-- proposal of a 5-slug enum was illustrative; the locked spec wins.
--
-- current_period_start TIMESTAMPTZ NULL already exists from M-001; this
-- migration does not touch it. NULL means "no period assigned" — the gate
-- treats NULL allocation as "not enforced" (covers BYOK + any unbackfilled
-- row).

ALTER TABLE organisations
  ADD COLUMN token_allocation_credits NUMERIC(20,8) NULL,
  ADD COLUMN token_usage_credits NUMERIC(20,8) NOT NULL DEFAULT 0;

COMMENT ON COLUMN organisations.token_allocation_credits IS
  'V1.x-C.2 — per-period credit allocation from plan.<slug>_token_allocation_credits. NULL = not enforced (covers BYOK plans which bypass via isByok). Tunable post-launch via platform_config without a migration.';

COMMENT ON COLUMN organisations.token_usage_credits IS
  'V1.x-C.2 — running counter of credits consumed in the current period. Incremented atomically by the accumulate_cost_credits trigger (M-135) when agent_jobs.cost_credits becomes non-NULL. Reset to 0 on period rollover (cron deferred to V1.x-C.4 close-out).';
