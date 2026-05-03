# Stelavox — Phase 2 Pre-Phase Test Plan
## Version 1.0

> **Tier-B per-phase document.** Written before any implementation. Derived from `stelavox_phase2_api_contract_v1_0.md` and the Phase 2 checkpoint criterion in `stelavox_technical_architecture_v1_4.md` §11. Executed at the end of Phase 2; results recorded in `stelavox_phase2_test_report_v1_0.md` (created during Group 12 of the Build Checklist).

**Phase:** 2 — Node Tree: structural CRUD, react-arborist, status badges, reordering.
**Phase 2 checkpoint criteria (Technical Architecture v1.4 §11):** "Can build a manual node tree; drag-and-drop works."
**Companion documents:** `stelavox_phase2_api_contract_v1_0.md`, `stelavox_phase2_build_checklist_v1_0.md`.

---

## 1. Test Environment

### 1.1 Where tests run

Phase 2 builds on the Phase 1 environment. Local Supabase stack started via `supabase start`; all 23 migrations applied (001–019 carried over from Phase 1, 020/021/023 added in Phase 2 — number 022 is intentionally skipped per API Contract §1.4); seed loaded; Next.js dev server on `http://localhost:3000`. The Phase 2 worktree shifts ports +10 the same way Phase 1's `sweet-rhodes-b546ed` did.

A second smoke run is performed against cloud `stelavox-dev` (Phase B) before merge — same migrations, same seed, the same subset used for Phase 1 plus the new core tree flows (TC-U-02, TC-U-05, TC-U-06).

### 1.2 Test users

Three test users created via `supabase.auth.signUp` at the start of the run, identical to Phase 1:

| Handle | Email | Password | Display name |
|---|---|---|---|
| **User A** | `test-a@example.com` | `Test1234!Test1234!` | `Author A` |
| **User B** | `test-b@example.com` | `Test1234!Test1234!` | `Author B` |
| **User C** | `test-c@example.com` | `Test1234!Test1234!` | `Author C` |

Test users are deleted between full runs by truncating `auth.users` (cascades). `supabase db reset` is acceptable in Phase A.

### 1.3 Test data

Pre-loaded by the seed (unchanged from Phase 1):
- Three layer-stack templates (Novel, Short Story, Series).
- All keys in `platform_config`.
- One `director_configs` row with `status = 'production'`.

Phase 2 does not add seed rows. Every node, project, and document used in tests is created during the run.

### 1.4 Tooling

Same as Phase 1: Vitest / Playwright API-mode for API tests, Playwright headed for UI checkpoints, service-role client only in test setup/teardown. New for Phase 2:

- **react-arborist drag-and-drop**: Playwright's drag emulation via `page.dragAndDrop()` against the `[role="treeitem"]` selectors. Where Playwright drag is flaky we fall back to dispatching `dragstart`/`dragover`/`drop` events directly.
- **Tree-shape assertions**: helper `expectTreeShape(documentId, expectedShape)` reads via service role and verifies `(parent_id, order, depth, layer_index)` for every node matches an expected nested-array description. This helper lives in `tests/helpers/tree.ts`.

### 1.5 Mocking

No external services mocked. Email is delivered via Inbucket as in Phase 1.

### 1.6 Independence

Test cases are independent. Where a test requires a tree precondition ("User A has a document with a root book and three chapters"), the test's setup creates that state via the API (or via service-role for performance) and tears it down in `afterEach`. No test reads state another test modifies.

### 1.7 Notation

- **TC-A-NN** — API integration test (Section 3).
- **TC-B-NN** — Authorisation boundary test (Section 4).
- **TC-D-NN** — Data integrity test (Section 5).
- **TC-U-NN** — UI checkpoint test (Section 2).
- **Verdict:** `PASS` if actual matches expected exactly. `FAIL` otherwise; the Test Report classifies the cause.

---

## 2. Section 1 — UI Checkpoint Tests

These verify the Phase 2 checkpoint from a user's perspective: "Can build a manual node tree; drag-and-drop works."

### TC-U-01 — Document open shows the root node
**Spec:** Component Spec §4.1 (NodeTree); API Contract §3.7.
**Setup:** User A signed in; create a Novel document `My Novel`.
**Procedure:** Open the document.
**Expected:** Tree renders. Single root row visible: type `book`, name `My Novel`, status pill `draft`, no chevron (leaf), no children. `aria-level="1"`.

### TC-U-02 — Create a child via the row's add action
**Spec:** Component Spec §4.2 (NodeRow hover actions); API Contract §3.1.
**Setup:** Document open with root only.
**Procedure:** Hover the root row → click the `+` (Add child) icon → enter name `Act 1` in the prompt → confirm.
**Expected:** New row appears indented under root: type `act`, name `Act 1`, status `draft`. Root now has chevron in expanded state. `aria-level="2"` on the new row.

