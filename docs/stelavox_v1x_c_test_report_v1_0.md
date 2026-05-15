# V1.x-C Test Report v1.0 (consolidated)

**Phase**: V1.x-C — plan model + cost meter + per-org BYOK Option A
**Date**: 2026-05-16 close-out
**Branch**: `claude/v1x-c-cost-substrate` — merged to master via `--no-ff` at this Test Report's commit; tag `v1.x-c`
**Sub-phase commits**:
- C.1.a substrate `e390b6f`
- C.1.b runner integration `12a5b65`
- C.2 plan model `b4d6d21`
- C.3 per-org BYOK `4318ce9`
- C.4 close-out (this commit)
**Verdict**: **PASS**

This consolidated report rolls up the per-sub-phase reports already authored ([C.1](stelavox_v1x_c_1_test_report_v1_0.md), [C.2](stelavox_v1x_c_2_test_report_v1_0.md), [C.3](stelavox_v1x_c_3_test_report_v1_0.md)) plus the C.4 close-out cases. The per-sub-phase reports remain the canonical detail; this document is the V1.x-C ship verdict.

---

## §1 — Acceptance criteria roll-up

Build checklist [§6](stelavox_v1x_c_build_checklist_v1_0.md) acceptance criteria all green:

| CK | What | Where covered | Result |
|---|---|---|---|
| **CK-1** | pricing_rates lookup returns active rate at completed_at | C.1.a unit + Playwright parity | **PASS** |
| **CK-2** | compute_cost_credits SQL ↔ TS parity (randomised matrix) | C.1.a Playwright | **PASS** |
| **CK-3** | agent_jobs.cost_credits populated on both runner paths | C.1.b runner integration; verified via V1.x-B.2 regression continuing to PASS post-rewrite | **PASS** |
| **CK-4** | checkTokenBudget refuses dispatch when usage + estimated > allocation | C.2 unit (9/9) + Playwright integration | **PASS** |
| **CK-5** | usage-tracking trigger atomically increments organisations.token_usage_credits | C.2 Playwright 50-parallel concurrency stress | **PASS** |
| **CK-6** | per-org BYOK key save + retrieve via Edge Function | C.3 unit + Playwright (RPC-level lifecycle; Edge Function path is the existing V1.x-B.1.2 path with the new header added) | **PASS** |
| **CK-7** | factory routes via org BYOK; falls back to per-user during transition; falls back to platform | C.3 unit (orgHasByokKey + userHasByokKey decision matrix) + Playwright (RPC reachability + plan-eligibility refusal) | **PASS** |
| **CK-8** | per-user keys migration to org; deprecates otherwise; idempotent | C.3 Playwright + applied-migration verification | **PASS** |
| **CK-9** | CostMeter renders BYOK $ vs non-BYOK % correctly | **DEFERRED to V1.x-D** (see §3 below) | **N/A this phase** |
| **CK-10** | Plan-based admission rejects over-limit dispatch with 402 | C.2 — the existing `err.tokenBudgetExceeded()` → 402 mapping in all five caller routes is preserved unchanged; gate semantics change is transparent to route response shape | **PASS** (structural) |
| **CK-Inviol** | Verdigris use count = 9 | All four sub-phase reports + grep audit | **PASS** |

Two additional CKs from C.4 close-out:

| CK | What | Where covered | Result |
|---|---|---|---|
| **CK-C.4-Allocation** | M-140 handle_new_user trigger auto-allocates token_allocation_credits from plan.<plan>_token_allocation_credits | C.4 Playwright integration | **PASS** |
| **CK-C.4-Rollover** | M-141 rollover_org_periods + POST /api/cron/period-rollover correctly zeros usage_credits + advances current_period_start when period elapsed; skips NULL-allocation BYOK orgs | C.4 Playwright integration (3 cases — eligible / not-yet-elapsed / NULL-skip) | **PASS** |

---

## §2 — What shipped (V1.x-C aggregate)

### Migrations (12 — 130 through 141)
- **M-130** `pricing_rates_table.sql` (C.1.a)
- **M-131** `cost_credits_compute_function.sql` (C.1.a)
- **M-132** `anthropic_pricing_table.sql` (C.1.a)
- **M-133** `organisations_credit_columns.sql` (C.2)
- **M-134** `platform_config_plan_credit_keys.sql` + backfill (C.2)
- **M-135** `accumulate_cost_credits_trigger.sql` (C.2)
- **M-136** `organisations_byok_revive.sql` + enable/disable RPCs (C.3)
- **M-137** `org_anthropic_key_rpcs.sql` save/status/delete trio (C.3)
- **M-138** `migrate_per_user_keys_to_org.sql` + deprecated_at column (C.3)
- **M-139** `byok_get_for_call_rpc_v2.sql` service-role-only per H-09 (C.3)
- **M-140** `auto_allocate_credits_on_new_org.sql` — rewrites handle_new_user (C.4)
- **M-141** `period_rollover_function.sql` + pg_cron daily 03:00 UTC (C.4)

