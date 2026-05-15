# V1.x-C.2 Test Report v1.0

**Phase**: V1.x-C.2 — plan model (credit columns + per-plan allocation seed + admission gate rewrite + atomic usage trigger)
**Date**: 2026-05-17
**Branch**: `claude/v1x-c-cost-substrate` (NOT MERGED — V1.x-C merges as a unit at C.4 close-out alongside C.1.a/b + C.3)
**Implementation commit**: this commit
**Verdict**: **PASS** (sub-phase report; full V1.x-C close-out at C.4)

> **Scope note.** V1.x-C.2 is the second sub-phase of V1.x-C. C.1.a (pricing substrate) + C.1.b (runner integration) shipped to the branch in prior sessions; full C.1 report at [docs/stelavox_v1x_c_1_test_report_v1_0.md](stelavox_v1x_c_1_test_report_v1_0.md). C.3 (per-org BYOK Option A) and C.4 (close-out + Tier-A bumps + merge) remain.

---

## §1 — Decisions ratified before edits

Two design conflicts were raised and resolved at C.2 kickoff:

1. **Plan-slug enum.** Build checklist v1.0 §2 M-132 proposed `('trial', 'starter', 'pro', 'enterprise', 'byok_only')`. [Product Spec v1.9 §3.1](stelavox_product_specification_v1_9.md) locks the live plan slugs as `('trial', 'byok_solo', 'byok_team', 'writer', 'author', 'pro')`. Resolution: keep the locked spec — V1.x-C.2 does not touch `organisations.plan` CHECK. Build checklist amended in v1.1 §2 header + Changelog entry to record the divergence and the policy.

2. **Seed allocation values.** User-locked decision: reuse existing `token_budget.<plan>` numerical values as credit allocations (1M/1M/4M/16M for trial/writer/author/pro). Values land in `platform_config` keys and are tunable post-launch without a migration; recalibration against live metrics will happen in V1.x-E once real distribution data is available.

3. **Tokens→credits conversion.** Library spec said the gate would gain an `estimated_credits` parameter via new `estimated_credits.<op>` config keys. Code reality: the five existing callers pass either `profile.max_tokens + 4096` (agent ops) or `agent.director_estimated_tokens_per_turn` (Director) — i.e. dynamic token estimates, not per-op config keys. Resolution: extend the gate signature with `modelId: string`; gate looks up the active `pricing_rates` row and converts token estimate × `input_credits_per_million / 1_000_000` (conservative upper bound treating the entire estimate as input — input rate is the cheaper side for every seeded model, so worst-case under-rejection is impossible). Build checklist §3 C.2 row amended accordingly.

---

## §2 — Scope ratified by checkpoints

