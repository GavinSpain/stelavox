# Phase 8.5c — Test-Baseline Cleanup — Test Report
## Version 1.0
**Date:** 2026-06-08
**Branch:** `claude/phase8-5c-test-baseline-cleanup`
**Verdict:** ✅ **PASS** (baseline cleared from 8 failed → 0 failed; 26 skipped tests recovered)

---

## 0. Executive summary

Phase 8.5c attacks the "8 baseline failures" that accumulated across the Phase 8.5b sub-phases. The pattern of accepting them as "pre-existing baseline" had become a euphemism for "we never looked." This sub-phase looked.

### 0.1 Results

| Metric | Pre-8.5c | After 8.5c | Δ |
|---|---|---|---|
| Tests passing | 1031 | **1065** | +34 |
| Tests failing | 8 | **0** | -8 |
| Tests skipped (by error) | 26 | **0** | -26 |
| Tests skipped (intentional) | 7 | 7 | unchanged |
| Test files passing | 114 | 121 | +7 |
| Test files failing | 7 | 0 | -7 |

Type-check clean. Suite signal is restored — the next push that introduces a regression will be visible.

### 0.2 The three categories

| Category | Failure shape | Root cause | Fix |
|---|---|---|---|
| **1 — Seed gap** | 4 test files fail at `beforeAll` with `seeded user has no organisation_members row` | `j5-walk@example.com` + `_stelavox_probes@stelavox.local` had no membership row | Repair script populates row via service-role client |
| **2 — Mock drift** | 7 test cases fail with `expected ... to be 1 but got +0` or `Cannot read 'payload' of undefined` | Apollo-era mocks don't intercept the post-Apollo `transitionAgentJob` CAS lookup against `allowed_transitions` | Update mocks to emulate the post-Apollo orchestration shape |
| **3 — Local DB drift** | 1 audit test fails: `director_turns.iteration_count != COUNT(agent_jobs)` for 4 turns | 4 May-23 turns predate the M-207 rollup trigger | Direct SQL `UPDATE director_turns SET iteration_count = …` backfill |

Each category had a distinct fix; the cumulative effect is the green suite.

## 1. Category 1 — Seed gap

### 1.1 Diagnosis

Four files (`canonical-order.test.ts`, `db-constraints.test.ts`, `director-summarisation.test.ts`, `tool-validator.test.ts`) all fail at the same lookup pattern in `beforeAll`:

```ts
const { data: member } = await admin
  .from('organisation_members')
  .select('organisation_id')
  .eq('user_id', user.id)
  .maybeSingle()
if (!member) throw new Error('seeded user has no organisation_members row')
```

The tests look for `test-a@example.com`, then `j5-walk@example.com`, then any user. The first two don't have memberships; the fallback's choice (whichever first user the API returns) also doesn't.

The `handle_new_user` trigger that auto-creates an org + membership row exists on `auth.users`. The fixture users must have been created before that trigger landed, or via a path that bypassed it.

### 1.2 Fix

`scripts/repair-test-user-memberships.ts` (NEW) — idempotent service-role-client script that:

1. Reads `j5-walk@example.com`, `_stelavox_probes@stelavox.local`, `test-a@example.com` from `auth.users`
2. For each present user without an `organisation_members` row, creates a dedicated org (slug = email-prefix + first-8-of-uuid) and inserts the user as `'owner'`
3. Reports created / already-ok / not-found counts

Runs against local DB only (refuses cloud URLs). Mirrors the `handle_new_user` trigger's logic but for retro-fitting.