### TC-U-03 — Create a deeper descendant
**Spec:** Component Spec §4.2; API Contract §3.1.
**Setup:** Tree has Book → Act 1 (from TC-U-02).
**Procedure:** Add child to Act 1 named `Chapter 1`. Add child to Chapter 1 named `Scene 1`. Add child to Scene 1 named `Beat 1`.
**Expected:** Four-level descent: Book / Act / Chapter / Scene / Beat. Each row indented 16px deeper than its parent. Beat is leaf (chevron hidden, opacity 0, alignment preserved). Beat is at the deepest layer; its `+` action is disabled (or absent) per `max_depth_exceeded` invariant.

### TC-U-04 — Rename a node via the detail panel
**Spec:** Component Spec §5.1 (NodeDetailPanel); API Contract §3.4.
**Setup:** Tree has at least two nodes.
**Procedure:** Click a chapter row to open the detail panel → click the name heading → it becomes editable → change to `Chapter — Revised` → press Enter (or blur).
**Expected:** Tree row updates immediately to the new name. DB row's `name` matches; `updated_at` advanced; `version` did **not** change (rename is not a content field).

### TC-U-05 — Drag-and-drop reorder within parent
**Spec:** Component Spec §4.1 (drag-and-drop); API Contract §3.6 (move).
**Setup:** Tree has Book → Act 1, Act 2, Act 3 (in that order).
**Procedure:** Drag `Act 3`'s row above `Act 1`. Drop.
**Expected:** Visual order is now Act 3, Act 1, Act 2. Reload the page; order persists. DB rows for the three siblings have `order = 1, 2, 3` matching the new visual order (dense, gap-free). All three rows' `updated_at` advanced; only the moved row's `version` is unchanged (no content change).

### TC-U-06 — Drag-and-drop move to a new parent
**Spec:** Component Spec §4.1; API Contract §3.6.
**Setup:** Tree has Book → Act 1 (with Chapter 1, Chapter 2) and Act 2 (with Chapter 3).
**Procedure:** Drag `Chapter 1` onto `Act 2`. Drop.
**Expected:** Tree shows Book → Act 1 (Chapter 2) and Act 2 (Chapter 3, Chapter 1) — Chapter 1 appended to Act 2. DB: Chapter 1's `parent_id` = Act 2; both old siblings (Chapter 2 only) and new siblings (Chapter 3, Chapter 1) renumber to dense `order = 1, 2`. Chapter 1's `depth` is unchanged (Act 1 and Act 2 are at the same depth) — but if it had children they'd retain `depth = parent.depth + 1` recursively.

### TC-U-07 — UI rejects a layer-violating drop
**Spec:** Component Spec §4.1; API Contract §2.11.4 (layer hierarchy).
**Setup:** Tree has Book → Act 1 (Chapter 1, with Scene 1 inside).
**Procedure:** Drag `Scene 1` onto `Book` (root).
**Expected:** Either:
(a) The drop is rejected client-side with no API call (drag indicator shows a "not allowed" cursor on hover), OR
(b) The API call is made, returns `422 layer_violation`, and the UI rolls back the optimistic move and surfaces a toast: "Scenes belong inside chapters, not books."
The DB tree is unchanged after the operation. Either implementation passes; the optimistic-rollback path is the more robust and is preferred.

### TC-U-08 — Delete node confirmation includes descendant count
**Spec:** Component Spec §4.2; API Contract §3.5.
**Setup:** Tree has a chapter with three scenes, each scene with two beats. (1 chapter + 3 scenes + 6 beats = 10 nodes; the chapter has 9 descendants.)
**Procedure:** From the chapter's More menu, click `Delete`.
**Expected:** Confirmation dialog shows a count: "Delete this chapter and 9 descendants? This cannot be undone." Cancel preserves the subtree. Confirm removes all 10 nodes from the tree and the response body's `descendants_deleted` is `9`.

### TC-U-09 — Cannot delete the root
**Spec:** API Contract §3.5 (`cannot_delete_root`).
**Setup:** Document open with at least the root.
**Procedure:** Open the root row's More menu.
**Expected:** The `Delete` item is absent or disabled (with a tooltip: "The root cannot be deleted"). If somehow invoked via API the response is `422 cannot_delete_root`.

### TC-U-10 — Status change updates the badge colour
**Spec:** Component Spec §4.3 (NodeStatusBadge); Inviolable #2 verdigris uses #4 and #5.
**Setup:** Tree has at least one chapter with status `draft`.
**Procedure:** Open chapter detail panel → status dropdown → choose `Approved`.
**Expected:** Tree row's status badge changes colour to verdigris (`--color-status-approved` = `#3d7858` dark / `#254a38` light). Status pill change is instant (0ms — no animation, per Component Spec §4.3). DB `status = 'approved'`. No verdigris appears on rows where status ≠ `approved`/`agent-complete` (Inviolable #2 audit).

