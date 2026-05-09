# Phase 5d hardening — session 1 close-out

**Date:** 2026-05-09
**Master at start:** `1c5142a` (round-3 close-out report shipped)
**Master at close:** `15fad88` (Tier 0 fixes) + `52b1b24` (monkey framework on branch)
**Local stack:** running — Supabase 54331, dev server 3000

## What landed (Tier 0 — five V1 SUs closed + 10 unit tests added)

| ID | Fix | Files | Master |
|---|---|---|---|
| **SU-J14-5** | Resume route resets failed steps to `pending` before calling `advanceWorkflow`. Resume now actually retries the failed step instead of being a visible no-op. | `app/api/director/workflows/[workflowId]/resume/route.ts` | `15fad88` |
| **SU-J14-6** | Pre-flight `checkSummaryNonEmpty()` helper in `lib/api/agent-operation-helper.ts`; wired into both synthesise routes (foreground + streaming). New 422 `summary_required` error code with friendly message. AgentTab `friendlyError()` recognises `summary_required` and renders an "add a summary first" explanation. | `app/api/agent/synthesise/route.ts`, `app/api/agent/synthesise/stream/route.ts`, `lib/api/agent-operation-helper.ts`, `lib/api/errors.ts`, `components/detail/AgentTab.tsx` | `15fad88` |
| **SU-J14-4** | ExecutionCard heartbeat reads as fresh during a `HEARTBEAT_FRESH_MS` grace window from `workflow.created_at`, even when `last_heartbeat_at` is null. The "stalled" indicator no longer flashes on workflows that were just dispatched. | `components/director/ExecutionCard.tsx` | `15fad88` |
| **SU-J14-3** | Agent runner retries the LLM call once on `output_schema_invalid` / `model_output_truncated`. Tracks both calls' usage and cost so the author sees true spend. Other failure modes (injection_blocked, canary_leak, network) fail straight as before. | `lib/agent/runner.ts` | `15fad88` |
| **SU-J14-1 verify** | Trigger contract verified end-to-end via raw psql against local Postgres. All 5 invariants pass: autosave bumps `content_revision` only; rename bumps neither; GUC bump bumps both; same-content no-op bumps neither; tamper attempt setting `version=99` directly is overridden by trigger. | (verification only, no code change) | (verified) |

**10 new Vitest unit tests** in `tests/unit/summary-required-check.test.ts` cover the J14-6 contract: null / empty / whitespace / Tiptap stub / Tiptap-with-marks-but-no-text / nested text / plain-text passthrough.

**Type-check clean. Production build succeeds. 105/4 vitest pass (was 95).**

## Hardening infrastructure delivered

| Asset | Path | Purpose | Status |
|---|---|---|---|
| Monkey framework | `tests/phase5d/jx-monkey.spec.ts` | Random-walk Playwright spec — 9 valid CRUD/state-machine operations, deterministic seed, asserts no orphans + no 5xx + no console errors at end. | Authored, not yet running due to Playwright webServer race in this environment |
| Tier 1 spec | `tests/phase5d/tier1-untested-surfaces.spec.ts` | Drives locked-node behaviour, context links, version history, delete cascades, move semantics. ~14 cases. | Authored, blocked by same webServer race |
| TS hardening drive | `scripts/hardening-drive.ts` | Direct API + Postgres script for Tiers 1+2+4+6. Comprehensive boundary/concurrency/RLS coverage. ~30 cases. | Authored, blocked by SSR cookie-auth shape (script uses Bearer; routes use `@supabase/ssr` cookie reading) |

The infrastructure is real and committed. The run-loop is blocked by environment-level auth-shape issues that need a small wrapper to bridge: either set the SSR auth-token cookie in the script's fetch calls, or drive via Playwright's `request` fixture in a way that doesn't trip the webServer race.

## What's not yet done

### Tier 0 → Tier 1 transition

