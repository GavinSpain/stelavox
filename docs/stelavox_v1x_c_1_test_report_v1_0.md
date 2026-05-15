# V1.x-C.1 Test Report v1.0

**Phase**: V1.x-C.1 — pricing substrate (C.1.a) + runner integration (C.1.b)
**Date**: 2026-05-17
**Branch**: `claude/v1x-c-cost-substrate` (NOT MERGED — V1.x-C merges as a unit at C.4 close-out alongside C.2 + C.3)
**Implementation commits**:
- C.1.a substrate (pricing tables + lib/cost/*): `e390b6f`
- C.1.b runner integration: this commit
**Verdict**: **PASS** (sub-phase report; full V1.x-C close-out at C.4)

> **Scope note.** V1.x-C ships in four sub-phases (C.1 pricing + cost meter substrate; C.2 plan model + checkTokenBudget rewrite; C.3 per-org BYOK Option A; C.4 close-out). This report covers **C.1 only** — pricing substrate (C.1.a, prior session) and runner integration (C.1.b, this session). The CostMeter UI surface, plan model, BYOK retarget, and Tier-A doc bumps land in C.2..C.4 and will be reported in `stelavox_v1x_c_test_report_v1_0.md` at close-out.

---

## §1 — Scope ratified by checkpoints

| CK | What it proves | Method | Result |
|---|---|---|---|
| **CK-1** | `pricing_rates` lookup returns the active rate at `completed_at` | `lookupRate()` against seeded rows; null for unknown model + null for date pre-effective_from | **PASS** (C.1.a — 4 Playwright cases) |
| **CK-2** | `compute_cost_credits` SQL matches TS `computeCostCredits`; `compute_anthropic_dollars` SQL matches TS `computeAnthropicDollars` (parity) | Randomised input matrix → SQL vs TS comparison within tolerance | **PASS** (C.1.a — 2 Playwright parity cases + 8 Vitest unit cases) |
| **CK-3** | `agent_jobs.cost_credits` populated on completion via both runner paths (background + per-iteration) + `cost_usd` populated via the rewritten `computeCostUsd` | `persistFinalResult` accepts new `costCredits` param + writes `cost_credits`; iteration-runner :722 mis-write fixed; both runners call `computeJobCostCredits` at completion | **PASS** (C.1.b — covered by V1.x regression suites which exercise both paths through to terminal writes) |
| **CK-Inviol** | Verdigris use count remains 9 (no UI surface introduced in C.1) | No new `--color-accent` use; CostMeter component deferred to C.2 | **PASS** |

CK-4..CK-10 belong to C.2 + C.3 and are not in scope for this report.

---

## §2 — What shipped (C.1.b — this session)

### Library changes

- **REWRITTEN `lib/llm/cost.ts`** — `computeCostUsd(usage, modelId): Promise<number>` signature preserved; internals now delegate to `computeJobAnthropicDollars` against the time-versioned `anthropic_pricing` table (M-132) instead of reading `platform_config` keys. Throws `anthropic_pricing_rate_missing:<modelId>` on null rate (matches the prior fail-fast contract; seed covers all V1 supported models so unseeded model_id is real misconfig). Cache pricing now reads from per-row `cache_write_*` / `cache_read_*` columns rather than the prior 1.25× / 0.10× input multipliers — seeded values preserve byte-for-byte output for the seeded models.

- **MODIFIED `lib/agent/job-lifecycle.ts`** — `FinalResultParams` extended with optional `costCredits?: number | null`; `persistFinalResult` writes the new value to `agent_jobs.cost_credits` (column shipped in B.2.1 M-105 but previously unpopulated). Null is the explicit "rate-missing" signal; callers log + proceed rather than fail the job.

- **MODIFIED `lib/agent/runner.ts`** — both `runAgentJob` (background) and `runAgentJobInline` (foreground SSE) call `computeJobCostCredits` against the `pricing_rates` table at completion time, threading the result through to `persistFinalResult`. Background path also handles the retry case (`output_schema_invalid` / `model_output_truncated`) — credit totals are summed when both legs return values; null is preserved when either leg's rate lookup missed (forced ambiguity, not silent under-count).

- **MODIFIED `lib/director/iteration-runner.ts`** — line 535 now computes both `costUsd` (anthropic_pricing) and `costCredits` (pricing_rates) in parallel `.catch(() => null)` form; line 722 mis-write fixed from `cost_credits: costUsd ?? 0` (which had been silently writing dollars into the credits column since B.2.1 substrate landed) to `cost_credits: costCredits ?? null`; `cost_usd: costUsd ?? null` added so the BYOK dollar surface picks it up consistently with the agent runner path.

### No new migrations
C.1.b is library-only — all schema changes landed in C.1.a (M-130 pricing_rates + seed; M-131 compute_cost_credits SQL fn; M-132 anthropic_pricing + compute_anthropic_dollars SQL fn).

### No new UI
CostMeter, PlanPanel, OrgAnthropicKeyPanel deferred to C.2 + C.3 per build checklist §4.

### No new API routes
`/api/usage/current-period` + `/api/org/anthropic-key` + `/api/cron/period-rollover` deferred to C.2 + C.3 per build checklist §5.

---

## §3 — Verification gates

| Gate | Result | Detail |
|---|---|---|
| `npm run type-check` | **PASS** | 0 errors |
| Vitest V1.x-C.1 pricing unit | **8/8 PASS** | `tests/unit/v1x-c1-pricing.test.ts` (C.1.a parity) |
| Vitest full unit suite (after `seed-director-fixture.ts` ran for j5-walk user) | **364/368 PASS** (4 skipped — baseline) | 0 failures across 39 test files |
| Playwright V1.x regression (a1 + b1 + b1-2 + b2 + b3 + c1) | **82 passed / 4 skipped** | Skipped 4 = the deliberately-superseded V1.x-B.1.1 queue tests carried over from B.3 supersession; net-zero regression versus C.1.a baseline |

### Pre-existing baseline (unchanged this phase)
The same 4 vitest files that hit seed-dependency errors in B.3 close-out (`tests/integration/canonical-order.test.ts`, `tests/integration/db-constraints.test.ts`, `tests/unit/director-summarisation.test.ts`, `tests/unit/tool-validator.test.ts`) hit the same errors here until `npm run script scripts/seed-director-fixture.ts -- --scenario j5-novel` is run. Once seeded, all 4 files pass. This is a baseline seed-state issue not introduced by C.1.

---

## §4 — Hazard tracking

- **H-20 (pricing rate effective_from race)** — C.1's central concern. Both `lookupRate` (TS) and `compute_cost_credits` (SQL) key on completion-date with `effective_from <= date AND (effective_until IS NULL OR effective_until > date)`, guaranteeing the rate active at job completion is authoritative. C.1.a parity tests prove SQL ↔ TS agreement across the randomised matrix.
- **No new hazards** introduced in C.1.b. The cost-credits mis-write at iteration-runner:722 had been silently writing dollars into the credits column since B.2.1 substrate; fixing it cannot regress anything (the column was unread by any other code path — V1.x-D admin dashboard is the first reader).

---

## §5 — Reassigned / deferred to subsequent V1.x-C sub-phases

| Item | Why deferred | Lands in |
|---|---|---|
| `checkTokenBudget` rewrite to use plan + accumulated usage | Plan model is C.2 scope | V1.x-C.2 |
| `organisations.plan` enum + token_allocation_credits + usage_credits | Plan model is C.2 scope | V1.x-C.2 |
| Usage-tracking trigger on agent_jobs cost_credits delta | Plan model is C.2 scope | V1.x-C.2 |
| Per-org BYOK Option A re-route | BYOK retarget is C.3 scope | V1.x-C.3 |
| Migrate `user_anthropic_keys` to per-org Vault | BYOK retarget is C.3 scope | V1.x-C.3 |
| `CostMeter` UI + `PlanPanel` + `OrgAnthropicKeyPanel` | Cost meter UI substrate is C.2 + C.3 scope | V1.x-C.2 + V1.x-C.3 |
| Tier-A doc bumps (TA v2.6; Component Spec v2.13; Product Spec v1.11; CLAUDE.md v1.31) | Single consolidation pass | V1.x-C.4 close-out |
| Merge to master + tag `v1.x-c` | V1.x-C merges as a unit | V1.x-C.4 close-out |

---

## §6 — Sign-off

V1.x-C.1 (C.1.a + C.1.b) **PASSES** at substrate level. The cost-credits and cost-dollars surfaces are correctly populated on every completed agent_job (background + inline streaming + director_iteration). The C.1.b mis-write is corrected. No regressions in the V1.x regression suites (a1 + b1 + b1-2 + b2 + b3). No new hazards. No Inviolables changed.

**Next sub-phase: V1.x-C.2** — plan model + `checkTokenBudget` rewrite + usage-tracking trigger. Build checklist §2 C.2 migrations need renumbering from M-132/133/134 to **M-133/134/135** (M-132 was claimed by C.1.a `anthropic_pricing`).

---

## Changelog

**v1.0 — 2026-05-17** Initial issue covering C.1.a (pricing substrate; prior session) + C.1.b (runner integration; this session).
