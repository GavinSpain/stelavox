# Round-3 audit — remediation progress

Tracking file for the 7-phase remediation against [10-remediation-plan.md](10-remediation-plan.md).

**Total findings to close:** 258 (48 HIGH / 121 MEDIUM / 89 LOW)
**Phases 1–7 target:** ~98 findings (all HIGH + ~50 MEDIUM)
**Phase 8+ rolling:** ~140 LOW + low-leverage MEDIUM

**Status legend:**

- `open` — not yet started
- `in-progress` — batch in flight
- `resolved` — fix landed, regression test green
- `deferred-vN` — deferred to V1.x or V2 (with reason)
- `wontfix-with-reason` — closed without fix (with reason)
- `false-positive` — finding was wrong on re-examination

---

## Status by phase

| Phase | Batches planned | Batches done | Findings closed | State |
|---|---|---|---|---|
| 0 — Setup | 0 | — | — | done |
| 1 — Pattern fixes | 4 | 2 | 6 | in-progress (B1.2 done) |
| 2 — Root-cause cascades | 3 | 0 | 0 | open |
| 3 — Silent-failure | 6+ | 0 | 0 | open |
| 4 — DB constraints | 5 | 0 | 0 | open |
| 5 — Security + audit_log | 7 | 0 | 0 | open |
| 6 — Two-source-of-truth | 4–5 | 0 | 0 | open |
| 7 — Inviolables + UI + spec | 5 | 0 | 0 | open |
| 8+ — Long tail | rolling | 0 | 0 | open |

---

## Batch log

### Batch B1.2 — `.single()` → `.maybeSingle()` in tests/helpers

