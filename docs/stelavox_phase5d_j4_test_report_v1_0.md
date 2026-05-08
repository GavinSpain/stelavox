# Stelavox — Phase 5d.J4 Context System Test Report
## Version 1.0

**Journey:** J4 — Context system (create context → link → see propagation).

**Verdict:** PASS. **12/14 active**, 2 deferred (UI-heavy ContextLinker + agent-context propagation).

**Run summary:** 12 passed / 2 skipped / 0 failed. 25.3s wall time on local Supabase.

---

## 1. Per-case results

| TC ID | Status | Notes |
|---|---|---|
| TC-J4-01 | PASS | Create Character via POST /api/projects/[id]/context-nodes; row shape verified. |
| TC-J4-02 | PASS | PATCH metadata persists; expected_version optimistic concurrency. |
| TC-J4-03 | PASS | Invalid scope ('galactic') rejected at zod-validation layer. |
| TC-J4-04 | PASS | Link Character to Beat via POST /api/nodes/[id]/context-links; row in node_context_links. |
| TC-J4-04-cross-org | PASS | (Bonus) User B cannot link to User A's beat — RLS blocks. |
| **TC-J4-05** | **SKIP** | (Pre-planned) ContextLinker search UI needs data-testid. |
| TC-J4-06 | PASS | Cross-project link rejected (Character in project B, Beat in project A). |
| TC-J4-07 | PASS | GET /api/nodes/[id]/back-links returns `{ back_links: [{structural_node, link}] }` shape (one iteration: corrected assertion to use `bl.structural_node.id`). |
| TC-J4-08 | PASS | DELETE context-link removes the row from DB. |
| TC-J4-09 | PASS | Migration 024 conditional NOT NULL CHECK passes for context-category nodes with valid scope. |
| TC-J4-10 | PASS | Missing scope on context-node POST is zod-rejected. |
| TC-J4-11 | PASS | SU-17: Cannot move context-source node into a non-source parent (Act). |
| **TC-J4-12** | **SKIP** | (Pre-planned) Agent-context propagation is end-to-end LLM concern; J5 covers. |
| TC-J4-13 | PASS | SU-16: Non-V1-whitelist node_type ('cybernetic_implant') rejected. |

**Active: 12/12 PASS. Skipped: 2 (planned). Failures: 0.**

---

## 2. Iterations during build

### 2.1 TC-J4-07 assertion shape

**Symptom.** Test asserted `bl.source_node_id` but back-links API returns `{ structural_node: {...}, link: {...} }` shape per `app/api/nodes/[nodeId]/back-links/route.ts`.

**Classification.** Test-only — assertion mismatch. Underlying API is correct.

**Fix.** Changed assertion to `bl.structural_node.id === f.beatId`. PASS on re-run.

---

## 3. SU items raised in J4

None new. All 5 J3 SU items (J3-1..J3-5) plus 3 J1+J2 open SUs (J1-1, J1-3, J2-4) remain.

---

## 4. Isolation hygiene

**Hygiene: clean.** All J4 fixtures (createIsolatedDoc + setupJ3Fixture) cleaned via `afterEach`.

---

## 5. Page-object / helper deltas

J4 added no new POMs — exclusively API-level coverage. Helpers reused: `createIsolatedDoc`, `setupJ3Fixture`, `findUserByEmail`, `getOrganisationIdForUser`.

---

## 6. Pre-merge gates

| Gate | Status |
|---|---|
| `npm run type-check` | exit 0 |
| `npx playwright test --project=j4` | 12/12 active PASS, 2 skipped |

---

## 7. Verdict

**J4 PASSES.** 12 active cases ship. CK-J4 met for active scope; 2 UI-heavy cases (J4-05, J4-12) deferred per plan.

---

## 8. Changelog

**v1.0 — 2026-05-09** Initial Phase 5d.J4 Test Report. 12/12 active PASS, 2 pre-planned skips. One iteration during build (TC-J4-07 assertion shape fix). API-level coverage for context CRUD + linking + RLS + validation. No new POMs needed; reuses J3 fixture helpers.