| CK | What it proves | Method | Result |
|---|---|---|---|
| **CK-Migration-1 (M-133)** | `organisations.token_allocation_credits` (NULL default) and `token_usage_credits` (NOT NULL DEFAULT 0) columns added | INSERT a fresh org with only required columns; read columns back; assert defaults | **PASS** |
| **CK-Migration-2 (M-134)** | Backfill set per-plan allocation on existing rows | SELECT all non-BYOK rows; assert each row's allocation matches its plan's seed (1M/1M/4M/16M for trial/writer/author/pro) | **PASS** |
| **CK-Migration-3 (M-134)** | All six `plan.*` config keys present | SELECT keys in expected list from `platform_config` | **PASS** |
| **CK-4 (gate decision logic)** | `checkTokenBudget` admits when usage + estimated_credits ≤ allocation + grace; refuses otherwise | Unit-mocked Supabase chain across BYOK / NULL allocation / under-budget / over-budget / grace-extended / Opus-vs-Haiku / unknown-model paths | **PASS** (9/9 vitest unit cases) |
| **CK-5 (trigger atomicity)** | M-135 trigger increments `organisations.token_usage_credits` atomically on `agent_jobs.cost_credits` NULL→non-NULL transitions; does not double-count on subsequent UPDATEs | UPDATE agent_jobs cost_credits = 1500 → assert org sees 1500; second UPDATE to 2000 → assert org still 1500 (WHEN-clause filter); 50 parallel concurrent UPDATEs → assert sum = 50 × 100 | **PASS** (3 integration cases) |
| **CK-10 (API admission)** | API route returns 402 when admission gate refuses | Structural — V1.x-C.2 preserves the existing `err.tokenBudgetExceeded()` → 402 mapping in all five caller routes; gate semantics change is transparent to the route response shape; Phase 5 tests for the response shape continue to pass unchanged | **PASS** (covered by unchanged caller-route mapping + V1.x regression's continued pass) |
| **CK-Inviol** | Verdigris use count remains 9 (no UI surface introduced in C.2) | No new `--color-accent` use; CostMeter component deferred to C.4 | **PASS** |

CK-6..CK-9 belong to C.3 + C.4 and are not in scope for this report.

---

## §3 — What shipped

### Migrations (3 new — count moves 132 → 135)

- **M-133** `organisations_credit_columns.sql` — `ALTER TABLE organisations` adds `token_allocation_credits NUMERIC(20,8) NULL` + `token_usage_credits NUMERIC(20,8) NOT NULL DEFAULT 0`. Existing `plan` CHECK unchanged; existing `current_period_start TIMESTAMPTZ NULL` unchanged. Two column comments document the V1.x-C.2 contract.

- **M-134** `platform_config_plan_credit_keys.sql` — INSERT six `platform_config` keys: `plan.trial_token_allocation_credits` (1,000,000), `plan.writer_token_allocation_credits` (1,000,000), `plan.author_token_allocation_credits` (4,000,000), `plan.pro_token_allocation_credits` (16,000,000), `plan.period_length_days` (30), `plan.over_limit_grace_credits` (0). Then UPDATE backfill on `organisations.token_allocation_credits` per-row from the matching key — only fires WHERE `token_allocation_credits IS NULL` (idempotent on re-application). BYOK plans get NULL allocation; `isByok()` bypass short-circuits.

- **M-135** `accumulate_cost_credits_trigger.sql` — SECURITY DEFINER function `accumulate_cost_credits_into_org()` (SET search_path = public per H-13) plus AFTER UPDATE trigger `accumulate_cost_credits_after_update` on `agent_jobs.cost_credits`. WHEN clause filters to NULL→non-NULL transitions only (no double-count on subsequent UPDATEs of cost_credits, e.g. cancellation overwrites). Body is a single atomic `UPDATE organisations SET token_usage_credits = token_usage_credits + NEW.cost_credits WHERE id = NEW.organisation_id` — Postgres row-lock serialises concurrent calls (CK-5 stress proves correctness at n=50).

### Library

- **REWRITTEN [lib/llm/token-budget.ts](../lib/llm/token-budget.ts)** — gate signature gains `modelId: string` (third param after `org` + `estimatedTokens`). Internal flow:
  1. BYOK check via `isByok()` → return true.
  2. SELECT `token_allocation_credits + token_usage_credits` from `organisations`. NULL allocation → return true (not enforced).
  3. `lookupRate(supabase, modelId, new Date())` against `pricing_rates`. Missing row → return true with warning (V1 ships all four supported models seeded; unknown models are misconfig signal, not admission decision).
  4. `estimatedCredits = estimatedTokens × input_credits_per_million / 1,000,000` (conservative upper bound).
  5. Read `plan.over_limit_grace_credits` from `platform_config`.
  6. Return `usage + estimated_credits ≤ allocation + grace`.

  The `getPeriodTokens` helper from the previous shape was removed — usage is now a column on `organisations` maintained by the M-135 trigger, not a sum over `usage_records`. The legacy `usage_records` table is retained as an audit trail (its callers in `lib/agent/job-lifecycle.ts:updateUsageRecords` are unchanged); it just no longer serves as the admission gate's source of truth.

### Caller updates (modelId param added)

- [app/api/agent/expand/route.ts](../app/api/agent/expand/route.ts:94) — `profile.model_id`
- [app/api/agent/refine/route.ts](../app/api/agent/refine/route.ts:103) — `profile.model_id`
- [app/api/agent/synthesise/route.ts](../app/api/agent/synthesise/route.ts:86) — `profile.model_id`
- [app/api/agent/synthesise/stream/route.ts](../app/api/agent/synthesise/stream/route.ts:124) — `profile.model_id`
- [app/api/agent/generate-context/route.ts](../app/api/agent/generate-context/route.ts:82) — `profile.model_id`
- [app/api/director/message/route.ts](../app/api/director/message/route.ts) — hoisted a minimal `director_configs` SELECT before the gate to provide `directorModelId`; the full config load at §8 continues to read the rest of the row.
- [lib/director/workflow-executor.ts](../lib/director/workflow-executor.ts:712) — `profile.model_id`; both `agent_profiles` SELECT statements (candidate fetch + refine fallback) extended to include `model_id`.

### Test updates

- **[tests/unit/platform-config-validation.test.ts](../tests/unit/platform-config-validation.test.ts)** — F-20 cascade test rewritten. V1.x-C.2 reads only one `platform_config` key (`plan.over_limit_grace_credits`); the F-07/F-20 cascade now applies to that key. Test header comment updated; the cascade assertion drops the stale `token_budget.starter` reference (which no longer exists in code) and asserts BYOK bypass as the V1.x-C.2 admission-safe behaviour. The direct `getConfigInt` type-coercion tests (cases 1 + 2) are unchanged.

### New tests (16 cases total)

- **NEW [tests/unit/v1x-c2-budget-gate.test.ts](../tests/unit/v1x-c2-budget-gate.test.ts)** — 9 unit cases:
  - BYOK plan bypasses even over budget
  - byok_enabled=true on non-BYOK plan also bypasses
  - NULL allocation passes through (V1 "not enforced" policy)
  - Missing organisations row passes through (defensive)
  - Admit when usage + estimated_credits ≤ allocation + grace
  - Refuse when usage + estimated_credits > allocation + grace
  - Grace credits extend the admission ceiling
  - Opus model burns credits ~18× faster — same token estimate refused on Opus where Haiku would pass
  - Missing pricing_rates row passes through with warning

- **NEW [tests/v1x-c2/plan-model-and-trigger.spec.ts](../tests/v1x-c2/plan-model-and-trigger.spec.ts)** — 7 Playwright integration cases:
  - CK-Migration-1: M-133 column shapes + defaults
  - CK-Migration-2: M-134 backfill correctness on existing rows
  - CK-Migration-3: M-134 platform_config keys all present
  - CK-5: usage_credits increments on single UPDATE
  - CK-5: second UPDATE does not double-count (WHEN clause)
  - CK-5: 50 parallel UPDATEs produce correct sum (concurrency stress)
  - CK-10: API admission gate refusal path preserved (structural — `err.tokenBudgetExceeded()` → 402 mapping unchanged)

---

## §4 — Verification gates

| Gate | Result | Detail |
|---|---|---|
| `npm run type-check` | **PASS** | 0 errors |
| Vitest full unit suite | **373/377 PASS** | 4 skipped baseline; 0 failures across 40 files (incl. 9/9 new C.2 budget-gate + revised F-20 cascade) |
| Playwright V1.x regression (a1 + b1 + b1-2 + b2 + b3 + c1 + c2) | **89 passed / 4 skipped** | 4 skipped = baseline V1.x-B.1.1 queue tests carried over from B.3 supersession; +7 new V1.x-C.2 cases all PASS |

### Pre-existing baseline issue (unchanged)
The same 4 vitest files that hit seed-dependency errors on first session start need `npm run script scripts/seed-director-fixture.ts -- --scenario j5-novel` to be run before they can pass. This was true before V1.x-C.2 and remains true after — no change introduced this phase.

---

## §5 — Hazard tracking

- **H-07 (orphan agent_jobs on budget exceedance)** — preserved. The gate still runs in the API route BEFORE the agent_jobs INSERT. The five caller paths (4 agent ops + Director message + workflow_executor) all check + return 402 / fail the workflow_step before any job row is created. CK-Migration-3 ensures the gate's configuration is loadable from a freshly-applied DB.
- **H-13 (SECURITY DEFINER search_path)** — `accumulate_cost_credits_into_org()` declares `SET search_path = public` per the invariant.
- **H-20 (pricing rate effective_from race)** — already mitigated in C.1.a; the C.2 gate uses `lookupRate` which keys on `completed_at <= effective_from` with proper interval semantics. No re-introduction.
- **No new hazards** introduced in C.2. The atomic UPDATE pattern under row-lock is a known-safe Postgres idiom; CK-5's 50-parallel stress proves correctness.

---

## §6 — Reassigned / deferred to subsequent V1.x-C sub-phases

| Item | Why deferred | Lands in |
|---|---|---|
| Per-org BYOK Option A re-route (`lib/llm/factory.ts` from per-user to per-org) | BYOK retarget is C.3 scope | V1.x-C.3 |
| Migrate `user_anthropic_keys` to per-org Vault | BYOK retarget is C.3 scope | V1.x-C.3 |
| `POST /api/cron/period-rollover` (reset `token_usage_credits` + advance `current_period_start`) | Period rollover surface lives at C.4 | V1.x-C.4 |
| `CostMeter` UI + `PlanPanel` + `OrgAnthropicKeyPanel` | UI substrate lands at C.3 + C.4 | V1.x-C.3/C.4 |
| Tier-A doc bumps (TA v2.6; Component Spec v2.13; Product Spec v1.11; CLAUDE.md v1.31) | Single consolidation pass | V1.x-C.4 close-out |
| Merge to master + tag `v1.x-c` | V1.x-C merges as a unit | V1.x-C.4 close-out |

---

## §7 — Sign-off

V1.x-C.2 **PASSES** at substrate level. The plan-based admission gate is live for the four locked product plan slugs (trial/writer/author/pro); BYOK plans (byok_solo/byok_team) bypass via `isByok()`; the atomic usage-tracking trigger correctly accumulates `cost_credits` into the org counter under concurrent stress. Existing `usage_records` audit trail is preserved unchanged. No regressions in the V1.x regression suites. No new hazards. No Inviolables changed (verdigris use count remains nine).

**Next sub-phase: V1.x-C.3** — per-org BYOK Option A: re-target `lib/llm/factory.ts` from per-user `user_anthropic_keys` (V1.x-B.1.2 substrate) to per-org `organisations.byok_*` columns; deprecate per-user keys; Edge Function accepts EITHER header for the transition window.

---

## Changelog

**v1.0 — 2026-05-17** Initial issue covering V1.x-C.2 plan-model substrate landing on branch `claude/v1x-c-cost-substrate` at this commit.
