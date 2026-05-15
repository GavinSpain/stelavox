# Stelavox V1.x-C — Tier-B Build Checklist
## Plan + cost meter + per-org BYOK Option A
## Version 1.0

> **Status: DRAFT.** Authored 2026-05-16 alongside V1.x-B.3/D/E/F. Locks the per-org BYOK Option A decision (per memory `project_v1x_c_byok_option_a.md`) and the time-versioned `pricing_rates` design from Director Architecture v2 §13.

---

## §1 — Scope and goals

V1.x-C ships the user-visible cost surface and the plan-based admission model. Three intertwined capabilities:

1. **Plan model** — paid plan tiers with hard-cap pre-pay token allocations. Free trial tier with limited monthly tokens. Plan upgrade flow (out of scope for V1; V2 lands Stripe). For V1 the plan is set on the org row; the admission gate (`checkTokenBudget`) reads from the plan + accumulated usage.
2. **Cost meter** — user-visible $cost (BYOK) or %allocation-used (non-BYOK) per `agent_jobs` completion. Surfaces in AgentTab + DirectorPanel + SchedulerPanel via the `cost_credits` column (B.2.1) + new time-versioned `pricing_rates` table.
3. **Per-org BYOK Option A** — migrates from per-user `user_anthropic_keys` (V1.x-B.1.2 substrate) to per-org BYOK gated by plan. The original Director Architecture v2 design uses `organisations.byok_*` columns; V1.x-C lights them up. Per-user keys deprecate; existing per-user keys migrate to the org's BYOK setup at first use.

### Sequencing

V1.x-C **internal sub-phases**:
- **C.1** — `pricing_rates` table + `cost_credits` computation in agent runner + cost meter UI substrate (1-2 sessions)
- **C.2** — Plan model (`organisations.plan` enum extension; per-plan token allocations; `checkTokenBudget` rewrite to use plan-aware budget) (1-2 sessions)
- **C.3** — Per-org BYOK Option A (re-route `lib/llm/factory.ts` from per-user to per-org; per-user keys → migrate to org BYOK; deprecation path) (1-2 sessions)
- **C.4** — Tier-A consolidation + Test Report + merge (1 session)

Estimated 4-7 sessions total.

---

## §2 — Migrations (~10, 129-138)

### C.1 (129-131)

- **M-129 — `pricing_rates_table`**:
  ```sql
  CREATE TABLE pricing_rates (
    id BIGSERIAL PRIMARY KEY,
    model_id TEXT NOT NULL,
    effective_from DATE NOT NULL,
    effective_until DATE NULL,
    input_tokens_per_credit NUMERIC(20,6) NOT NULL,
    output_tokens_per_credit NUMERIC(20,6) NOT NULL,
    cache_write_tokens_per_credit NUMERIC(20,6) NULL,
    cache_read_tokens_per_credit NUMERIC(20,6) NULL,
    note TEXT NULL,
    UNIQUE (model_id, effective_from)
  );
  CREATE INDEX pricing_rates_model_effective_idx
    ON pricing_rates(model_id, effective_from DESC);
  ```
  Append-only; daily-granularity; the rate active on a job's `completed_at` date is authoritative (H-20 mitigation). Seed with current rates for Haiku 4.5 / Sonnet 4.6 / Opus 4.7.

- **M-130 — `cost_credits_compute_function`**: SECURITY DEFINER SQL function `compute_cost_credits(p_model_id TEXT, p_completed_at TIMESTAMPTZ, p_tokens_input INTEGER, p_tokens_output INTEGER, p_cache_write INTEGER, p_cache_read INTEGER) RETURNS NUMERIC(20,8)` — looks up the active rate; returns the credit cost. Used by agent runner + iteration runner at completion to populate `agent_jobs.cost_credits` (already a column from B.2.1 M-105).

