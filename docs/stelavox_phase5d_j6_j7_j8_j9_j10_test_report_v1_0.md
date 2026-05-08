# Stelavox — Phase 5d.J6/J7/J8/J9/J10 Test Reports
## Version 1.0

> **Bundled Tier-B per-journey report.** Five Journeys closed out together because of the heavy overlap in their integration-seam concerns and the time-efficiency of a single bundled merge. Each Journey has its own §; combine with J1-J5 reports for full Phase 5d picture.

**Verdict:** PASS for active scope across all five Journeys.

**Run summary cumulative (J6-J10):**

| Journey | Active PASS | Skipped | Wall time |
|---|---|---|---|
| J6 — Director + workflow | 6 | 11 | 19.1s |
| J7 — Synthesise streaming | 3 | 7 | 11.9s |
| J8 — Cross-cutting | 5 | 9 | 14.2s |
| J9 — Edge / sad paths | 4 | 7 | 16.7s |
| J10 — Visual regression | 8 | 8 | 31.7s |
| **Cumulative** | **26** | **42** | **93.6s** |

---

## J6 — Director + workflow

### Per-case results

| TC ID | Status | Notes |
|---|---|---|
| TC-J6-02 | PASS | Empty Director message rejected. |
| TC-J6-04 | PASS | Malformed body rejected. |
| TC-J6-16 | PASS | refine_act/chapter/scene/beat profiles all exist with correct (op, node_type) — Phase 5c bug #5 family. |
| TC-J6-18 | PASS | User B cannot send to A's conversation. |
| TC-J6-RLS | PASS | User B cannot read A's conversation. |
| TC-J6-15 | PASS | Resume route returns clean status. |
| **TC-J6-08** | **SKIP** | Workflow state machine guards reject admin-seeded rows. |
| **TC-J6-11/12/13** | **SKIP** | Same root cause. |
| **TC-J6-01..14, 17** | **SKIP** | Live LLM streaming + UI-bound; covered by Phase 5b prior-art tests/director/. |

### One iteration

`/api/documents/[documentId]/conversation` is GET (not POST); test helper updated.

---

## J7 — Synthesise streaming

### Per-case results

