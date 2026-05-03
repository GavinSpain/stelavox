# Stelavox — Phase 2 Build Checklist
## Version 1.0

> **Tier-B per-phase document.** The ordered, executable task list for Phase 2. Every task is sized to fit in one Claude Code session, has an explicit acceptance criterion, and references the spec section that authorises it. The agent works through this list top-to-bottom, marking each checkbox complete as the acceptance criterion is satisfied.

**Phase:** 2 — Node Tree: structural CRUD, react-arborist, status badges, reordering.
**Goal:** Deliver a working node tree where authors can build and rearrange the structural hierarchy of a document via drag-and-drop, with the H-04 sibling-renumber invariant held atomically at the database layer.
**Deliverable:** A merge-ready branch in which all 136 test cases in `stelavox_phase2_test_plan_v1_0.md` pass, deployed against a Phase A (local) Supabase stack and smoke-tested against Phase B (cloud `stelavox-dev`).
**Estimated weeks:** 3–4 (per Technical Architecture v1.4 §11).
**Dependencies on prior phases:** Phase 1 merged to `master`. Migrations 001–019, the seed templates, and the document-creation flow are required preconditions.
**Companion documents:** `stelavox_phase2_api_contract_v1_0.md` (frozen), `stelavox_phase2_test_plan_v1_0.md` (frozen).

---

## 1. Pre-Build Prerequisites

Before any task in §3 begins:

- [ ] **PB-1.** Phase 1 is merged to `origin/master` (commit `9039498`) and TA v1.4 is in (commit `464fd23`). Acceptance: `git -C C:/dev/stelavox_2 log --oneline -3` shows both commits.
- [ ] **PB-2.** A fresh worktree is created from master at `C:/dev/stelavox_2/.claude/worktrees/<random-name>` on a new feature branch `claude/<random-name>` (the `sweet-rhodes-b546ed` pattern from Phase 1). Acceptance: `git worktree list` shows the new worktree; the branch is ahead of master by 0 commits.
- [ ] **PB-3.** Local Supabase stack is started in the new worktree on +10-shifted ports (54330–54339). Acceptance: `supabase status` reports running; Studio reachable at `http://127.0.0.1:54333`; Mailpit at `:54334`.
- [ ] **PB-4.** All 19 prior migrations apply cleanly on a fresh DB (`supabase db reset` succeeds). Seed loads without errors. Acceptance: `nodes` row count is 0; `layer_stacks` template count is 3; `platform_config` has 41 rows; one `director_configs` row.
- [ ] **PB-5.** `npm install` is run in the worktree; `npm run dev` starts on `http://localhost:3000`; `npm run build` and `npm run type-check` pass on the inherited Phase 1 codebase. Acceptance: all four commands exit 0.
- [ ] **PB-6.** API Contract v1.0 (`stelavox_phase2_api_contract_v1_0.md`) and Test Plan v1.0 are reviewed and approved by the human. Acceptance: this file's commit message references both as inputs.

If any prerequisite fails, work stops and the cause is fixed before §3 begins.

---

## 2. Phase Checkpoint Criteria

The phase is considered complete when **every** condition holds. The Test Plan tests these:

