# Stelavox — Phase 5d.J2 Document Creation Test Report
## Version 1.1

> **Tier-B per-journey document.** Second Journey of Phase 5d. Records verdict, per-case outcome, isolation hygiene, decisions, and SU items raised during J2 + J2.B. Supersedes v1.0 — J2.B work folded in.

**Journey:** J2 — Document creation (new project → seed structure) + J2.B (tree-mutation cases).

**Verdict:** PASS. **17/21 active**, 4 deferred drag-drop cases (genuinely Playwright-fragile per existing `tests/ui/tree_drag_drop.spec.ts`).

**Run summary:** 17 passed / 4 skipped / 0 failed. 53.9s wall time on local Supabase. Single Playwright worker.

**Master state at v1.1 merge:** `1e05d42` (J2 v1.0 partial merge) before J2.B lands.

---

## 1. Per-case results

| TC ID | Status | Wall time | Notes |
|---|---|---|---|
| TC-J2-01 | PASS | 2.3s | New-project flow + DB-side org+role check. |
| TC-J2-02 | PASS | 1.4s | Empty-name HTML required attribute blocks submission. |
| TC-J2-03 | PASS | 1.2s | maxLength=200 client-side cap on project name. |
| TC-J2-04 | PASS | 1.5s | Cross-org GET → 404 (strict). SU-J2-1 was a false alarm — see §2.1. |
| TC-J2-05 | PASS | 6.0s | New-document modal flow; H-14 atomic doc + layer_stack creation verified. |
| TC-J2-06 | PASS | 1.7s | Empty doc-title HTML required attribute blocks submission. |
| TC-J2-07 | PASS | 0.4s | Malformed document_type → 400 (zod-rejected). SU-J2-2 was a false alarm — see §2.1. |
| **TC-J2-08** | **PASS** | 5.8s | NodeTree opens cleanly via NodeTreePage's networkidle pattern (J2.B). |
| TC-J2-09 | PASS | 1.3s | Non-existent doc URL → 404 (Next.js notFound()). |
| TC-J2-10 | PASS | 0.7s | Cross-org doc URL → 404 (no existence leak via RLS). |
| **TC-J2-11** | **PASS** | 2.8s | Add-child via more-menu / + button creates new child node (J2.B). |
| **TC-J2-12** | **PASS** | 1.9s | Beat (leaf) row has no Add-child button — Act→Chapter→Scene→Beat fixture (J2.B). |
| **TC-J2-13** | **PASS** | 5.3s | More-menu Rename via window.prompt; row + DB updated (J2.B). |
| **TC-J2-14** | **PASS** | 3.0s | Cancelled prompt preserves original name (J2.B). |
| **TC-J2-15** | **PASS** | 2.8s | More-menu Delete + confirm; row + DB removed (J2.B). |
| **TC-J2-16** | **PASS** | 3.8s | Delete Act with Chapter child cascades — both rows + DB rows gone (J2.B). |
| TC-J2-17 | PASS | 0.2s | Cross-org node DELETE via direct API blocked by RLS; row preserved. |
| **TC-J2-18** | **SKIP** | — | Drag-drop UI test deferred (Playwright + react-arborist fragility). |
| **TC-J2-19** | **SKIP** | — | See TC-J2-18. |
| **TC-J2-20** | **SKIP** | — | See TC-J2-18. |
| **TC-J2-21** | **SKIP** | — | See TC-J2-18. |

**Active cases: 17/17 PASS. Skipped: 4 (drag-drop family). Failures: 0.**

---

## 2. Iterations during build

### 2.1 v1.0 — Three iterations (commit history)

Recorded in v1.0 §2:
1. **Selector strategy** — DialogTrigger via `button:has-text("...")` instead of `getByRole`.
2. **API impl-gap discovery** — TC-J2-04/J2-07 returned 500. **Reclassified post-J2.B as Turbopack stale-cache** rather than real impl gaps. With wiped `.next/` both routes return correct status codes (404 / 400). SU-J2-1 + SU-J2-2 are **closed as false alarms**; the operative SU is **SU-J2-4** (process amendment to wipe `.next/` between Phase 5d journey iterations).
3. **Dev-server stability** — Turbopack panic; resolved by `.next/` wipe.

### 2.2 v1.1 — J2.B foundation work

**Symptom (returning to J2 deferred cases).** TC-J2-08 / J2-11 / J2-13 / J2-14 / J2-15 / J2-16 were deferred in v1.0 because NodeTreePage's `waitForTreeRender()` polling was over-engineered.

**Diagnosis.** The original POM polled for `getByRole('tree').count() > 0` via `expect.poll`. This was unnecessary — Playwright's `getByLabel` locator has built-in auto-wait. The Phase 2 prior-art at `tests/ui/tree_*.spec.ts` does:
```ts
await page.goto(`${BASE}/projects/${id}/documents/${docId}`)
await page.waitForLoadState('networkidle')
const row = page.getByLabel('{name}, draft')
await row.hover() // auto-waits up to action timeout
```

That's it. No explicit tree-presence polling needed.

**Classification.** Test-only — POM design was wrong; underlying components are correct.

**Fix.** Simplified `NodeTreePage.goto()` to `page.goto + waitForLoadState('networkidle')`; removed `waitForTreeRender()`; added `getRootRowLabel(adminClient)` helper for tests that need the auto-generated doc name. SU-J2-3 closed.