- **M-131 — `anthropic_pricing_table`** (parallel table for BYOK pricing — Anthropic's actual $-per-token; user sees real dollars not credits):
  ```sql
  CREATE TABLE anthropic_pricing (
    id BIGSERIAL PRIMARY KEY,
    model_id TEXT NOT NULL,
    effective_from DATE NOT NULL,
    input_dollars_per_million NUMERIC(10,4) NOT NULL,
    output_dollars_per_million NUMERIC(10,4) NOT NULL,
    cache_write_dollars_per_million NUMERIC(10,4) NULL,
    cache_read_dollars_per_million NUMERIC(10,4) NULL,
    UNIQUE (model_id, effective_from)
  );
  ```

### C.2 (132-134)

- **M-132 — `organisations_plan_extension`**: adds `organisations.plan` enum CHECK ('trial', 'starter', 'pro', 'enterprise', 'byok_only'); `organisations.token_allocation_credits NUMERIC(20,8)` (per-period allocation); `organisations.token_usage_credits NUMERIC(20,8) DEFAULT 0` (running counter); `organisations.current_period_start DATE NOT NULL DEFAULT CURRENT_DATE`. Backfill existing rows to 'trial' with default allocation from new platform_config.

- **M-133 — `platform_config_plan_keys`**:
  - `plan.trial_token_allocation_credits` (default 100k)
  - `plan.starter_token_allocation_credits` (default 1M)
  - `plan.pro_token_allocation_credits` (default 10M)
  - `plan.enterprise_token_allocation_credits` (default 100M)
  - `plan.period_length_days` (default 30)
  - `plan.over_limit_grace_credits` (default 0 — hard cap; future override per org)

- **M-134 — `usage_tracking_trigger`**: AFTER UPDATE on `agent_jobs` when `cost_credits` becomes non-NULL → atomically increments `organisations.token_usage_credits` by the delta. Atomic counter via `UPDATE … SET token_usage_credits = token_usage_credits + N WHERE id = ?` (no race).

### C.3 (135-138)

- **M-135 — `organisations_byok_columns_revive`**: `organisations.byok_enabled`, `byok_provider`, `byok_api_key_vault_id` were defined in M-001 but unused. V1.x-C lights them up — adds NOT NULL DEFAULT FALSE on byok_enabled; adds gated GRANT on a SECURITY DEFINER `enable_org_byok(org_id, plan)` RPC that requires plan='enterprise' or 'byok_only'.

- **M-136 — `org_byok_save_rpc`**: `save_org_anthropic_key(p_org_id UUID, p_key TEXT) RETURNS JSONB` SECURITY DEFINER — validates plan eligibility; encrypts via vault.create_secret; updates `organisations.byok_api_key_vault_id`. Mirrors M-104's per-user pattern.

- **M-137 — `migrate_per_user_keys_to_org`**: SECURITY DEFINER one-shot migration — for each `user_anthropic_keys` row, if the user's org has plan='enterprise' or 'byok_only' AND the org doesn't yet have BYOK enabled, transfer the user's key to the org. Otherwise, mark the per-user key as `deprecated_at=now()`.

- **M-138 — `byok_get_for_call_rpc_v2`**: `get_org_anthropic_key_for_byok_call(p_org_id UUID) RETURNS TEXT` SECURITY DEFINER service-role-only — returns the decrypted org key from Vault. Mirrors M-104's per-user pattern but org-scoped. The Edge Function `byok-llm-call` accepts EITHER a `x-stelavox-user-id` header (legacy) OR a `x-stelavox-org-id` header (V1.x-C); resolves the key from the appropriate RPC.

---

## §3 — Library

### C.1
- **NEW `lib/cost/pricing.ts`** — `lookupRate(modelId, completedAt)` reads `pricing_rates`; `computeCostCredits(usage, modelId, completedAt)` mirrors the SQL function for unit-test independence
- **NEW `lib/cost/anthropicDollars.ts`** — same pattern for the `anthropic_pricing` table; BYOK paths display real $ to user
- **MODIFY `lib/agent/runner.ts`** — at `persistFinalResult` time, call `computeCostCredits` + populate `cost_credits` on agent_jobs. Already wires through B.2.1's column; this lights it up.
- **MODIFY `lib/director/iteration-runner.ts`** — same pattern for director_iteration agent_jobs; already populates `cost_credits` field (B.2.1).

### C.2
- **REWRITE `lib/llm/token-budget.ts`** — `checkTokenBudget(org, estimatedTokens)` now reads `organisations.plan` + `token_allocation_credits` + `token_usage_credits` against the per-plan budget; refuses dispatch when `usage + estimated > allocation + grace`.

### C.3
- **REWRITE `lib/llm/factory.ts`** — Option A: prefer org BYOK if `organisations.byok_enabled=true`; fall back to per-user BYOK if user has key + org doesn't (transition window); fall back to platform key. Both BYOK paths route through the same Edge Function (different RPC).
- **DEPRECATE `lib/llm/byok.ts:userHasByokKey`** — kept for transition window; logs a deprecation warning; final removal in V2.
- **NEW `lib/byok/orgKey.ts`** — `saveOrgAnthropicKey`, `getOrgKeyStatus`, `deleteOrgKey` mirroring `lib/byok/` per-user shape.

---

## §4 — UI

- **NEW `components/cost/CostMeter.tsx`** — surfaces in AgentTab footer + DirectorPanel footer + SchedulerPanel header. BYOK users see "$0.0042 spent on this turn" / "$1.34 this period". Non-BYOK users see "12% used / 87.5k credits remaining". Realtime-subscribed to organisations row.
- **NEW `components/settings/PlanPanel.tsx`** — `/settings/plan` route; shows current plan + period usage + days remaining + (read-only in V1) "Upgrade plan" button (V2 wires Stripe).
- **NEW `components/settings/OrgAnthropicKeyPanel.tsx`** — admin-only (org-owner check); replaces or complements `AnthropicKeyPanel` (the per-user variant from V1.x-B.1.2). Mounts at `/settings/org-api-keys`.
- **MODIFY `components/director/DirectorPanel.tsx`** — mount CostMeter in footer.
- **MODIFY `components/detail/AgentTab.tsx`** — show per-job cost in the completed-state token summary (already shows tokens + cost from B.2.1; B.2.4 makes the cost real).

---

## §5 — API routes

- **NEW `GET /api/usage/current-period`** — returns `{ plan, allocation_credits, usage_credits, period_start, days_remaining, byok_enabled, byok_dollars_spent_this_period }`
- **NEW `POST /api/org/anthropic-key`** + DELETE / GET — admin-only; mirrors per-user equivalents
- **NEW `POST /api/cron/period-rollover`** — daily cron checks for orgs whose period has ended; resets `token_usage_credits=0` + advances `current_period_start`

---

## §6 — Acceptance criteria

| CK | What | Method |
|---|---|---|
| CK-1 | pricing_rates lookup returns the active rate at completed_at | unit + integration |
| CK-2 | compute_cost_credits SQL matches TS implementation | parity test |
| CK-3 | agent_jobs.cost_credits populated on completion (both runner paths) | integration |
| CK-4 | checkTokenBudget refuses dispatch when usage+estimated > allocation | integration |
| CK-5 | usage tracking trigger atomically increments organisations.token_usage_credits | concurrency stress |
| CK-6 | per-org BYOK key save + retrieve via Edge Function | integration |
| CK-7 | factory routes via org BYOK when org has key; falls back to per-user during transition; falls back to platform | integration |
| CK-8 | per-user keys migration moves to org for eligible plans; deprecates otherwise | one-shot RPC test |
| CK-9 | CostMeter renders BYOK $ vs non-BYOK % correctly | Playwright |
| CK-10 | Plan-based admission rejects over-limit dispatch with 402 | API integration |
| CK-Inviol | Verdigris-use count = 9 | grep audit |

---

## §7 — Sign-off

V1.x-C PASSES when CK-1..CK-10 + CK-Inviol green, all gates pass, Test Report PASS, Tier-A docs bumped (TA v2.5 → v2.6; Director Architecture v2.3 → v2.4; Component Spec v2.12 → v2.13; Product Spec v1.10 → v1.11; CLAUDE.md → v1.31), merged to master with `--no-ff` + tag `v1.x-c`, MEMORY.md updated.

---

## Changelog

**v1.0 — 2026-05-16** Initial draft authored alongside B.3/D/E/F.