- **Phase:** 1
- **Findings closed:** F-258, F-259
- **Plan said 3 sites; actual is 2.** Per audit's F-261 ("No additional anti-patterns surfaced beyond F-257/F-258/F-259") and re-review of all 28 `.single()` sites in tests/helpers, only F-258 and F-259 are H-01 violations. The other 26 are legitimate (INSERT-then-`.select('id').single()` validation; fixture-precondition lookups where zero rows IS the bug).
- **Test-feasibility:** observable-via-mock (extended `tests/unit/h01-maybesingle.test.ts` with 2 cases, mocking `@supabase/supabase-js.createClient` so the helper's `adminClient()` factory routes through our chain spy)
- **Failing-test-first proof:** F-258 red on terminal-method assertion (`'single'` not `'maybeSingle'`); F-259 red with `"Cannot read properties of null (reading 'organisation_id')"` instead of the post-fix informative error. Both green after the fix.
- **F-259 also drops a `data!` non-null assertion** that would have produced a confusing crash — replaced with explicit `if (!data) throw new Error(...)`. Audit categorised this as silent-failure adjacent; the H-01 fix and the silent-failure fix landed together because the same line touched both.
- **Completed:** 2026-05-10
- **Status:** resolved
- **Verification gates:** type-check ✓ • lint ✓ • vitest 110/110 ✓ • build ✓
- **Process observations:** plan-list verification continues to be required (plan said 3, audit text says 2 for H-01 specifically — F-257 was a different finding). The strategy from B1.1's observation #1 is paying off.

### Batch B1.1 — `.single()` → `.maybeSingle()` in production lib/data (pilot)

- **Phase:** 1
- **Findings targeted (planned):** F-144, F-148, F-155, F-163, F-179
- **Findings actually closed:** F-144, F-148, F-155, F-163 *(F-179 dropped — see process observations: it was misclassified in the plan; it's actually a `validateProfile` security finding, not a `.single()` site)*
- **Test-feasibility:** observable-via-mock for F-144 / F-148 / F-155; structural for F-163 (comment-only fix)
- **Test added:** `tests/unit/h01-maybesingle.test.ts` (3 tests)
- **Failing-test-first proof:** all 3 tests red against pre-fix code (PGRST116 in error field), green after the wrapper change to `.maybeSingle()`
- **Route changes:** `app/api/projects/[projectId]/route.ts` and `app/api/documents/[documentId]/route.ts` gained null-data guards mapping the new clean-null return to `err.notFound()`. Without these route changes the wrapper fix would have *worsened* behavior (200 with null body instead of 500).
- **Started / completed:** 2026-05-10
- **Status:** resolved
- **Verification gates:** type-check ✓ • lint ✓ (0 errors) • vitest 108/108 ✓ • build ✓
- **Process observations:** captured below.

---

## Findings index

This section is a one-line-per-finding ledger. Updated when a finding's status changes.

| ID | File | Status | Batch | Notes |
|---|---|---|---|---|
| F-144 | lib/data/projects.ts | resolved | B1.1 | `.single()` → `.maybeSingle()` + route 404 guard |
| F-148 | lib/data/documents.ts | resolved | B1.1 | `.single()` → `.maybeSingle()` + route 404 guard |
| F-155 | lib/data/nodes.ts | resolved | B1.1 | `.single()` → `.maybeSingle()`; route already had null guard |
| F-163 | lib/data/context-links.ts | resolved | B1.1 | comment fix only — code was correct, prior comment described non-existent semantics |
| F-179 | lib/agent/* | open | (mis-targeted by plan) | not a `.single()` finding — `validateProfile` security finding; defer to its own future batch |
| F-258 | tests/helpers/db.ts | resolved | B1.2 | `.single()` → `.maybeSingle()`; user with no org now returns clean null |
| F-259 | tests/helpers/agent-fixtures.ts | resolved | B1.2 | `.single()` → `.maybeSingle()`; informative error replaces `data!` crash |

(Remaining 251 findings to be added as their batches start.)

---

## Process observations

Captured at the end of each pilot/early-phase batch. Goal: identify protocol friction before going autonomous.

### Batch B1.1 (pilot) — observations

1. **The plan's per-finding list was wrong in one spot.** B1.1 listed F-179 as a `.single()` site; it's actually a security finding about `validateProfile` accepting user-passed `profile_id` without verifying `is_system_profile`. The audit doc was correct; the plan's batch composition was wrong.
   - **Going forward:** before each batch, grep for the finding ID in the audit doc and read its severity + category line. Don't trust the batch list alone.
   - **Plan correction needed:** when we hit Phase 1 B1.2 / B1.3 / B1.4 etc., the same per-finding verification.

2. **Wrapper-only fixes can break the route.** Changing `.single()` → `.maybeSingle()` in F-144 and F-148 changes the return shape (`{data: null, error: {…}}` → `{data: null, error: null}`). Without a corresponding route-layer null guard, the route would return 200 with `project: null` — *worse* than the pre-fix 500. The fix had to extend to the route. F-155's route already had a `!updated` guard so the wrapper change was safe alone.
   - **Going forward:** for any wrapper signature/behavior change, grep for callers and confirm each one handles the new shape correctly. If not, the route fix is part of the same batch — that's not "refactor adjacent code" (forbidden), it's "complete the fix at the consumer boundary" (required).

3. **F-163 was a structural finding (comment fix only).** Code was correct; the comment described non-existent `.maybeSingle()` zero-row semantics for UNIQUE violations. The actual mechanism is the PostgREST 23505 error path, regardless of terminal method. No runtime test possible — verified by code review per the protocol's structural-finding honesty exception.

4. **Failing-test-first protocol worked cleanly.** Mocked supabase chain that returns different shapes for `.single()` vs `.maybeSingle()` is a clean test pattern: it makes the H-01 contract observable without needing a live DB. The 3 tests went red on pre-fix code (PGRST116 in error field), green after the wrapper change. Total batch wall-clock: ~10 minutes, dominated by reading the call sites and writing the test.

5. **Comment-vs-code-mismatch is a *real* category.** F-163 demonstrated the audit lens working: the audit caught a comment lying about the code, and the lens led to fixing the comment rather than blindly following its claim. Worth re-emphasising in remaining batches: where comment and code disagree, both must be re-justified from first principles before fixing either.

6. **Local Supabase stack was not required for this batch.** Vitest with mocked chain was sufficient. For batches that change DB-side semantics (Phase 4), real DB access will be needed — the existing Playwright `tests/api/*.spec.ts` infra handles that.

7. **Process timing.** Pilot batch from start to commit-ready: ~30 minutes incl. reading 4 audit findings, 4 source files, 2 route files, writing tests, applying fixes, running gates. Reasonable cadence for ~3 actionable findings + 1 comment fix per batch. Larger batches (10–15 findings) will probably take 1.5–2 hours.

---

## Phase-boundary smoke results

| Boundary | Date | Smoke result | Notes |
|---|---|---|---|
| (none yet) | | | |

---

## Snapshot tags

| Tag | Commit | Date | Reason |
|---|---|---|---|
| (none yet) | | | |