Result: 2 orgs created, 1 user not found (`test-a@example.com` doesn't exist locally).

### 1.3 Second-level fix: `j5-novel` project seed

After Category 1's repair landed, `director-summarisation.test.ts` and `tool-validator.test.ts` still failed because they require the `j5-novel` project to exist. `scripts/seed-director-fixture.ts` exists for this but had a compile-time stale reference to `nodes.lock_reason` (dropped by Phase 6 M-154).

Fix: edit `scripts/seed-director-fixture.ts` to drop the now-removed `locked` + `lock_reason` columns from the INSERT and apply locks post-insert via `apply_author_lock` RPC (the canonical Phase 6 path).

After running with `--scenario j5-novel --reset`, all 4 files in Category 1 pass.

## 2. Category 2 — Mock drift

### 2.1 Diagnosis

Two files: `agent-job-lifecycle-queue-status.test.ts` (4 cases) and `v1x-b2-batch-submitter.test.ts` (3 cases). Both use hand-rolled supabase fakes that intercept `from('agent_jobs').update(...)`.

The V1.x-Apollo refactor (M-205, 2026-05-23) tightened agent-job state transitions to a CAS-protected pattern. The new flow:

1. `casLookupSources(supabase, 'agent_jobs', event, target)` reads `allowed_transitions` → returns the legal source states for the event
2. `supabase.from('agent_jobs').update(...).eq('id', X).in('state', [src,…]).select('id, state').maybeSingle()` performs the CAS-guarded UPDATE

The Apollo-era fakes don't intercept the `allowed_transitions` read. `casLookupSources` returns `{ expectedSources: [], error: 'no_transition_for_event' }`, the transition short-circuits before the agent_jobs UPDATE, and the assertion fails.

### 2.2 Fix

For each file, the mock supabase gains:

- A handler for `from('allowed_transitions').select('from_state').eq('event_name', X).eq('to_state', Y)` that returns `[{from_state: ...}]` based on a small lookup table sourced from the real `allowed_transitions` rows
- A chainable `update().eq().in().select().maybeSingle()` proxy that applies the patch in-place to the mock tickets and resolves with a success row

For `v1x-b2-batch-submitter.test.ts` specifically, the mock also emulates the auto-derive trigger that maps `state → queue_status` so legacy column assertions still pass.

### 2.3 Verdict

Lifecycle: 4/4 pass. Batch-submitter: 4/4 pass.

## 3. Category 3 — Local DB drift

### 3.1 Diagnosis

`m173-m174-h26-audit.test.ts > #12 — director_turns.iteration_count matches COUNT(agent_jobs)` walks every `director_turns` row in the local DB and asserts `iteration_count` matches `COUNT(agent_jobs WHERE director_turn_id = row.id)`.

The test found 4 turns where `iteration_count = 0` but `COUNT(*) = 7 / 4 / 4 / 4`. All four were dated 2026-05-23, before the M-207 rollup trigger landed that synchronises `iteration_count` on `state` transitions.

The test is correct as a regression guard. The DB just has 4 stragglers from before the trigger's predecessor (M-109) was rewritten in M-207.

### 3.2 Fix

Direct SQL backfill:

```sql
UPDATE director_turns dt
SET iteration_count = (SELECT count(*) FROM agent_jobs aj WHERE aj.director_turn_id = dt.id)
WHERE dt.iteration_count != COALESCE((SELECT count(*) FROM agent_jobs aj WHERE aj.director_turn_id = dt.id), 0);
```

4 rows updated. Re-running the audit: drift = 0. Test passes.

This was a one-shot local-DB cleanup — not committed as a migration because the cloud DB doesn't have this drift (the M-109 / M-207 sequence on cloud was applied to a fresh state).

## 4. What this restores

### 4.1 26 previously-skipped tests now running

The 4 file-level setup failures cascaded into many "skipped" tests inside those files. After the seed fix, 26 of those tests are actually running and asserting their conditions. The increment from 1031 → 1065 passing reflects both:

- The 8 directly-fixed test cases (7 mock-drift + 1 audit)
- The 26 tests that were silently skipped because their file's `beforeAll` threw

### 4.2 Signal restored

Before 8.5c, the suite-pass condition was "1031 passing + 8 known failures". Anyone introducing a 9th failure would face an ambiguous read: is this the existing baseline plus my regression, or pure baseline?

After 8.5c, "0 failed" is the contract. The next push that breaks something will be immediately visible. The pre-push gate from B.7 (bundle budget) complements this — the suite says "the code works as designed" and the gate says "the bundle stayed within budget."

## 5. Files in this commit

**New:**
- `scripts/repair-test-user-memberships.ts` — idempotent membership repair
- `docs/stelavox_phase8_5c_test_report_v1_0.md` (this file)

**Modified:**
- `scripts/seed-director-fixture.ts` — drop stale `locked` + `lock_reason` columns; apply locks via `apply_author_lock` RPC
- `tests/unit/agent-job-lifecycle-queue-status.test.ts` — fake supabase intercepts `allowed_transitions` + chains `.update().eq().in().select().maybeSingle()` correctly
- `tests/unit/v1x-b2-batch-submitter.test.ts` — same shape + auto-derive trigger emulation for `queue_status`

**Local DB (one-shot, no code commit):**
- `organisation_members` rows added for `j5-walk@example.com` + `_stelavox_probes@stelavox.local`
- `j5-novel` project re-seeded
- 4 `director_turns` rows backfilled to clear iteration_count drift

## 6. Acceptance criteria

| Criterion | Status |
|---|---|
| 4 file-level setup failures unblocked (Cat 1) | ✅ |
| 7 mock-drift test cases fixed (Cat 2) | ✅ |
| 1 audit drift test passes (Cat 3) | ✅ |
| Full Vitest: 0 failed | ✅ 1065 / 0 / 7 |
| 26 previously-skipped tests recovered | ✅ skipped count 33 → 7 |
| Type-check clean | ✅ |
| Repair script idempotent (re-running is no-op) | ✅ verified |
| Test Report PASS | ✅ this document |

## 7. Risks + follow-up

### 7.1 No code-path regressions

The mock changes update test-side instrumentation only. The lifecycle + batch-submitter implementations are unchanged.

### 7.2 Local-DB cleanup is not auto-applied to cloud

The 4 `director_turns` backfill ran against local DB only. The cloud DB doesn't have this drift today; the M-205/M-207 trigger sequence keeps it out going forward.

### 7.3 The `handle_new_user` trigger gap remains

The trigger should auto-create org + membership for every new user. The fixture users that lack memberships predate the trigger or were inserted via a path that bypassed it. Future fixture seeders (`scripts/seed-director-fixture.ts`, `scripts/seed-mega-doc.ts`, etc.) should either rely on the trigger firing OR call `apply_author_lock` / membership-creating RPCs explicitly. The repair script is the fallback for when prior fixtures land in a corrupt state.

### 7.4 No production code in this commit

The cleanup is **purely** test-infrastructure + local-DB repair. No `lib/` changes, no migrations, no API routes. The lifecycle + batch-submitter production code keeps working exactly as it did before; the tests now verify it.

## 8. Recommendation

**Recommend merge to master.** This restores the suite's status as a real signal. Subsequent sub-phases can rely on "0 failed" as the contract; the noise floor that obscured potential regressions is gone.

---

## Changelog

**v1.0 — 2026-06-08** Initial Test Report for Phase 8.5c (test-baseline cleanup). PASS verdict. Baseline failures dropped from 8 to 0; previously-skipped (by-error) tests recovered (26 of them); total passing went 1031 → 1065. Three categories addressed: (1) `organisation_members` repair script + fixture seed re-run; (2) supabase-fake mock updates for post-Apollo `transitionAgentJob` CAS flow in agent-job-lifecycle + v1x-b2-batch-submitter; (3) one-shot SQL backfill of 4 May-23 `director_turns` rows with `iteration_count = 0` to match actual `agent_jobs` counts. Side fix: `scripts/seed-director-fixture.ts` dropped the now-removed `locked` + `lock_reason` columns from its INSERT (Phase 6 M-154 dropped them) and applies locks via the `apply_author_lock` RPC instead. Pure test-infrastructure + local-DB cleanup — no production code touched. Type-check clean. Going forward, the suite returns "0 failed" as the contract; the next regression will be visible.