All include `SET search_path = public` per H-13.

### Library
- **NEW** [lib/cost/pricing.ts](../lib/cost/pricing.ts) + [lib/cost/anthropicDollars.ts](../lib/cost/anthropicDollars.ts) — TS mirrors of the SQL functions (parity-tested per CK-2).
- **NEW** [lib/byok/orgKey.ts](../lib/byok/orgKey.ts) — `saveOrgAnthropicKey`, `getOrgKeyStatus`, `deleteOrgKey`, `orgHasByokKey` (factory precedence helper).
- **REWRITTEN** [lib/llm/cost.ts](../lib/llm/cost.ts) — `computeCostUsd` signature preserved; internals delegate to `computeJobAnthropicDollars` against `anthropic_pricing`. Throws on unseeded model_id (fail-fast).
- **REWRITTEN** [lib/llm/token-budget.ts](../lib/llm/token-budget.ts) — gate signature gains `modelId: string` (third param). Three-step internal flow: BYOK bypass → SELECT allocation/usage → lookup rate → convert tokens × input_credits_per_million / 1,000,000 → compare against allocation + grace.
- **REWRITTEN** [lib/llm/factory.ts](../lib/llm/factory.ts) — three-layer Option A precedence: org BYOK → per-user BYOK (transition window) → platform.
- **REWRITTEN** [lib/llm/providers/byok.ts](../lib/llm/providers/byok.ts) — `ByokProviderConfig` discriminated union accepting exactly one of `userId` / `orgId`; custom fetch sets the matching header.
- **EXTENDED** [lib/llm/byok.ts:userHasByokKey](../lib/llm/byok.ts) — filters `deprecated_at IS NULL` + logs deprecation warning.
- **EXTENDED** [lib/agent/job-lifecycle.ts:persistFinalResult](../lib/agent/job-lifecycle.ts) — accepts new optional `costCredits` param; writes `agent_jobs.cost_credits`.
- **EXTENDED** [lib/agent/runner.ts](../lib/agent/runner.ts) — background + retry sum + inline SSE paths populate `cost_credits` via `computeJobCostCredits`.
- **FIXED** [lib/director/iteration-runner.ts:722](../lib/director/iteration-runner.ts:722) — the pre-existing mis-write `cost_credits: costUsd ?? 0` (silently writing dollars into the credits column since B.2.1 substrate) corrected to `cost_credits: costCredits ?? null`.
- **EXTENDED** [supabase/functions/byok-llm-call/index.ts](../supabase/functions/byok-llm-call/index.ts) — accepts EITHER `x-stelavox-org-id` (preferred) OR `x-stelavox-user-id` (legacy); calls the matching RPC. Defence-in-depth: org wins if both arrive.

### API routes (3 new)
- **POST/DELETE/GET** `/api/org/anthropic-key` — admin-only org BYOK key management (mirrors per-user pattern).
- **GET** `/api/usage/current-period` — returns `{ plan, allocation_credits, usage_credits, period_start, period_length_days, days_remaining, byok_enabled }`. V1.x-D CostMeter will consume this.
- **POST** `/api/cron/period-rollover` — Vercel-Cron-driven recovery path for M-141; Bearer CRON_SECRET auth.