1. **Document creation populates the root node.** A fresh document has exactly one node with `parent_id IS NULL` and `documents.root_node_id` matches its id. (TC-A-95 to TC-A-100, TC-D-09.)
2. **Tree CRUD works through the UI and API.** Create / read / list / rename / status-change / delete via tree UI and API endpoints. (TC-U-01 to TC-U-04, TC-A-01 to TC-A-74.)
3. **Drag-and-drop reorder works.** Within-parent reorder + cross-parent move both succeed via the UI and update the DB consistent with the H-04 atomic-renumber invariant. (TC-U-05, TC-U-06, TC-A-75 to TC-A-94.)
4. **Layer hierarchy is enforced.** Cannot create or move a node into a parent whose layer doesn't admit it. UI either prevents the drop or surfaces a server `422 layer_violation` and rolls back. (TC-U-07, TC-A-18, TC-A-82.)
5. **Cycle detection rejects without writing.** A move that would put a node inside its own subtree returns 422 and leaves DB unchanged. (TC-A-80, TC-A-81, TC-D-07.)
6. **Sibling order is dense after every modification.** No gaps; no overlaps. (TC-D-01 to TC-D-04.)
7. **Depth recalculation across descendants is correct.** Cross-parent moves update the moved node and every descendant. (TC-A-83, TC-D-05.)
8. **Lock checks reject writes.** Locked node and locked-ancestor cases return 423 and leave DB unchanged. (TC-A-20, TC-A-21, TC-A-59, TC-A-60, TC-A-69, TC-A-70, TC-A-89, TC-A-90, TC-A-91, TC-D-11.)
9. **RLS blocks cross-user access for every Phase 2 endpoint.** (TC-B-01 to TC-B-12.)
10. **All 23 migrations apply cleanly in order on a fresh database** (001–019 carried over, 020/021/023 added — number 022 intentionally skipped). Re-applying the seed file is idempotent. (Tested as part of fresh-DB CI runs.)
11. **`lib/types/database.ts` is up-to-date** with the migrated schema and is not edited by hand. (Hazard H-10.)
12. **`npm run build`, `npm run lint`, `npm run type-check` all succeed** on the final branch state.
13. **Inviolable #2 audit: verdigris appears only in the four permitted Phase 2 locations.** Of the nine reservations in CLAUDE.md, Phase 2 introduces uses #4 (agent-complete badge — but agents are Phase 5, so this is staged — `WorkflowStepIndicator` complete state is the Phase 2 use), #5 (approved status badge), and #9 (active node left border in tree). The Phase 2 Test Report includes a manual audit of every `var(--color-accent)` and `#3d7858`/`#254a38` literal in the diff.

The Test Plan's Verdict Criteria (§6) is the single authoritative pass/fail rule.

---

## 3. Ordered Task List

Tasks are grouped by subsystem. Within a group, complete top to bottom. Across groups, complete top to bottom unless explicitly marked **(parallelisable)**.

> **Reminder for the agent (per global CLAUDE.md):** before each task, propose the change in one sentence and wait for confirmation. Diagnose before fixing if anything fails. Never refactor adjacent code in the same change.

> **Model selection (per `stelavox_model_selection_v1_0.md`):** Tier-B authoring done; default model for §3.1–§3.4 implementation is **Sonnet 4.6**. **§3.5 Migration 021 (`move_node`) is Opus 4.7** (H-04 hazard work). Promote to Opus mid-task on any of the three triggers — spec contradiction, diagnosis exhausted in 2–3 attempts, hazard-relevant code.

---

### 3.1 Migrations and types

> **Authority note.** The migration SQL files are authoritative. The DDL in `stelavox_phase2_api_contract_v1_0.md` §1.4 is summary; if any task below paraphrases SQL, the migration file wins.

> **Workflow.** For each migration: (a) create the file with `supabase migration new <description>` so the timestamp prefix is auto-generated; (b) paste the SQL; (c) run `supabase db push`; (d) verify in Studio; (e) regenerate types per T-1.4.

- [ ] **T-1.1.** Migration **020** — `CREATE OR REPLACE FUNCTION create_document_with_layer_stack` extending the Phase 1 RPC to also insert the document's root node and back-fill `documents.root_node_id`. Spec: API Contract v1.0 §1.4 / §3.7. **Final form** must include all corrections that landed in Migrations 015–019 (search_path, FK ordering, service_role bypass) plus the new root-node insert. Acceptance: a fresh `POST /api/projects/[id]/documents` for each of the three template types (`novel`, `short_story`, `series`) returns a body containing `root_node` with the correct `node_type` for that template's layer 0; `documents.root_node_id` matches. TC-A-95 to TC-A-99 pass.