The Tier 0 fixes are real and shipped. The Tier 1 evidence (locked-node behaviour observed, context-link CRUD verified, delete-cascade verified, move-cycle prevention verified) needs the test infrastructure to actually run. Each of those surfaces is wired up in the spec files; the tests would either:
- Pass — confirming Phase 5d's existing coverage extends to the round-3-untested surfaces; or
- Fail — surfacing more SUs of the same silent-failure family.

Best estimate from code-reading: the locked + context-link + delete-cascade paths look correct in the route files. Move semantics has more surface area; cycle-prevention is in `app/api/nodes/[nodeId]/move/route.ts` and looks correct on inspection. The HIGH-yield bug surfaces from earlier rounds (silent failure UX) may not lurk in these mature code paths.

### Tiers 2-8 not started

| Tier | Status |
|---|---|
| 2 — boundary / data extremes | Cases enumerated in `scripts/hardening-drive.ts` (~14 cases). Authored, not run. |
| 3 — unusual but valid paths | Not authored. Plan in v1.0 hardening report. |
| 4 — concurrency / failure injection | 3 cases enumerated in `scripts/hardening-drive.ts`. Authored, not run. |
| 5 — long-running / accumulation | Not authored. |
| 6 — RLS / permission edges | 5 cases enumerated in `scripts/hardening-drive.ts`. Authored, not run. |
| 7 — a11y / i18n | Not authored. Best driven via Chrome MCP + manual passes. |
| 8 — monkey run | Framework authored. First run blocked by webServer race. |

## Recommended next session

**Focus: unblock the run-loop, then chew through the tiers.**

1. **Fix the run-loop** (~30 min):
   - Option A: change `scripts/hardening-drive.ts` to set the SSR auth-token cookie shape (`sb-<projectref>-auth-token`) instead of `Authorization: Bearer`. Sign in via REST, parse the token, format the cookie.
   - Option B: change `tests/phase5d/jx-monkey.spec.ts` and `tier1-untested-surfaces.spec.ts` to bypass `webServer` config — set `webServer: undefined` or use a dedicated `npm run dev:port-3001` script + `reuseExistingServer: true` with an explicit different baseURL.
   - I'd advocate Option A — the tsx drive is the better long-term tool because it's faster to iterate and bypasses Playwright entirely.

2. **Run Tier 1 → Tier 6 sequentially** (~3-4 hours including fix-and-pin loops). Each tier's failures get a focused commit + regression-pin.

3. **Author Tiers 3, 5, 7** (Tier 3 is small, Tier 5 needs scale fixtures, Tier 7 is largely Chrome MCP work).

4. **Cloud verification** at the end — sweep the same tiers against `stelavox.vercel.app` to confirm no deploy-config drift.

5. **Final hardening close-out report** with bug-rate summary across all tiers.

## Decision points for next session

- Confirm Option A (tsx + cookie auth) vs Option B (Playwright webServer fix).
- Confirm the bug-rate threshold for "launch-acceptable" (proposed: 3 consecutive tier passes producing zero new SUs of severity HIGH).

## Cost

LLM cumulative this session: $0.00 (no agent operations driven; Tier 0 was code-only, framework was code-only).

## Honest read

This session shipped the four open V1 SU-J14 fixes and authored the hardening infrastructure. The run-and-fix loop is one focused session away from producing the next batch of SUs. The infrastructure is real and reusable.

Confidence on bugs **slightly improved** from yesterday's medium read: the four highest-severity silent-failure paths (J14-3 LLM determinism, J14-4 heartbeat misreport, J14-5 unrecoverable workflow, J14-6 prose-from-meta-conversation) are now closed. The unknown-unknowns in untested surfaces remain unknown.

Recommendation: **next session is unblock-and-run, not author-more-fixtures.** The infrastructure can support 2-3 weeks of focused tier work; the goal now is to spend the tokens (well under your $10 ceiling) and surface the next batch of SUs.

End of report.