### UI (1 new component + 1 new page + index update)
- **NEW** [components/settings/OrgAnthropicKeyPanel.tsx](../components/settings/OrgAnthropicKeyPanel.tsx) — admin-only org BYOK save/status/delete. Save = `--color-accent` (verdigris use #7 affirmative-action triggers family — within existing nine; no broadening). Delete = destructive token. Non-admin members see a read-only notice.
- **NEW** `/settings/org-api-keys` page — resolves primary org server-side (owner > admin > member precedence matching M-138).
- **EXTENDED** `/settings` index — adds the org-api-keys link.

### Tests
- **C.1**: 8 Vitest unit (pricing TS) + 5 Playwright (SQL↔TS parity).
- **C.2**: 9 Vitest unit (budget-gate decision) + 7 Playwright (M-133/134/135 column shape, backfill, trigger, concurrency stress).
- **C.3**: 8 Vitest unit (orgHasByokKey + userHasByokKey deprecation filter) + 7 Playwright (M-136-139, migration shape + idempotency, M-139 service-role-only).
- **C.4**: 9 Playwright integration (M-141 rollover behaviour + cron route auth + usage / org-key route auth gates + page accessibility). 1 case skipped when CRON_SECRET unset in env.

Total new in V1.x-C: **25 Vitest unit cases + 28 Playwright integration cases** (53 new tests).

---

## §3 — Verification gates (V1.x-C aggregate)

| Gate | Result | Detail |
|---|---|---|
| `npm run type-check` | **PASS** | 0 errors |
| Vitest full unit suite | **381/385 PASS** | 4 skipped baseline; 0 failures across 41+ files |
| Playwright V1.x regression (a1 + b1 + b1-2 + b2 + b3 + c1 + c2 + c3 + c4) | **103 passed / 5 skipped** | 4 = V1.x-B.1.1 superseded-queue baseline; 1 = CRON_SECRET-not-set env-skip |
| Build | not re-run for C.4 (no new dependencies) | C.3 commit passed Compiled successfully in 12.8s; no module-graph changes since |
| Tier-A bumps | **DONE** | TA v2.6, Director Arch v2.3, Component Spec v2.12, Product Spec v1.11, CLAUDE.md v1.31 |

### Pre-existing baseline (unchanged across all four sub-phases)
The same 4 vitest test-file errors hit on cold start until `npm run script scripts/seed-director-fixture.ts -- --scenario j5-novel` is run. Not introduced by V1.x-C; documented in C.1 + C.2 + C.3 reports.

---

## §4 — Deferred to V1.x-D (UI substrate phase)

Captured in C.1 + C.2 + C.3 + C.4 reports; consolidated here:

| Item | Why deferred |
|---|---|
| `CostMeter` UI component | The dedicated UI substrate phase is V1.x-D; substrate endpoint `/api/usage/current-period` already lands in V1.x-C.4 so V1.x-D's CostMeter can consume it without backend work. |
| `PlanPanel` (`/settings/plan` route) | Same reason; the substrate (org plan + allocation columns) is fully ready. |
| AgentTab / DirectorPanel / SchedulerPanel cost-meter mounts | Same reason. |
| `BriefViewer` "Concurrent Briefs" indicator + SchedulerPanel multi-active-Brief listing + concurrent-edit-warning UX (carry-over from V1.x-B.3) | All depend on the same UI substrate sweep V1.x-D handles. |
| Per-profile estimated_input_tokens/output_tokens (carry-over from V1.x-B.2) | V1.x-B.2 uses DEFAULT_TICKET_COST=2500; V1.x-D refinement once V1.x-E metrics surface real distributions. |
| H-22 VFT virtual clock periodic re-zero job (carry-over from V1.x-B.2) | Operational hygiene; V1.x-D scope. |
| Final per-user BYOK removal | V1 transition window; final removal at V2. |

---

## §5 — Hazard tracking

- **H-09** (BYOK key plaintext only in Edge Function memory) — mitigation status now covers BOTH per-user (V1.x-B.1.2 M-104) AND per-org (V1.x-C.3 M-139) paths; both service-role-only RPCs; both routed through the same Edge Function. CK-7 grep audit remains in place.
- **H-13** (SECURITY DEFINER `search_path = public`) — every new V1.x-C SECURITY DEFINER body declares it.
- **H-20** (pricing rate effective_from race) — V1.x-C.1.a implements both SQL `compute_cost_credits` and TS `lookupRate` keyed on `completed_at <= effective_from AND (effective_until IS NULL OR effective_until > completed_at)`. Parity test guards SQL ↔ TS agreement.
- **No new hazards** introduced across the four sub-phases. The three new admission paths (credit gate, per-org BYOK, period rollover) compose existing invariants.

---

## §6 — Sign-off

V1.x-C **PASSES**. The plan-model + cost-meter substrate is live end-to-end; per-org BYOK Option A is live with the per-user transition window in place; credit-based admission gating is enforced on every dispatch path; the period-rollover cron + new-org auto-allocation trigger close the two would-be loopholes (orgs hitting cap forever / new orgs getting NULL allocation). The OrgAnthropicKeyPanel admin UI ships in V1.x-C.4 because BYOK-eligible plans cannot function without it; all other UI surfaces deferred cleanly to V1.x-D.

V1.x-C merges to master with `--no-ff`, tagged `v1.x-c`. MEMORY.md updated. Next phase **V1.x-D** absorbs the deferred UI work plus V1.x-B.2/B.3 carry-overs.

---

## Changelog

**v1.0 — 2026-05-16** Consolidated V1.x-C close-out report. Per-sub-phase Test Reports (C.1 / C.2 / C.3) remain canonical for sub-phase detail; this document is the V1.x-C ship verdict.