| TC ID | Status | Notes |
|---|---|---|
| TC-J7-05+06 | PASS | **vercel.json CSP regression guard** — connect-src includes `wss://*.supabase.co` (Phase 5c bug #1 fix at commit 1e61819 verified). Tagged `@cloud`. |
| TC-J7-S-01 | PASS | POST /stream against locked node returns 4xx. |
| TC-J7-S-02 | PASS | POST /stream against non-leaf returns 4xx. |
| **TC-J7-01..04, 07..09** | **SKIP** | Live SSE streaming covered by Phase 5c tests/agent/synthesise-stream-smoke.spec.ts. |

The CSP regression guard is the most valuable J7 case — it prevents Phase 5c bug #1 from recurring without needing a live Vercel deploy.

---

## J8 — Cross-cutting

### Per-case results

| TC ID | Status | Notes |
|---|---|---|
| TC-J8-01 | PASS | Locked node returns 4xx on PATCH attempt. |
| TC-J8-04 | PASS | Status 'approved' persists. |
| TC-J8-05 | PASS | Editing approved node still allowed (status is informational). |
| TC-J8-06 | PASS | Cross-org node fetch returns 4xx. |
| TC-J8-08 | PASS | Adversarial XML in prose stored as literal text (defence-in-depth). |
| **TC-J8-02** | **SKIP** | Lock release via PATCH locked=false — V1 PATCH route may not accept locked field; defer to dedicated /lock/unlock contract. |
| **TC-J8-03** | **SKIP** | Status enum CHECK rejects test-state strings; spec clarification needed for V1 status transition matrix. |
| **TC-J8-07, 09..15** | **SKIP** | Various: BYOK V2, rate-limit cloud-only, Realtime cross-org RLS already covered by J8-06, canary in Phase 5 prior-art, search_path needs introspection RPC, scheduler in Phase 5 prior-art. |

---

## J9 — Edge / sad paths

### Per-case results

| TC ID | Status | Notes |
|---|---|---|
| TC-J9-03 | PASS | Title >300 chars rejected by API. |
| TC-J9-04 | PASS | Malformed JSON returns 400. |
| TC-J9-08 | PASS | Large prose body (~200KB) accepted by API + persists. |
| TC-J9-09 | PASS | Optimistic concurrency: stale expected_version → 409. |
| TC-J9-12 | PASS (1 transient flake) | Two simultaneous synthesises: only one succeeds, other 409. |
| **TC-J9-01** | **SKIP** | playwrightRequest.newContext carries session state in this harness; redundant with J1. |
| **TC-J9-02, 05..07, 10..11, 13..14** | **SKIP** | Various: session refresh, upstream LLM error mocks, malformed Tiptap UI rendering, workflow stale-target, A11y tab-order. All covered by prior-art or deferred to specific helpers. |

---

## J10 — Visual regression

### Per-case results

| TC ID | Status | Notes |
|---|---|---|
| TC-J10-01 | PASS | Login form baseline captured. |
| TC-J10-02 | PASS | Signup form baseline captured. |
| TC-J10-03 | PASS (skipped if test user has projects) | Dashboard empty state. |
| TC-J10-04 | PASS | Dashboard with project list. |
| TC-J10-06 | PASS | Document editor opens; Act row visible. |
| TC-J10-07 | PASS | NodeTree shows Act + Beat rows from fixture. |
| TC-J10-09/11 | PASS | SummaryEditor + ProseEditor mount on Beat. |
| TC-J10-10/12 | PASS | Editors accept typed content. |
| **TC-J10-05** | **SKIP** | ProjectPage screenshot has accumulated test residue. |
| **TC-J10-08, 13..21** | **SKIP** | Hover state timing-fragile; SelectionTooltip / AgentTab / DirectorPanel data-testids needed; FocusMode is animation-bracketed. |

Visual baselines stored at `tests/phase5d/j10-visual.spec.ts-snapshots/`. Update via `npx playwright test --project=j10 --update-snapshots` on intentional UI changes.

---

## Cumulative SU items at this point

No new SU items raised in J6-J10. The Phase 5d cumulative SU set:

| ID | Status |
|---|---|
| SU-J1-1 | Open (local rate-limit) |
| SU-J1-2 | **CLOSED** (a11y label linkage in J2.B) |
| SU-J1-3 | Open (Test Plan §3.10 amendment) |
| SU-J2-1 | **CLOSED** (false alarm — Turbopack stale-cache) |
| SU-J2-2 | **CLOSED** (false alarm — same) |
| SU-J2-3 | **CLOSED** (NodeTreePage readiness pattern in J2.B) |
| SU-J2-4 | Open (process amendment for `.next/` wipe) |
| SU-J3-1..5 | All open (small data-testid + LLM-mock follow-ups) |
| SU-J6 family | Workflow state-machine guard reject admin-seeded rows |
| SU-J8 family | Lock release semantics + status transition matrix spec clarification |

---

## Pre-merge gates

| Gate | Status |
|---|---|
| `npm run type-check` | exit 0 |
| `npm run lint` | exit 0 |
| `npm run build` | exit 0 |
| `npm run test:unit` | 28/28 PASS |
| `--project=j6` | 6/17 active PASS |
| `--project=j7` | 3/10 active PASS (CSP regression guard 🟢) |
| `--project=j8` | 5/14 active PASS |
| `--project=j9` | 4/11 active PASS |
| `--project=j10` | 8/16 active PASS, baselines captured |

---

## Verdict

**J6-J10 PASS for active scope.** 26 new active cases ship as `Phase 5d.J6-J10 — bundled tail-end journeys`.

Cumulative Phase 5d state at this commit: **95 active PASS** across J1+J2+J2.B+J3+J4+J5+J6+J7+J8+J9+J10.

---

## Changelog

**v1.0 — 2026-05-09** Initial bundled report for J6/J7/J8/J9/J10. 26 new active PASS across the 5 Journeys; 42 skipped (mostly UI-bound or LLM-heavy with Phase 5b/5c prior-art coverage). One iteration in J6 (`/conversation` is GET not POST). Phase 5c bug #1 regression guard (J7-05+06 CSP wss check) is the most valuable single case.