- [ ] **T-1.2.** Migration **021** — `CREATE FUNCTION move_node(p_node_id UUID, p_parent_id UUID, p_position INTEGER) RETURNS JSONB` as `SECURITY DEFINER SET search_path = public` (H-13). The function:
  1. Reads the node and verifies it exists.
  2. Verifies organisation membership (skipped when `auth.uid() IS NULL` per the Migration 019 pattern, so service-role can call for fixture setup).
  3. Verifies the new parent is in the same document and is structural.
  4. Performs cycle detection (recursive CTE: `parent_id` MUST NOT appear in the moved node's descendant set).
  5. Validates the layer hierarchy: moved node's `node_type` matches `(new_parent.layer_index + 1)` per the document's `layer_stacks.layers`.
  6. Validates `position` is in `[0, new_parent.child_count]` (within-parent move uses `[0, child_count - 1]`).
  7. Verifies neither moved node is locked, nor any ancestor of the moved node, nor any ancestor of the new parent.
  8. Renumbers old siblings (decrement `order` for old siblings with `order > moved.order`).
  9. Renumbers new siblings (increment `order` for new siblings with `order >= position + 1`).
  10. Updates moved node's `parent_id`, `order = position + 1`, `depth = new_parent.depth + 1`.
  11. If parent changed, recursively updates `depth` of all descendants via a recursive CTE plus an UPDATE.
  12. Returns `jsonb_build_object('node', <updated row>, 'renumbered_count', <count of rows whose order changed plus the moved node>)`.

  All 12 steps in one PL/pgSQL function (one transaction). `REVOKE ALL ... FROM PUBLIC; GRANT EXECUTE ... TO authenticated, service_role`.

  **Model:** Opus 4.7. This is the H-04 hazard work and the most subtle code in Phase 2.

  Acceptance: the function exists; integration test fixtures call it via service role (returns `forbidden`-style only when the fixture intentionally simulates an unauthenticated call); TC-A-75 through TC-A-94 + TC-D-01 to TC-D-12 pass against the function.

- [ ] **T-1.3.** Migration **023** — `BEFORE UPDATE` trigger on `nodes` that increments `version` only when one of `summary`, `prose`, `notes`, `metadata` changes. Non-content updates (rename, status, target, instruction, etc.) do **not** bump `version`. Skips number 022 (intentional gap per API Contract §1.4). Acceptance: a sequence of two PATCHes — one renames, one updates `summary` — produces `version = 1, 1, 2` (initial, after rename, after content). TC-A-44 through TC-A-47 pass.

- [ ] **T-1.4.** Run `npm run db:types` to regenerate `lib/types/database.ts`. Spec: H-10. Acceptance: file regenerated; `npm run type-check` passes. The diff vs the Phase 1 state is purely additive: the two new function signatures (`create_document_with_layer_stack` updated return type, `move_node` new entry).

### 3.2 App shell — layout primitives

Authoritative spec: `stelavox_component_specification_v2_0.md` §2 (Layout Components); `stelavox_ui_design_specification_v1_0.md` for tokens.

The Phase 1 `(app)/layout.tsx` is a placeholder. Phase 2 replaces it with the three-panel `AppShell`. The shell is a CSS grid: header (top, 48px), then a horizontal split with sidebar on the left, main content in the middle, detail panel on the right (Phase 2 starts the detail panel as an empty placeholder; content arrives Phase 3). `PanelResizer` between sidebar and main, and between main and detail.

- [ ] **T-2.1.** Create `components/layout/AppShell.tsx`. Three-panel CSS grid; header at top; left sidebar 280px default (resizable); centre main content; right detail panel 400px default (resizable, can collapse to 0). Acceptance: shell renders against any authenticated route; the dashboard and the project page (Phase 1 surfaces) render correctly inside the shell.
- [ ] **T-2.2.** Create `components/layout/Header.tsx`. 48px height; Wordmark on the far left (Phase 2 still uses the placeholder text `Stelavox` per the Phase 1 stub — the brand `<Wordmark>` component is not in Phase 2 scope); breadcrumb + ModeTabBar in the centre (Phase 2: only ModeTabBar's "Edit" tab is active; "Director" / "Focus" tabs are placeholder/disabled); user menu on the right. Acceptance: header renders; all token references via CSS custom properties (no hardcoded hex per the Design Token Rules).
- [ ] **T-2.3.** Create `components/layout/Sidebar.tsx`. Hosts the document selector at the top and the `NodeTree` in the body. Phase 2: sidebar contains the project + document name + the tree. Acceptance: opening a document populates the sidebar with the tree.
- [ ] **T-2.4.** Create `components/layout/PanelResizer.tsx`. Drag-to-resize handle between panels. **Inviolable #2 / Component Spec §2.4: dragging colour is `--color-border-strong`, NOT `--color-accent`.** Acceptance: dragging the handle updates the adjacent panel widths; the dragging visual uses border-strong; CSS audit confirms no `var(--color-accent)` reference in this file.
- [ ] **T-2.5.** Replace the Phase 1 stub `app/(app)/layout.tsx` with `<AppShell>` from T-2.1. Verify no Phase 1 surface (dashboard, project page, document page) regresses. Acceptance: TC-U-06 to TC-U-12 from **Phase 1's** test plan still pass against the new shell. (Don't run the full 118-test Phase 1 suite, just the 12 UI tests.)

### 3.3 Node CRUD API routes

Authoritative spec: API Contract v1.0 §3.1 to §3.5 (POST/GET list, GET/PATCH/DELETE single).

- [ ] **T-3.1.** Create `lib/validation/nodes.ts` with Zod schemas for `nodePostSchema` and `nodePatchSchema`. Apply `.strict()` so unknown fields produce `400 unknown_field`. Mirror Phase 1's `lib/validation/documents.ts` style. Acceptance: schemas reject every forbidden field listed in API Contract §2.5.
- [ ] **T-3.2.** Create `lib/data/nodes.ts` with thin Supabase wrappers: `createNode`, `listNodes` (returns flat array, depth-first), `getNode`, `updateNode`, `deleteNode`. The wrappers compose RLS-safe queries — no `user_id` filter. Acceptance: each function returns a typed row from the regenerated `database.ts`.
- [ ] **T-3.3.** Create `app/api/documents/[documentId]/nodes/route.ts` with `POST` and `GET`. Validation order per API Contract §3.1 / §3.2. Acceptance: TC-A-01 through TC-A-33 pass.
- [ ] **T-3.4.** Create `app/api/nodes/[nodeId]/route.ts` with `GET`, `PATCH`, `DELETE`. Validation order per API Contract §3.3 / §3.4 / §3.5. Acceptance: TC-A-34 through TC-A-74 pass (excludes `/move` which is T-3.5).
- [ ] **T-3.5.** Create `app/api/nodes/[nodeId]/move/route.ts` with `PATCH`. The route is thin — it parses the body, validates required fields, and calls the `move_node` RPC from T-1.2 via the user-session client. The RPC does the heavy lifting; the route surfaces RPC errors as the appropriate HTTP status (`422` for cycle/layer/parent issues, `423` for locks, `400` for malformed input). Acceptance: TC-A-75 through TC-A-94 pass.

### 3.4 Tree UI — react-arborist wiring

Authoritative spec: Component Spec §4.1 to §4.7.

- [ ] **T-4.1.** Add `react-arborist` to `package.json`. Run `npm install`. Acceptance: package installed; lockfile updated.
- [ ] **T-4.2.** Create `components/tree/NodeTree.tsx` — the react-arborist root. Reads node tree via the `GET /api/documents/[id]/nodes` endpoint; transforms the flat array into the parent-children tree shape react-arborist expects; passes the custom `NodeRow` renderer. Acceptance: rendering against a known-tree fixture matches the expected shape. Keyboard navigation works: ↑↓ rows, ←→ collapse/expand, Enter opens detail panel.
- [ ] **T-4.3.** Create `components/tree/NodeRow.tsx` per Component Spec §4.2. 36px height (44px tablet); 16px indent per depth level; chevron + type icon + name + (status badge) + hover actions. The active-node 2px left border uses `var(--color-accent)` — verdigris reservation #9. Hover actions: Add child (Plus icon), Agent (Zap icon — disabled in Phase 2 since agents arrive Phase 5), More (MoreHorizontal icon). Acceptance: TC-U-01, TC-U-02, TC-U-03 pass.
- [ ] **T-4.4.** Create `components/tree/NodeStatusBadge.tsx` per Component Spec §4.3. 8×8 circle; four colours; `--color-status-approved` (`#3d7858` dark / `#254a38` light) is verdigris reservation #4 / #5. Acceptance: TC-U-10 passes; CSS audit confirms `--color-status-approved` is the only verdigris reference in this component.
- [ ] **T-4.5.** Create `components/tree/LayerDivider.tsx` per Component Spec §4.7. Horizontal rule + 9px Inter 500 uppercase label. Reads `layer_stacks.layers[i].label` for each layer. Acceptance: rendering against a Novel template shows "BOOK", "ACTS", "CHAPTERS", "SCENES", "BEATS" labels (or whatever the layer.label values are — text via spec, not hardcoded).
- [ ] **T-4.6.** Wire the More menu items: Rename (opens detail panel + focuses name), Delete (opens confirmation dialog with descendant count from the API response shape `descendants_deleted`), Status (sub-menu of `draft`/`in_review`/`approved`/`locked`). Acceptance: TC-U-04 (rename), TC-U-08 (delete confirmation with count), TC-U-10 (status change) all pass.
- [ ] **T-4.7.** Wire the Add child action: clicking the `+` icon on a row opens a small inline prompt (or modal) for the new child's name and type. The type defaults to whatever the parent's child layer admits per `layer_stacks.layers[parent.layer_index + 1].node_type`; the user can confirm or pick a different type if multiple are admitted (Phase 2 templates have one type per layer, so this is currently always single-choice). Acceptance: TC-U-02, TC-U-03 pass.
- [ ] **T-4.8.** Implement the cannot-delete-root behaviour in the More menu: hide the Delete item entirely when the row is the document's root. Acceptance: TC-U-09 passes.

### 3.5 Tree UI — drag-and-drop

Authoritative spec: Component Spec §4.1 (drag-and-drop note); API Contract v1.0 §3.6.

- [ ] **T-5.1.** Configure react-arborist's drag handlers. The `onMove` callback fires with `{ dragIds, parentId, index }`. For each call, issue `PATCH /api/nodes/[dragId]/move` with `{ parent_id, position: index }`. Server-side validation handles cycle / layer / lock; client interprets responses:
    - `200`: optimistic update committed.
    - `422 cycle_detected`: roll back UI; show toast `"Cannot move a node inside itself."`
    - `422 layer_violation`: roll back UI; show toast `"<Type> belongs inside <ParentType>, not <AttemptedParentType>."`
    - `422 invalid_parent` (cross-doc): roll back UI; toast `"Cannot move between documents."`
    - `423 node_locked` / `parent_locked`: roll back UI; toast `"This <type> is locked. Unlock the layer to move it."`
   Acceptance: TC-U-05, TC-U-06, TC-U-07 pass.

- [ ] **T-5.2.** Implement client-side optimistic update: on `onMove`, update local tree state immediately, send the API call, on failure roll back to the pre-move state. Use a single source of truth (a Zustand store or React Query's mutation hooks) so the rollback is deterministic. Acceptance: failing the API call (e.g. by killing the dev server momentarily) leaves the tree in its pre-move state.

### 3.6 Detail panel shell

Authoritative spec: Component Spec §5.1, §5.2.

- [ ] **T-6.1.** Create `components/detail/NodeDetailPanel.tsx` — the right-panel container. Phase 2 scope: name heading (editable), status pill, and the TabStrip with placeholder tabs (`Summary`, `Prose`, `Notes`, `Agent`, `Comments`, `History`). Tabs are present but their content is a phase-banner ("Coming in Phase 3") for the editor tabs, "Coming in Phase 5" for Agent/Comments, "Coming in Phase 3" for History. Acceptance: clicking a tab updates the active tab indicator (`var(--color-text-primary)` at 0.6 opacity per Inviolable #2's PanelResizer/TabStrip note); the corresponding placeholder content shows.
- [ ] **T-6.2.** Wire the name heading as a click-to-edit field. Click → input; Enter or blur → submit `PATCH /api/nodes/[id]` with the new name; Esc → cancel. Acceptance: TC-U-04 passes.
- [ ] **T-6.3.** Wire the status pill as a dropdown/select that issues `PATCH /api/nodes/[id]` with `{ status: "<new>" }`. Acceptance: TC-U-10 passes.

### 3.7 Empty states and onboarding

- [ ] **T-7.1.** When a fresh document is opened (root only, no children), display a subtle hint near the root row: `"Hover the row and click + to add your first <child layer label>."` Where `<child layer label>` is `layer_stacks.layers[1].label` (e.g. "Act" for Novel). Hint disappears once the first child exists. Acceptance: visiting a fresh document shows the hint; creating any child hides it.
- [ ] **T-7.2.** When the tree is loading (initial fetch), show a minimal loading state — the chevron + indent placeholder rows. No spinners. Acceptance: throttling the network in devtools shows the skeleton; full render appears once data arrives.

### 3.8 Phase A → Phase B smoke test (parallelisable with T-9.x)

- [ ] **T-8.1.** Apply Migrations 020, 021, 023 to `stelavox-dev` cloud project via Supabase MCP `apply_migration`. Acceptance: `mcp__...__list_migrations(stelavox-dev)` shows all 22 migrations (003 + 16 from Phase 1 + 020/021/023 = 22, with 022 skipped).
- [ ] **T-8.2.** Run a 5-test cloud smoke subset against `stelavox-dev`: TC-U-01 (open document, see root), TC-U-02 (create child via UI), TC-U-05 (within-parent reorder), TC-U-06 (cross-parent move), TC-U-12 (sibling renumber after delete). Use `--timeout=60000` per the Phase 1 lesson. Acceptance: all 5 pass.

### 3.9 Test execution

- [ ] **T-9.1.** Create test files matching Phase 1's structure:
    - `tests/api/nodes.spec.ts` — TC-A-01 to TC-A-100.
    - `tests/api/move.spec.ts` (or fold into nodes.spec.ts) — TC-A-75 to TC-A-94.
    - `tests/boundary/nodes-rls.spec.ts` — TC-B-01 to TC-B-12.
    - `tests/integrity/nodes-data.spec.ts` — TC-D-01 to TC-D-12.
    - `tests/ui/tree.spec.ts` — TC-U-01 to TC-U-12.
    - `tests/helpers/tree.ts` — `expectTreeShape`, `setupTree(documentId, shape)`, helper for service-role tree fixture creation.
   Acceptance: all 5 spec files exist; `tests/helpers/tree.ts` exists.
- [ ] **T-9.2.** Run `npx playwright test` from the worktree. Iterate on any failures: classify (spec gap / spec error / impl gap / env), fix the cause (spec fix → contract version bump → regenerate the test; impl fix → code change), re-run. **Do not modify a test case to make it pass** — that is forbidden by the Test Plan §6 rule. Acceptance: 136/136 PASS in a clean run.
- [ ] **T-9.3.** Run `npm run build`, `npm run lint`, `npm run type-check`. Acceptance: all three exit 0.

### 3.10 Pre-merge checks

- [ ] **T-10.1.** Diff review of every changed file. Look for: hardcoded operational values (H-12); brand violations (Cinzel/Cormorant outside `components/brand/`; verdigris outside the nine permitted locations — Phase 2 introduces uses #4/#5 in `NodeStatusBadge` and #9 in `NodeRow`); direct LLM SDK calls (still N/A in Phase 2); H-01 (`.single()` vs `.maybeSingle()`); H-13 / H-14 patterns in any new SQL.
- [ ] **T-10.2.** Regenerate `lib/types/database.ts` against `stelavox-dev` (per Phase 1 pattern). Acceptance: clean diff aside from the new function signatures.
- [ ] **T-10.3.** Confirm `CLAUDE.md` (root) and `docs/CLAUDE_stelavox_project.md` are byte-identical.
- [ ] **T-10.4.** Update `CLAUDE.md` Spec Library Reference table if any spec versions bumped during Phase 2 (none expected — TA stays v1.4 unless a Phase 2 SU forces a bump).
- [ ] **T-10.5.** Bump `stelavox_phase2_build_checklist_v1_0.md` to v1.1 if anything in this document needed correction during the build. Add a changelog entry.
- [ ] **T-10.6.** Compose `docs/stelavox_phase2_test_report_v1_0.md` per AI-Native Spec Standard §2.12 — every test case PASS/FAIL with root cause + fix + re-test. **Model: Opus 4.7** (advisory §5).

---

## 4. Locked Migration Ordering

The 22-file migration sequence at end of Phase 2:

| # | Filename | Phase introduced |
|---|---|---|
| 001 | core_tables | Phase 1 |
| 002 | handle_new_user_trigger | Phase 1 |
| 003 | phase1_rls_policies | Phase 1 |
| 004 | nodes | Phase 1 |
| 005 | versioning_comments_context_links | Phase 1 |
| 006 | agent_jobs_and_reports | Phase 1 |
| 007 | director_tables | Phase 1 |
| 008 | multi_tenancy_support | Phase 1 |
| 009 | export_and_layer_stack_fk | Phase 1 |
| 010 | cloud_backup | Phase 1 |
| 011 | mobile_notes_and_attachment_count | Phase 1 |
| 012 | node_attachments | Phase 1 |
| 013 | director_config_and_scheduler | Phase 1 |
| 014 | platform_config | Phase 1 |
| 015 | create_document_with_layer_stack | Phase 1 |
| 016 | handle_new_user_fix_search_path | Phase 1 |
| 017 | create_document_with_layer_stack_fix_search_path | Phase 1 |
| 018 | create_document_with_layer_stack_fix_fk_order | Phase 1 |
| 019 | create_document_allow_service_role | Phase 1 |
| 020 | create_document_with_layer_stack_extend_root_node | **Phase 2** |
| 021 | move_node | **Phase 2** |
| 022 | *(intentionally skipped — pre-launch backfill placeholder)* | — |
| 023 | nodes_version_bump_trigger | **Phase 2** |

The number 022 is reserved for a future legacy-data backfill if one becomes necessary post-launch. Migration ordering MUST NOT change.

---

## 5. Migration Authority Note

The migration SQL files are authoritative for Phase 2. The DDL summaries in Technical Architecture v1.4 §3.6 (which already cover migrations 020/021/023 as part of the v1.4 update) are summary; if any spec discrepancy is found, the migration file wins, and the discrepancy is flagged for §6 below.

---

## 6. Specification Updates Required After Phase 2

Items raised during Phase 2 build that imply a TA v1.5 or Product Spec v1.3 update. These are tracked here so they're not lost:

- **SU-1.** API Contract §5 G-1: `nodes.scope` is non-NULL only for `node_category = 'context'`. Document in TA v1.5 §3.6 Migration 004 block.
- **SU-2.** API Contract §5 G-2: root-node default name = document name. Document in Product Spec v1.3 §4.5.
- **SU-3.** API Contract §5 G-3: `nodes.version` content-only bump rule. Document in TA v1.5 §3.6 Migration 023 block.
- **SU-4.** API Contract §5 G-4: `node_locked` vs `parent_locked` error code distinction. Document in TA v1.5 §5 (locking discussion).

Additional SU items may surface during the build; add them to this list when discovered, then process them in a single follow-up TA v1.5 commit after Phase 2 merges (mirror of the TA v1.4 close-out after Phase 1).

---

## 7. Risk Register

Phase-2-specific risks and their mitigations.

| Risk | Likelihood | Mitigation |
|---|---|---|
| **`move_node` has a subtle bug under concurrent moves.** | Medium | TC-D-12 explicitly tests concurrent `Promise.all` moves; serialise via row-level locks in the RPC. Run on Opus. |
| **react-arborist drag emulation in Playwright is flaky.** | Medium | Have a fallback path that dispatches `dragstart`/`dragover`/`drop` events directly (per Test Plan §1.4). Skip TC-U-05 / TC-U-06 from CI if Playwright drag is unworkable; document in the Test Report. |
| **Layer-violation UX is ambiguous.** | Low | TC-U-07 admits two valid implementations (client-side reject vs optimistic-rollback). Pick one early; match the test to whichever is built. |
| **Cross-parent depth recalc misses edge cases (deep subtrees).** | Low–Medium | TC-A-83 + TC-D-05 test depth across descendants. Recursive CTE handles arbitrary depths. |
| **Phase 1 tests regress under the new `AppShell`.** | Low | T-2.5 explicitly re-runs the 12 Phase 1 UI tests; failure halts the merge. |
| **Migration 023 trigger overhead is felt in tests.** | Low | The trigger fires per-row UPDATE; expected overhead is sub-millisecond. If profiling shows otherwise, document in Test Report and consider deferred / column-level approach. |

---

## 8. Approval

This Build Checklist is approved before any Phase 2 implementation begins. Changes after approval are version-bumped on this document. The Build Checklist is the authoritative implementer's reference for Phase 2.

The three architectural decisions that shaped the contract (and therefore this checklist) were resolved with the human on 2026-05-04:

| # | Decision | Choice |
|---|---|---|
| Q1 | Endpoint shape | Hybrid REST (Phase 1 pattern): document-scoped POST/list, top-level GET/PATCH/DELETE/move |
| Q2 | Reorder shape | `PATCH /api/nodes/[id]/move` with `{ parent_id, position }` |
| Q3 | Root-node creation | Atomic with document creation (extend `create_document_with_layer_stack`) |

Plus four implementation calls confirmed during Test Plan review:

| # | Call | Choice |
|---|---|---|
| 1 | Lock checks shipped in Phase 2, lock UI in Phase 6 | Yes |
| 2 | Migration 022 skipped | Yes (clean-slate pre-launch) |
| 3 | Root node default name = document name | Yes |
| 4 | Content fields accepted on PATCH but no UI | Yes |

---

## 9. Changelog

**v1.0 — 2026-05-04** Initial Phase 2 Build Checklist. Ten task groups covering migrations (3.1), app shell (3.2), node CRUD API (3.3), tree UI (3.4), drag-and-drop (3.5), detail panel shell (3.6), empty states (3.7), Phase B smoke test (3.8), test execution (3.9), pre-merge checks (3.10). 23 prerequisite migration files locked in §4. Six pre-build prerequisites (PB-1 to PB-6). Thirteen phase-checkpoint criteria. Four SU items pre-staged for TA v1.5 absorption.