### 2.3 v1.1 — A11y improvement (SU-J1-2)

**Change.** All four auth pages (signup, login, forgot-password, reset-password) now nest the `<input>` inside `<label>` instead of placing them as siblings. Implicit label/input association — works for screen readers and `getByLabel` resolution. POMs intentionally still use `input[type=...]` selectors (work, no regression risk). SU-J1-2 closed.

### 2.4 v1.1 — Drag-drop deferral (TC-J2-18..21)

These 4 remain skipped — drag-drop in Playwright with react-arborist is genuinely fragile (mouseDown/mouseMove/mouseUp sequencing varies across browsers/versions). The contract is covered API-side at `tests/ui/tree_drag_drop.spec.ts`. Unless the user explicitly requests UI drag-drop coverage, recommend leaving as Phase 5d skip.

---

## 3. SU items state at v1.1

| ID | Description | Status |
|---|---|---|
| **SU-J1-1** | Local Supabase has no login rate-limit; TC-J1-12 skipped | Open — config gap or cloud-smoke-only |
| **SU-J1-2** | Auth forms `<label>`+`<input>` not linked | **CLOSED v1.1** — nested under `<label>` element |
| **SU-J1-3** | Test Plan §3.10 cross-tab logout description error | Open — Test Plan amendment at next revision |
| **SU-J2-1** | API returns 500 instead of 404 for cross-org RLS | **CLOSED v1.1 (false alarm)** — Turbopack stale-cache; resolved by `.next/` wipe |
| **SU-J2-2** | API returns 500 instead of 400/422 for malformed input | **CLOSED v1.1 (false alarm)** — Turbopack stale-cache; resolved by `.next/` wipe |
| **SU-J2-3** | NodeTreePage tree-render readiness signal | **CLOSED v1.1** — simplified to `goto + networkidle` matching Phase 2 pattern |
| **SU-J2-4** | Phase 5d sessions running >1 Journey need `.next/` wipe between runs | Open — process amendment to feedback_phase_session_procedure.md |

Net SU state: 3 closed in v1.1; 3 open (SU-J1-1, SU-J1-3, SU-J2-4).

---

## 4. Isolation hygiene

**Hygiene: clean.**

J2.B exercises `createIsolatedDoc` end-to-end across 9 cases (TC-J2-08 through TC-J2-16, plus TC-J2-17). All projects cleaned up via `afterEach`. No cross-test residue.

---

## 5. Page-object catalog deltas

J2.B updated:

- `NodeTreePage.ts` — Simplified readiness; removed `waitForTreeRender()` (over-engineered); added `getRootRowLabel(adminClient)` helper for retrieving the auto-generated doc name. Goto pattern now matches `tests/ui/tree_*.spec.ts` (the existing convention).

App-side a11y change (SU-J1-2):

- `app/(auth)/signup/page.tsx` — `Field` component nests input inside label
- `app/(auth)/login/LoginForm.tsx` — same
- `app/(auth)/forgot-password/page.tsx` — direct labels nested with their inputs
- `app/(auth)/reset-password/page.tsx` — same

---

## 6. Cloud-smoke status

CS-03 (new project), CS-04 (new document), CS-05 (open document, NodeTree renders) still deferred. Will run at Phase 5d cloud-smoke pass after J3+ ship.

---

## 7. Pre-merge gates at J2.B commit

| Gate | Status |
|---|---|
| `npm run type-check` | exit 0 |
| `npm run lint` | exit 0 (no new warnings) |
| `npm run build` | exit 0 |
| `npm run test:unit` | 28/28 PASS (4 skipped, no Anthropic key) |
| Phase 5d J1 suite (`--project=j1`) | 13/13 active PASS, 1 planned skip (a11y change verified) |
| Phase 5d J2 suite (`--project=j2`) | 17/17 active PASS, 4 drag-drop skips |

---

## 8. Verdict

**J2 PASSES at v1.1.**

CK-J2 met:
- ✓ All TC-J2-* cases authored
- ✓ 17 active TC-J2-* cases PASS (J2-01..17 all green)
- ✓ Page-object catalog with NodeTreePage now reliable
- ⏳ Cloud-smoke CS-03/04/05 deferred to post-merge follow-up
- ✓ 4 drag-drop cases (TC-J2-18..21) explicitly skipped with reason
- ✓ Test Report v1.1 supersedes v1.0

Phase 5d.J2.B + a11y + assertions ships to master as `Phase 5d.J2.B — tree-mutation cases + SU-J1-2 a11y`.

---

## 9. Changelog

**v1.1 — 2026-05-09** J2.B work folded in. 17 active cases PASS (was 10), 4 skipped (drag-drop only). NodeTreePage simplified to `goto + networkidle` matching Phase 2 prior-art convention; SU-J2-3 closed. SU-J1-2 a11y improvement landed (auth forms nest input inside label). SU-J2-1 + SU-J2-2 reclassified as false alarms (Turbopack stale-cache, not real impl gaps); strict assertions restored on TC-J2-04 and TC-J2-07. SU-J2-4 (`.next/` wipe between Phase 5d journey iterations) remains open as process amendment. Net 3 SUs closed, 3 SUs remain open.

**v1.0 — 2026-05-09** Initial Phase 5d.J2 Test Report. 10 active cases PASS, 11 planned skips (tree-mutation cases deferred to J2.B). Three iterations during build. Three POMs touched. createIsolatedDoc helper exercised end-to-end for the first time.