### TC-U-11 — Locked node displays the lock icon
**Spec:** Component Spec §4.2 (Locked node section); API Contract §2.11.7.
**Setup:** Tree has a chapter; via PATCH (admin/test path), set `locked = TRUE` on the chapter.
**Procedure:** Reload the document.
**Expected:** Chapter row shows the lock icon (Lucide Lock) replacing the type icon. The chapter's hover actions are disabled (no `+` Add child, no More menu). The drag handle is hidden — drag attempts produce no movement. Click-to-open the detail panel still works (read is permitted).

### TC-U-12 — Sibling renumber is visible after delete
**Spec:** API Contract §2.11.5 (dense order); H-04.
**Setup:** Tree has Act 1 with Chapter 1, Chapter 2, Chapter 3, Chapter 4 (in that order).
**Procedure:** Delete Chapter 2.
**Expected:** Tree updates to show Chapter 1, Chapter 3, Chapter 4. DB: the three remaining siblings have `order = 1, 2, 3` (gap-free). User-visible names are unchanged — Stelavox does not auto-renumber the **names** of chapters, only the `order` column. (If a future feature renumbers names, that's a separate operation.)

---

## 3. Section 2 — API Integration Tests

For every endpoint in the API Contract, every documented case. Each test uses HTTP `fetch` against `http://localhost:3000/api/...` with the relevant test user's auth cookie. Setup/teardown uses the service-role client.

### Convention

- "Authenticated" = `auth.setUserA()` helper attaches User A's cookie. "No session" omits the cookie.
- Bodies in tests are JSON unless noted.
- Where a test specifies "DB unchanged," that is verified via service-role read of the relevant row(s) before and after, byte-equal except where explicitly stated.

### 3.1 `POST /api/documents/[documentId]/nodes` — Create node

#### TC-A-01 — Happy path: chapter under act
- Setup: User A document D with template Novel; the modified Migration 020 RPC has populated root + (test setup) one act under root.
- Body: `{ "parent_id": "<actId>", "node_type": "chapter", "name": "Chapter 1" }`
- Expected: `201`. Response `{ node }`. Node has `parent_id = actId`, `node_type = "chapter"`, `node_category = "structural"`, `layer_index = 2`, `depth = 2`, `order = 1`, `status = "draft"`, `version = 1`.

#### TC-A-02 — Happy path with all optional fields
- Body: `{ "parent_id": "<chapterId>", "node_type": "scene", "name": "Scene 1", "short_description": "Opening", "agent_instruction": "Introduce protagonist.", "word_count_target": 1500 }`
- Expected: `201`. All fields persisted. `layer_index = 3`, `depth = 3`.

#### TC-A-03 — Order auto-assigned (append)
- Setup: parent already has two children with `order = 1, 2`.
- Body: `{ "parent_id": "<parent>", "node_type": "<correct type>", "name": "Third" }`
- Expected: `201`. New node has `order = 3`. Existing siblings unchanged.

#### TC-A-04 — `node_category` defaults to `structural`
- Body omits `node_category`.
- Expected: `201`. Returned node has `node_category = "structural"`.

#### TC-A-05 — `node_category = "context"` → 400
- Body: `{ "parent_id": ..., "node_type": "chapter", "node_category": "context", "name": "X" }`
- Expected: `400 invalid_category`.

#### TC-A-06 — Invalid `documentId` UUID → 400
- Path: `/api/documents/not-a-uuid/nodes`.
- Expected: `400 invalid_uuid`.

#### TC-A-07 — Empty body → 400
- Body: `{}`.
- Expected: `400 missing_parent_id` (or `missing_body`).

#### TC-A-08 — Unknown field → 400
- Body: `{ "parent_id": "...", "node_type": "chapter", "depth": 5 }`.
- Expected: `400 unknown_field`, message `Unknown field: depth`.

#### TC-A-09 — Missing `parent_id` → 400
- Body: `{ "node_type": "chapter", "name": "X" }`.
- Expected: `400 missing_parent_id`.

#### TC-A-10 — Missing `node_type` → 400
- Body: `{ "parent_id": "...", "name": "X" }`.
- Expected: `400 invalid_node_type`.

#### TC-A-11 — Empty `node_type` → 400
- Body: `{ "parent_id": "...", "node_type": "", "name": "X" }`.
- Expected: `400 invalid_node_type`.

#### TC-A-12 — Name >200 chars → 400
- Body name 201 chars.
- Expected: `400 invalid_name`.

#### TC-A-13 — `short_description` >1000 chars → 400
- Expected: `400 invalid_short_description`.

#### TC-A-14 — `word_count_target` negative → 400
- Body: `{ ..., "word_count_target": -1 }`.
- Expected: `400 invalid_word_count_target`.

#### TC-A-15 — Document not found → 404
- Path uses a UUID for which no document row exists.
- Expected: `404 not_found`, message `document_not_found`.

#### TC-A-16 — Parent in a different document → 422
- Setup: User A has documents D1 and D2; D1 has chapter C1; D2 has the root.
- POST against D2 with `parent_id = C1.id`.
- Expected: `422 invalid_parent`.

#### TC-A-17 — Parent does not exist → 422
- POST with `parent_id` set to a freshly-generated UUID.
- Expected: `422 invalid_parent`.

#### TC-A-18 — `node_type` mismatches parent's child layer → 422
- Setup: novel template; `parent_id` = root (book, layer 0).
- Body: `{ "parent_id": "<root>", "node_type": "scene", "name": "X" }` (scene is layer 3, but root admits only layer 1 = act).
- Expected: `422 layer_violation`.

#### TC-A-19 — Parent at deepest layer → 422
- Setup: novel template; create a beat (layer 4) `B1`.
- POST with `parent_id = B1.id, node_type = "beat"`.
- Expected: `422 max_depth_exceeded`.

#### TC-A-20 — Parent locked → 423
- Setup: chapter C with `locked = TRUE`.
- POST with `parent_id = C.id, node_type = "scene"`.
- Expected: `423 parent_locked`.

#### TC-A-21 — Ancestor locked → 423
- Setup: act A with `locked = TRUE`; chapter C is an unlocked child of A.
- POST with `parent_id = C.id`.
- Expected: `423 parent_locked`.

#### TC-A-22 — No session → 401
- No cookie.
- Expected: `401 unauthorised`.

#### TC-A-23 — `Content-Type` not JSON → 400
- `Content-Type: text/plain` with valid JSON body.
- Expected: `400 invalid_json`.

### 3.2 `GET /api/documents/[documentId]/nodes` — List nodes

#### TC-A-24 — Happy path: small tree
- Setup: User A document with a manually-built three-level tree (10 nodes total).
- Expected: `200`. Body `{ nodes: [...] }` length 10. Depth-first ordering: root first, then root's children in `order`, then each subtree.

#### TC-A-25 — Happy path: just root
- Setup: fresh document (root only).
- Expected: `200`. `nodes.length === 1`. The single node has `parent_id === null`.

#### TC-A-26 — Happy path: order is depth-first
- Setup: tree where root has two children `A` (order 1) and `B` (order 2); `A` has two grandchildren.
- Expected: response order is `[root, A, A.child1, A.child2, B]`.

#### TC-A-27 — `?category=structural` (explicit) returns same result as default
- Expected: `200`. Body identical to TC-A-24 with the same tree.

#### TC-A-28 — `?category=context` returns no rows in Phase 2
- Setup: tree has only structural nodes (Phase 2 invariant).
- Expected: `200`. `nodes.length === 0`. (Phase 4 will populate.)

#### TC-A-29 — `?category=all` returns all rows (structural only in Phase 2)
- Expected: `200`. Identical to TC-A-24's structural-only result.

#### TC-A-30 — Unknown query param → 400
- `?include_locked=true`.
- Expected: `400 unknown_param`.

#### TC-A-31 — Invalid `documentId` UUID → 400
- Expected: `400 invalid_uuid`.

#### TC-A-32 — Document not found → 404
- Expected: `404 not_found`.

#### TC-A-33 — No session → 401

### 3.3 `GET /api/nodes/[nodeId]` — Read node

#### TC-A-34 — Happy path
- Expected: `200`. Body `{ node }`. All fields per §2.12.

#### TC-A-35 — Invalid UUID → 400

#### TC-A-36 — Node not found → 404

#### TC-A-37 — No session → 401

### 3.4 `PATCH /api/nodes/[nodeId]` — Update node

#### TC-A-38 — Rename
- Body: `{ "name": "Renamed" }`.
- Expected: `200`. `node.name === "Renamed"`. `updated_at` advanced. `version` unchanged (rename is not a content field).

#### TC-A-39 — Status transition draft → in_review
- Body: `{ "status": "in_review" }`.
- Expected: `200`. Persisted; version unchanged.

#### TC-A-40 — Status transition draft → approved
- Body: `{ "status": "approved" }`.
- Expected: `200`.

#### TC-A-41 — Status transition draft → locked
- Body: `{ "status": "locked" }`.
- Expected: `200`. Note that this sets `status = "locked"` but does **not** set the `locked` boolean column — that's a separate field. (The `locked` boolean is for ancestor-lock-propagation; `status = "locked"` is the user-visible "this layer is locked" state. Phase 6 unifies the semantics.)

#### TC-A-42 — Set `agent_instruction`
- Expected: `200`. Field persisted. Version unchanged.

#### TC-A-43 — Set `word_count_target`
- Expected: `200`.

#### TC-A-44 — Set `summary` (content field) bumps version
- Body: `{ "summary": "Long summary text..." }`.
- Expected: `200`. Persisted. `version` advanced from `1` to `2`.

#### TC-A-45 — Set `prose` bumps version
- Expected: `version` advances.

#### TC-A-46 — Mixed update: rename + summary in one PATCH bumps version once
- Body: `{ "name": "X", "summary": "Y" }`.
- Expected: `200`. Both persisted. `version` advances by exactly `1`.

#### TC-A-47 — Rename-only does NOT bump version
- Two consecutive PATCHes that rename only: `{ "name": "A" }`, `{ "name": "B" }`.
- Expected: After both, `version` is unchanged from initial.

#### TC-A-48 — Forbidden field `parent_id` → 400
- Body: `{ "parent_id": "..." }`.
- Expected: `400 unknown_field` (parent_id is forbidden on PATCH; use `/move`).

#### TC-A-49 — Forbidden field `node_type` → 400

#### TC-A-50 — Forbidden field `order` → 400

#### TC-A-51 — Forbidden field `depth` → 400

#### TC-A-52 — Forbidden field `id` → 400

#### TC-A-53 — Forbidden field `organisation_id` → 400

#### TC-A-54 — Forbidden field `node_category` → 400

#### TC-A-55 — Forbidden field `mobile_notes` → 400

#### TC-A-56 — Invalid status → 400
- Body: `{ "status": "completed" }`.
- Expected: `400 invalid_status`.

#### TC-A-57 — Empty body → 400
- Expected: `400 empty_update`.

#### TC-A-58 — `prose` >1,000,000 chars → 400
- Expected: `400 invalid_prose`.

#### TC-A-59 — Locked node → 423
- Setup: target has `locked = TRUE`.
- Expected: `423 node_locked`. DB row unchanged.

#### TC-A-60 — Ancestor locked → 423
- Setup: parent has `locked = TRUE`; target is unlocked.
- Expected: `423 parent_locked`. DB row unchanged.

#### TC-A-61 — Invalid UUID → 400

#### TC-A-62 — Not found → 404

#### TC-A-63 — No session → 401

### 3.5 `DELETE /api/nodes/[nodeId]` — Delete node

#### TC-A-64 — Happy path: leaf node
- Setup: scene S with no children.
- Expected: `200`. Body `{ deleted: true, node_id: "<S.id>", descendants_deleted: 0 }`. After: row absent.

#### TC-A-65 — Happy path: cascade with descendants
- Setup: chapter C with 3 scenes, each with 2 beats (9 descendants).
- Expected: `200`. `descendants_deleted: 9`. After: 10 rows absent (C and 9 descendants).

#### TC-A-66 — Sibling renumber after delete
- Setup: parent has children with `order = 1, 2, 3, 4`. Delete the one with `order = 2`.
- Expected: `200`. After: remaining three siblings have `order = 1, 2, 3` (former 3 → 2, former 4 → 3). Single transaction.

#### TC-A-67 — Cannot delete root → 422
- Setup: document D with root `R` and one chapter.
- Path: `/api/nodes/<R.id>`.
- Expected: `422 cannot_delete_root`. After: tree unchanged.

#### TC-A-68 — Body must be empty → 400
- Body: `{ "force": true }`.
- Expected: `400 unexpected_body`.

#### TC-A-69 — Locked node → 423
- Expected: `423 node_locked`. After: row present.

#### TC-A-70 — Ancestor locked → 423
- Expected: `423 parent_locked`. After: row present.

#### TC-A-71 — Invalid UUID → 400

#### TC-A-72 — Not found → 404

#### TC-A-73 — Second DELETE → 404
- After a successful TC-A-64, repeat the same DELETE.
- Expected: `404 not_found`.

#### TC-A-74 — No session → 401

### 3.6 `PATCH /api/nodes/[nodeId]/move` — Move node

#### TC-A-75 — Within-parent move (reorder)
- Setup: parent with children at `order = 1, 2, 3, 4` (call them W, X, Y, Z).
- Body: `{ "parent_id": "<parent>", "position": 0 }` for `Y` (currently order 3).
- Expected: `200`. After: Y has `order = 1`; W, X moved to `order = 2, 3`; Z unchanged at `order = 4`. `renumbered_count: 3`.

#### TC-A-76 — Cross-parent move
- Setup: Act 1 has chapters {C1, C2}; Act 2 has chapter {C3}.
- Body for C2: `{ "parent_id": "<Act 2>", "position": 1 }` (between any siblings, here insert at end since Act 2 has 1).
- Expected: `200`. After: C2 has `parent_id = Act 2`, `order = 2`; C1 alone in Act 1 at `order = 1`; Act 2 has [C3, C2] in `order = 1, 2`.

#### TC-A-77 — Move to first position (position 0)
- Body: `{ "parent_id": ..., "position": 0 }`.
- Expected: target row has `order = 1`; all other siblings shift `order += 1`.

#### TC-A-78 — Move to last position
- Setup: target parent has 3 children; move into position 3.
- Expected: target appended; other 3 unchanged.

#### TC-A-79 — No-op move (current position)
- Setup: node X has `order = 2` under parent P.
- Body: `{ "parent_id": "<P>", "position": 1 }` (0-indexed → order 2).
- Expected: `200`. Tree unchanged. `renumbered_count: 0` is acceptable; `1` (counting the moved node) is also acceptable. The choice is documented in the API Contract `/move` description.

#### TC-A-80 — Self-cycle → 422
- Body: `{ "parent_id": "<X.id>", "position": 0 }` for node X.
- Expected: `422 cycle_detected`. DB unchanged.

#### TC-A-81 — Descendant cycle → 422
- Setup: Act → Chapter → Scene.
- Body for Act: `{ "parent_id": "<Scene.id>", "position": 0 }`.
- Expected: `422 cycle_detected`. DB unchanged.

#### TC-A-82 — Layer violation → 422
- Body: move scene to be a child of root (root admits only layer 1 = act, scene is layer 3).
- Expected: `422 layer_violation`. DB unchanged.

#### TC-A-83 — Cross-parent depth recalculation
- Setup: deep subtree under Act 1 — Act 1 → Chapter 1 (with Scene + Beat).
- Procedure: move Chapter 1 to be a child of Act 2 (same depth-level as before).
- Expected: `200`. After: Chapter 1's new `parent_id = Act 2`. `depth` of Chapter 1 unchanged (Act 2 same depth as Act 1). Crucially Scene and Beat under Chapter 1 also have correct `depth` (3 and 4 respectively). No depth drift.

#### TC-A-84 — Position too high → 400
- Setup: target parent has 3 children.
- Body: `{ "parent_id": ..., "position": 5 }`.
- Expected: `400 invalid_position`.

#### TC-A-85 — Position negative → 400
- Body: `{ "parent_id": ..., "position": -1 }`.
- Expected: `400 invalid_position`.

#### TC-A-86 — Parent in different document → 422
- Setup: User A has D1 (chapter C1) and D2 (root R2).
- Body for C1: `{ "parent_id": "<R2>", "position": 0 }`.
- Expected: `422 invalid_parent`. DB unchanged.

#### TC-A-87 — Missing `parent_id` → 400

#### TC-A-88 — Missing `position` → 400

#### TC-A-89 — Locked node → 423
- Setup: target has `locked = TRUE`.
- Expected: `423 node_locked`. DB unchanged.

#### TC-A-90 — Ancestor locked (old parent locked) → 423
- Setup: target's existing ancestor has `locked = TRUE`.
- Expected: `423 parent_locked`. DB unchanged.

#### TC-A-91 — New parent's ancestor locked → 423
- Setup: target unlocked; target's old parent unlocked; new parent's ancestor has `locked = TRUE`.
- Expected: `423 parent_locked`. DB unchanged.

#### TC-A-92 — Invalid UUID → 400

#### TC-A-93 — Not found → 404

#### TC-A-94 — No session → 401

### 3.7 `POST /api/projects/[projectId]/documents` — Create document (modified)

#### TC-A-95 — Response shape includes `root_node`
- Body: `{ "name": "Doc", "document_type": "novel" }`.
- Expected: `201`. Body has three top-level keys: `document`, `layer_stack`, `root_node`. Phase 1 callers that read `document` and `layer_stack` continue to work.

#### TC-A-96 — Root node properties
- Continuation of TC-A-95.
- Expected: `root_node.parent_id === null`, `node_category === "structural"`, `node_type === "book"` (Novel template's layer 0), `name === "Doc"` (matches document name), `order === 1`, `depth === 0`, `layer_index === 0`, `status === "draft"`.

#### TC-A-97 — `root_node_id` back-fill on documents row
- After TC-A-95.
- Expected: `documents.root_node_id` equals `root_node.id` (verified via service-role read).

#### TC-A-98 — Short story root is `story` type
- Body: `{ "name": "Doc2", "document_type": "short_story" }`.
- Expected: `root_node.node_type === "story"`.

#### TC-A-99 — Series root is `series` type
- Body: `{ "name": "Doc3", "document_type": "series" }`.
- Expected: `root_node.node_type === "series"`.

#### TC-A-100 — Atomicity: simulated failure leaves no document, no layer_stack, no root_node
- Setup: cause a forced failure mid-RPC (e.g. by deleting the system template just before the call so the function raises `missing_template`).
- Expected: `500 missing_template`. After: `documents` count unchanged, `layer_stacks` count unchanged, `nodes` count unchanged. (The combined three-table transaction rolls back as a unit.)

---

## 4. Section 3 — Authorisation Boundary Tests

Cross-user, cross-organisation tests. Every Phase 2 endpoint × every "User B attempting to access User A's resource" case. **Expected outcome is `404` (not `403`)** for any resource that exists but is invisible.

#### TC-B-01 — `GET /api/documents/[A's doc]/nodes` cross-user → 404
- Auth: User B. Path uses User A's `documentId`.
- Expected: `404 not_found`. Body must NOT contain User A's node names.

#### TC-B-02 — `POST /api/documents/[A's doc]/nodes` cross-user → 404
- Auth: User B. Path: User A's doc. Body: a valid create payload.
- Expected: `404 not_found`. After: no new rows in `nodes`.

#### TC-B-03 — `GET /api/nodes/[A's node]` cross-user → 404
- Auth: User B.
- Expected: `404 not_found`.

#### TC-B-04 — `PATCH /api/nodes/[A's node]` cross-user → 404, no DB change
- Auth: User B. Body: `{ "name": "Hijacked" }`.
- Expected: `404 not_found`. After: row's `name` and `updated_at` unchanged.

#### TC-B-05 — `DELETE /api/nodes/[A's node]` cross-user → 404, no DB change
- Auth: User B.
- Expected: `404 not_found`. After: node still exists.

#### TC-B-06 — `PATCH /api/nodes/[A's node]/move` cross-user → 404, no DB change
- Auth: User B. Body: a valid move within User A's doc.
- Expected: `404 not_found`. After: tree unchanged.

#### TC-B-07 — User B's node moved into User A's parent → 404
- Setup: User A has document D-A with root R-A; User B has document D-B with root R-B and a chapter C-B.
- Auth: User B. Body for C-B: `{ "parent_id": "<R-A>", "position": 0 }`.
- Expected: `404 not_found` (R-A is not visible to User B; the API surfaces 404 rather than leaking that it exists). After: C-B's `parent_id` unchanged.

#### TC-B-08 — Direct DB read from User B's anon client cannot see User A's nodes
- Setup: User A has tree.
- Procedure: `await supabaseB.from('nodes').select('*')`.
- Expected: returns only User B's nodes (or empty if User B has none).

#### TC-B-09 — Direct DB write to nodes (anon) is rejected
- Procedure: User B's anon client `await supabaseB.from('nodes').insert({ project_id: <User A's project>, ... })`.
- Expected: RLS rejection. After: `nodes` has no row matching the hijack.

#### TC-B-10 — Direct call to `move_node` RPC by User B for User A's node
- Procedure: User B's authenticated client calls `await supabaseB.rpc('move_node', { p_node_id: <User A's node>, ... })`.
- Expected: function raises `forbidden: caller is not a member of organisation` per the membership check (mirrors Phase 1's `create_document_with_layer_stack` pattern).

#### TC-B-11 — Logged-out user → 401 on every Phase 2 endpoint
- For each of the 6 new endpoints: issue with no cookie.
- Expected: every response `401 unauthorised`.

#### TC-B-12 — `auth.users` indirect leak via nodes endpoint
- Setup: any User A node.
- Procedure: User B reads node via direct DB or API (404 expected). The body must not contain `created_by` user-id leakage that could be enumerated.
- Expected: 404 body has no information about the row.

---

## 5. Section 4 — Data Integrity Tests

After every modifying operation, verify nothing else changed.

#### TC-D-01 — Sibling order is dense after insert
- Setup: parent has 3 children at `order = 1, 2, 3`.
- Procedure: POST a new child.
- Expected: 4 children at `order = 1, 2, 3, 4`. No gaps, no overlap.

#### TC-D-02 — Sibling order is dense after delete
- Setup: parent has 5 children at `order = 1..5`.
- Procedure: DELETE the middle one.
- Expected: 4 children at `order = 1..4`. Names preserved (delete reorders `order`, not `name`).

#### TC-D-03 — Sibling order is dense after within-parent move
- Setup: parent with 4 children at `order = 1..4`.
- Procedure: PATCH `/move` the third child to position 0.
- Expected: 4 children with `order = 1..4`, dense. The previously-third row is now at `order = 1`; the others shifted one slot.

#### TC-D-04 — Sibling order is dense after cross-parent move (both old + new)
- Setup: Old parent has [A, B, C]; new parent has [D, E].
- Procedure: move B to new parent at position 1.
- Expected: old parent has [A, C] with `order = 1, 2`; new parent has [D, B, E] with `order = 1, 2, 3`. Both dense.

#### TC-D-05 — Depth recalculation across descendants
- Setup: Act 1 → Chapter 1 → Scene 1 → Beat 1 (depths 1, 2, 3, 4 respectively under root depth 0).
- Procedure: PATCH `/move` Chapter 1 to be a child of a *different* Act (Act 2) — same parent depth, so the moved subtree's depths should be unchanged.
- Expected: Chapter 1 depth = 2; Scene 1 depth = 3; Beat 1 depth = 4. (No drift even though the move did happen.)

#### TC-D-06 — Cascade delete count matches `descendants_deleted`
- Setup: subtree with 17 descendants below the target (verified via service-role count before).
- Procedure: DELETE target.
- Expected: response `descendants_deleted: 17`. After: service-role count of `nodes` for the document is `(before_count - 18)` (target + 17 descendants).

#### TC-D-07 — Cycle detection rejects without write
- Setup: Act → Chapter → Scene; capture full tree state.
- Procedure: attempt `/move` Act under Scene.
- Expected: `422 cycle_detected`. After: tree state is byte-identical to the captured snapshot. No row's `updated_at` advanced.

#### TC-D-08 — Root uniqueness invariant
- Setup: any document with a tree.
- Procedure: service-role query: `SELECT count(*) FROM nodes WHERE document_id = <D> AND parent_id IS NULL`.
- Expected: count is exactly `1` always — before, during, and after every Phase 2 operation. Run this assertion as part of TC-A-01..TC-A-100's teardown.

#### TC-D-09 — Document creation populates `root_node_id`
- Procedure: POST `/api/projects/[id]/documents`.
- Expected: in the same transaction, `documents.root_node_id` is set to the created root's `id`. (Verified by reading `documents` after the call.) No window where `root_node_id IS NULL`.

#### TC-D-10 — Failed create leaves no orphans
- Setup: cause a `layer_violation` failure (e.g. POST scene under root in a Novel template).
- Expected: `422 layer_violation`. After: row count of `nodes` for the document is unchanged. No partial row visible via service-role count.

#### TC-D-11 — Locked-node PATCH does not bump `updated_at`
- Setup: target node `locked = TRUE`; capture `updated_at` before.
- Procedure: PATCH the target as User A.
- Expected: `423`. After: `updated_at` byte-equal to snapshot.

#### TC-D-12 — Concurrent reorders by the same user produce a deterministic dense ordering
- Setup: parent with 5 children at `order = 1..5`.
- Procedure: issue two concurrent `/move` calls (`Promise.all([move_X_to_0, move_Y_to_1])`).
- Expected: both responses `200`. After: the 5 siblings have `order = 1..5` (dense, no gaps, no overlap). The exact final position of X and Y depends on transaction interleaving but must be consistent (the row-level locks in `move_node` serialise the renumbers).

---

## 6. Verdict Criteria

Phase 2 PASSES if and only if **every** test case above resolves to PASS, AND the Phase 2 checkpoint criterion holds:

> "Can build a manual node tree; drag-and-drop works."

Concretely:

1. All 12 UI checkpoint tests (TC-U-01 through TC-U-12) pass.
2. All 100 API integration tests (TC-A-01 through TC-A-100) pass.
3. All 12 authorisation boundary tests (TC-B-01 through TC-B-12) pass.
4. All 12 data integrity tests (TC-D-01 through TC-D-12) pass.

**Total: 136 test cases.**

Any failure is recorded in the Phase 2 Test Report with: severity, classification (specification gap / specification error / implementation gap / environment issue), root-cause analysis, fix applied, and re-test result. A FAIL verdict is permitted to convert to PASS only after re-test.

**No Phase 2 fix may modify a test case to make it pass.** If a test reveals an ambiguity in the API Contract or a spec gap, the contract is updated (with a version bump) and the test is regenerated from the updated contract — never the other way round.

---

## 7. Out of Scope for Phase 2 Tests

Tests for the following are explicitly out of scope and are deferred to their relevant phase:

- Tiptap editors, content-field validation against rich text shapes (Phase 3).
- Auto-save and auto-save conflict resolution (Phase 3).
- `node_versions` table population semantics — Phase 2 only verifies `nodes.version` is bumped or not bumped per content-field changes (Migration 023). The actual version-history tab UI and version-row writing are Phase 3 concerns.
- Editorial comments, threaded discussions (Phase 5).
- Real-time tree updates (Phase 6 — node locks introduce real-time).
- Context node CRUD, scope (project/document), context linking (Phase 4). Phase 2 only verifies `node_category = "context"` returns 400 — context routes are not tested.
- Agent operations on nodes (Phase 5).
- Lock-acquisition UI; lock-status state-machine semantics (Phase 6). Phase 2 sets `locked = TRUE` only via PATCH (admin/test path) to prove the lock check works; it does not exercise lock acquisition.
- Mobile notes UI (Phase 3 mobile); the `mobile_notes` JSONB column stays untouched in Phase 2.
- Node attachments (Phase 2 backend only — UI is later phase). Phase 2 does not exercise attachments.
- DOCX export of a tree (Phase 7).

These are listed here so the absence of related tests in Phase 2 is intentional, not an oversight.

---

## 8. Approval

This Test Plan is approved before any implementation begins. Changes after approval are version-bumped on this document. The Test Plan is the authoritative tester's reference for Phase 2.

---

## 9. Changelog

**v1.0 — 2026-05-04** Initial Phase 2 Pre-Phase Test Plan. 136 test cases across UI checkpoint (12), API integration (100), authorisation boundary (12), data integrity (12). Derived from `stelavox_phase2_api_contract_v1_0.md` v1.0 and the Phase 2 checkpoint criterion in Technical Architecture v1.4 §11. Out-of-scope categories enumerated to make absences explicit (content editors, real-time, context nodes, lock-acquisition UI, mobile notes UI, attachments, DOCX export).
