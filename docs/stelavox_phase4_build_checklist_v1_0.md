# Stelavox — Phase 4 Build Checklist
## Version 1.0

> **Tier-B per-phase document.** The ordered, executable task list for Phase 4. Every task is sized to fit in one Claude Code session, has an explicit acceptance criterion, and references the spec section that authorises it. The agent works through this list top-to-bottom, marking each checkbox complete as the acceptance criterion is satisfied.

**Phase:** 4 — Context System: context node CRUD, project- vs document-scope, structural↔context linking, per-type metadata schemas (six core context types), Sidebar context library, Detail-panel Context tab.
**Goal:** Deliver a working context system where authors can create the six core context types (Character, Location, Organisation, Theme, Plot Thread, World), give them structured metadata, and link them to structural nodes — direct and inherited — through the Sidebar library and the Detail-panel Context tab.
**Deliverable:** A merge-ready branch in which every test case in `stelavox_phase4_test_plan_v1_0.md` passes, deployed against a Phase A (local) Supabase stack and smoke-tested against Phase B (cloud `stelavox-dev`).
**Estimated weeks:** 6 (per Technical Architecture v1.7 §11).
**Dependencies on prior phases:** Phase 3 merged to `master`. Migrations 001–021 + 023 (with 022 intentionally skipped), the Phase 2 node API, the Phase 3 PATCH `expected_version` contract, the AppShell, the NodeTree, the NodeDetailPanel are required preconditions.
**Companion documents:** `stelavox_phase4_api_contract_v1_0.md` (frozen), `stelavox_phase4_test_plan_v1_0.md` (frozen).

---

## 1. Pre-Build Prerequisites

Before any task in §3 begins:

- [ ] **PB-1.** Phase 3 is merged to `origin/master` (commit `f849b7d`) and TA v1.7 / Product Spec v1.3 / Component Spec v2.5 / CLAUDE.md v1.8 are in. Acceptance: `git -C C:/dev/stelavox_2 log --oneline -8 master` shows `f849b7d` as the Phase 3 merge commit and Phase 3 v1.6 / v1.5 / v1.4 corrective commits beneath it.
- [ ] **PB-2.** A fresh worktree exists at `C:/dev/stelavox_2/.claude/worktrees/<random-name>` on a feature branch `claude/phase4-context` (the per-session worktree pattern from Phase 1 / 2 / 3). Acceptance: `git worktree list` shows the new worktree; the branch is ahead of master by 0 commits.
- [ ] **PB-3.** Local Supabase stack is started in the new worktree on +10-shifted ports (54330–54339). Acceptance: `supabase status` reports running; Studio reachable at `http://127.0.0.1:54333`; Mailpit at `:54334`.
- [ ] **PB-4.** All 22 prior migrations apply cleanly on a fresh DB (`supabase db reset` succeeds). Seed loads without errors. Acceptance: `nodes` row count is 0; `node_context_links` row count is 0; `layer_stacks` template count is 3; `platform_config` has 41 rows; one `director_configs` row.
- [ ] **PB-5.** `npm install` is run in the worktree; `npm run dev` starts on `http://localhost:3000`; `npm run build`, `npm run lint`, `npm run type-check` all pass on the inherited Phase 3 codebase. Acceptance: all four commands exit 0.
- [ ] **PB-6.** No new dependencies needed. Acceptance: `git diff master -- package.json package-lock.json` is empty until §3.4's UI work begins (and even then no npm installs are expected — Tiptap, Lucide, and shadcn/ui are already present from Phase 3).
- [ ] **PB-7.** API Contract v1.0 (`stelavox_phase4_api_contract_v1_0.md`) and Test Plan v1.0 are reviewed and approved by the human. Acceptance: this file's commit message references both as inputs.

If any prerequisite fails, work stops and the cause is fixed before §3 begins.

---

## 2. Phase Checkpoint Criteria

The phase is considered complete when **every** condition holds. The Test Plan tests these:

1. **Six core context types are creatable from the Sidebar.** The Sidebar's previously-empty Context library populates with six collapsible sections (Characters / Locations / Organisations / Themes / Plot Threads / Worlds). Each `+` button opens the modal pre-set to that type. (TC-U-01..TC-U-05.)
2. **Both scopes work end-to-end.** Project-scoped context nodes appear in every document's Picker; document-scoped nodes appear only in their document. (TC-U-19, TC-U-20, TC-A-01..TC-A-04, TC-A-12.)
3. **The V1 whitelist holds.** POST rejects any `node_type` outside the six. The Picker / Sidebar / Detail panel correctly icon-and-label each. (TC-A-05, TC-V-01.)
4. **Linking works in both directions** (create + delete) with all four cross-context guards (cross-project, cross-document, cross-source-category, cross-target-category) active. (TC-A-15..TC-A-25.)
5. **Inheritance follows the closest-ancestor rule.** Direct and inherited entries are correctly grouped on the Context tab; closest ancestor wins on duplication; direct supersedes inherited on the same node. (TC-U-13, TC-U-14, TC-U-15, TC-A-26..TC-A-29.)
6. **MetadataForm renders the per-type schema.** Each of the six types has its 4–8 fields rendered in the right order with the right labels and input types. (TC-U-07, plus per-type sub-cases under TC-U-07's helper.)
7. **Delete-with-back-links shows the confirmation flow.** Default DELETE returns 409 with count; `?force=true` cascades. UI surfaces the back-links list before confirmation. (TC-U-17, TC-U-18, TC-A-33..TC-A-35.)
8. **Move on a context node is rejected.** The Phase 2 `/move` endpoint returns 400 `invalid_move_target` when called on a context node. (TC-A-32.)
9. **PATCH on a context node honours Phase 3's optimistic-concurrency contract.** `expected_version` round-trips correctly; 409 surfaces a conflict banner just like on a structural node. (TC-A-36.)
10. **All 22 migrations apply cleanly in order on a fresh database.** No new migrations in Phase 4. (Tested as part of fresh-DB CI runs.)
11. **`lib/types/database.ts` is up-to-date.** No regeneration needed (no schema changes); a confirmation regen is run anyway and produces a no-op diff. (Hazard H-10.)
12. **`npm run build`, `npm run lint`, `npm run type-check` all succeed** on the final branch state.
13. **Inviolable audits pass.** (a) Inviolable #1 — context detail panel uses `--color-bg-base` for the editor surfaces (Summary / Notes carry forward Phase 3's bases). (b) Inviolable #2 — verdigris is NOT introduced anywhere in Phase 4 (the Picker checkmark uses `--color-text-muted`; Sidebar uses the existing palette). Manual audit of every `var(--color-accent)` and `#3d7858` / `#254a38` literal in the diff. (c) Inviolable #3 — no Cinzel in the Sidebar / Modal / Picker / ContextLinker. (d) Inviolable #4 — Inter in Sidebar, Modal labels, Picker, ContextLinker; Lora is not introduced. (e) Inviolable #5 — N/A (no prose editor changes).

The Test Plan's Verdict Criteria (§9) is the single authoritative pass/fail rule.

---

## 3. Ordered Task List

Tasks are grouped by subsystem. Within a group, complete top to bottom. Across groups, complete top to bottom unless explicitly marked **(parallelisable)**.

> **Reminder for the agent (per global CLAUDE.md):** before each task, propose the change in one sentence and wait for confirmation. Diagnose before fixing if anything fails. Never refactor adjacent code in the same change.

> **Model selection (per `stelavox_model_selection_v1_0.md`):** Tier-B authoring done; the per-phase advisory recommends **Opus 4.7 for §3.1 (metadata schema design — "30+ subtypes need precise metadata schemas") and §3.3 (project-vs-document scope query routing — "scope queries" is the named hazard-relevant work)**. Default model for the rest is **Sonnet 4.6**. Promote to Opus mid-task on any of the three triggers — spec contradiction, diagnosis exhausted in 2–3 attempts, hazard-relevant code.

---

### 3.1 Schemas, types, and the V1 whitelist

Authoritative spec: API Contract §2.5, §3.1, G-4; Product Spec §4.7. **Opus territory** for the metadata-schema authoring per the model_selection advisory.

- [ ] **T-1.1.** Create `lib/context/types.ts`. Export `const CONTEXT_NODE_TYPES_V1 = ['character','location','organisation','theme','plot_thread','world'] as const` and `type ContextNodeType = typeof CONTEXT_NODE_TYPES_V1[number]`. The list is the V1 whitelist per API Contract G-4 — additions require a contract bump. Acceptance: type compiles; the constant is `as const` (narrow tuple); the union type narrows correctly in a Zod enum.

- [ ] **T-1.2.** Create `lib/context/labels.ts`. Export `getContextLabel(type, plural?)` returning the V1 display label per type: Character/Characters, Location/Locations, Organisation/Organisations, Theme/Themes, Plot Thread/Plot Threads, World/Worlds. The labels deliberately use British spelling ("Organisation" with -s, not -z) to match the existing code style. Acceptance: function returns the correct label for each of the six types; throws on unknown type.

- [ ] **T-1.3.** Create `lib/context/icons.ts`. Map each `ContextNodeType` to a Lucide icon name: `Character → User`, `Location → MapPin`, `Organisation → Building2`, `Theme → Sparkles`, `Plot Thread → GitBranch`, `World → Globe`. Export `getContextIcon(type)` returning the corresponding `LucideIcon` component (already in the bundle). Acceptance: each type returns a non-null component; rendering at 14px in `--color-text-muted` matches TC-V-01.

- [ ] **T-1.4.** Create `lib/context/metadata-schemas.ts`. Export `getMetadataSchema(type)` returning the V1 schema per type. Each schema is `{ fields: Array<{ key, label, type: 'text'|'number'|'date'|'select'|'textarea', options?: string[], required?: boolean, description?: string }> }`. Schemas:
  - **Character:** `role` (select: protagonist/antagonist/supporting/minor), `age` (number), `want` (text), `fear` (text), `voice` (textarea — voice notes/quirks for the agent system).
  - **Location:** `region` (text), `climate` (text), `era` (text), `mood` (text), `physical_description` (textarea).
  - **Organisation:** `type` (select: government/corporate/criminal/religious/academic/family/other), `power_level` (text), `goals` (textarea), `key_members` (textarea).
  - **Theme:** `statement` (textarea — single-sentence formulation), `evidence` (textarea — where it shows in the work), `counter_examples` (textarea).
  - **Plot Thread:** `arc` (textarea — the shape from setup to payoff), `key_moments` (textarea), `status` (select: setup/rising/climax/resolution).
  - **World:** `genre_grounding` (text), `magic_or_technology` (textarea), `historical_period` (text), `core_rules` (textarea).
  
  All fields are **optional in V1** (per API Contract G-2 — server validates none of them; client validation is non-blocking). Acceptance: `getMetadataSchema('character')` returns the Character schema; the union of all six schemas covers no overlapping `key` values within a single type.

- [ ] **T-1.5.** Update `lib/validation/nodes.ts`. Add `nodeContextPostSchema` (new) — `.strict()` Zod object: `scope` (z.enum(['project','document'])), `document_id` (uuid optional), `node_type` (z.enum from `CONTEXT_NODE_TYPES_V1`), `name` (required, trimmed, 1–200), `short_description` (optional, ≤1000), `summary` / `prose` / `notes` (carry-forward Phase 3 size limits), `metadata` (free-form JSON object), `tags` (string array, ≤20 entries). Acceptance: schema rejects empty name, unknown node_type, unknown fields. The route uses this schema; the existing `nodePostSchema` (structural) is unchanged.

- [ ] **T-1.6.** Update `lib/validation/nodes.ts` to expose `nodePatchSchema` for context-node updates. The schema is identical to the existing PATCH schema with `scope`, `document_id`, `node_category`, `node_type`, `parent_id` rejected as unknown fields (already covered by `.strict()` since none are in the schema). No new schema is needed; the existing PATCH schema works for both categories. Acceptance: a PATCH body with `scope: "document"` returns `400 unknown_field` (the route maps the issue path to the right error code).

- [ ] **T-1.7.** Create `lib/validation/context-links.ts`. Export `contextLinkPostSchema` (`{ context_node_id: uuid }`, `.strict()`) and re-export the `uuid` schema for path validation. Acceptance: rejects extra fields with `unknown_field`; rejects malformed UUIDs.

### 3.2 Data layer wrappers

Authoritative spec: API Contract §3.1–§3.6; mirrors the existing `lib/data/nodes.ts` style.

- [ ] **T-2.1.** Add `createContextNode(supabase, fields)` to `lib/data/nodes.ts`. Mirror of the existing `createNode` helper but without the structural-only assumptions. Sets `node_category='context'`, `parent_id=null`, `depth=null`, `layer_index=null`, `version=1`, `status='draft'`. Acceptance: round-trip insert+select returns the inserted row; the helper is typed via `Database['public']['Tables']['nodes']['Insert']` and tightens to the context shape via TS narrowing.

- [ ] **T-2.2.** Add `listContextNodesByProject(supabase, projectId, filters)` to `lib/data/nodes.ts`. Filters: `{ scope?, documentId?, nodeType?, limit, offset }`. The query joins the project filter with the scope-merge logic per API Contract §3.2 G-3b (when `documentId` is supplied, return both `scope='project'` for `projectId` and `scope='document' AND document_id=documentId`). Order by `node_type ASC, lower(name) ASC`. Acceptance: TC-A-10..TC-A-14 pass against this wrapper.

- [ ] **T-2.3.** Create `lib/data/context-links.ts`. Wrappers:
  - `createContextLink(supabase, sourceId, targetId, organisationId)` — INSERT into `node_context_links`. Returns the new row or null on UNIQUE conflict.
  - `deleteContextLink(supabase, sourceId, targetId)` — DELETE matching `(source_node_id, target_node_id)`. Returns the number of rows affected (0 → 404).
  - `listDirectLinks(supabase, sourceId)` — SELECT all links where `source_node_id=sourceId`, with the joined target node row.
  - `listAncestorLinksForNode(supabase, sourceId)` — internally walks `parent_id` to root, collects ancestor IDs, then runs ONE `SELECT … WHERE source_node_id IN (...)` query. Returns the rows tagged with their source's depth so the route can dedupe.
  - `listBackLinks(supabase, contextNodeId)` — SELECT links where `target_node_id=contextNodeId`, joined to the source structural node and its document.
  - `countBackLinks(supabase, contextNodeId)` — fast COUNT(*) variant for the delete-confirmation flow.
  Acceptance: each wrapper has a unit test against a service-role fixture; types resolve cleanly without manual casts.

- [ ] **T-2.4.** Add `getProjectById(supabase, projectId)` to `lib/data/projects.ts` if not already present. The new POST and GET routes need it for the project-existence check. Acceptance: returns the project row or null; mirrors `getDocument` in shape.

### 3.3 API routes

Authoritative spec: API Contract §3.1–§3.6, §2.3, §2.5. **Opus territory** for the scope-query routing per the model_selection advisory.

- [ ] **T-3.1.** Create `app/api/projects/[projectId]/context-nodes/route.ts` with POST and GET handlers. POST implements §3.1 step-by-step; GET implements §3.2 step-by-step. Both use the user-session client (RLS-enforced); both call into the `lib/data/nodes.ts` wrappers. Acceptance: TC-A-01..TC-A-14 all pass; the Phase 3 documents/[id]/nodes endpoint is unchanged.

- [ ] **T-3.2.** Add three new error helpers to `lib/api/errors.ts`: `invalidScope()`, `invalidNodeType(received?: string)`, `scopeDocumentMismatch()`, `documentNotInProject()`, `invalidLinkSource()`, `invalidLinkTarget()`, `linkCrossProject()`, `linkCrossDocument()`, `linkAlreadyExists(link)`, `cannotDeleteWithBackLinks(count)`, `linkNotFound()`, `contextNodeNotFound()`, `invalidMoveTarget()`. Acceptance: each error returns the documented code + status from API Contract §2.3. The `linkAlreadyExists` and `cannotDeleteWithBackLinks` shapes include the `link` and `back_links_count` fields per §2.3.

- [ ] **T-3.3.** Create `app/api/nodes/[nodeId]/context-links/route.ts` with POST and GET handlers. POST implements §3.3 step-by-step including the source-category guard (step 6), target-category guard (step 8), cross-project guard (step 9), cross-document guard (step 10), and the lock checks (step 11). GET implements §3.5 with the closest-ancestor and direct-supersedes-inherited dedupe (invariants 9–10). Acceptance: TC-A-15..TC-A-22 and TC-A-26..TC-A-30 pass.

- [ ] **T-3.4.** Create `app/api/nodes/[nodeId]/context-links/[contextNodeId]/route.ts` with DELETE handler. Implements §3.4 step-by-step. Acceptance: TC-A-23..TC-A-25 pass.

- [ ] **T-3.5.** Create `app/api/nodes/[nodeId]/back-links/route.ts` with GET handler. Implements §3.6 step-by-step. The response shape per §2.15 includes the structural node's `document_name` — the data-layer wrapper joins to `documents.title` (or whatever the column is in V1; verify via `lib/types/database.ts`). Acceptance: TC-A-31 passes.

- [ ] **T-3.6.** Update `app/api/nodes/[nodeId]/route.ts` DELETE handler. Add the back-links check per §2.11 invariant 11: if the node is a context node and `?force=true` is NOT supplied and `countBackLinks() > 0`, return `409 cannot_delete_with_back_links` with the count. If `?force=true` is supplied, proceed (the FK cascade does the link deletion). Structural-node DELETE behaviour is unchanged. Acceptance: TC-A-33, TC-A-34, TC-A-35, TC-U-17, TC-U-18 pass.

- [ ] **T-3.7.** Update `app/api/nodes/[nodeId]/move/route.ts` to reject context-node sources at validation step 5 with `400 invalid_move_target`. The error code is added to the API Contract amendments list. Acceptance: TC-A-32 passes; existing Phase 2 move tests are unaffected.

- [ ] **T-3.8.** Confirm the existing PATCH `/api/nodes/[id]` handler works for context nodes without modification (Phase 3's `expected_version` and lock checks are category-agnostic). Acceptance: TC-A-36 passes.

### 3.4 Sidebar Context library UI

Authoritative spec: Component Spec §2.3; UI Design Spec §8.2.

- [ ] **T-4.1.** Update `components/layout/Sidebar.tsx`. The Phase 1 placeholder Context library section is replaced with the six-section live render. State: a map of `{ [type]: { isExpanded: boolean, nodes: ContextNode[] } }` driven by a single project-level fetch on mount (`GET /api/projects/<id>/context-nodes`). Persist `isExpanded` per type to `localStorage` key `stelavox_sidebar_context_expanded`. Acceptance: TC-U-01 passes; six section headers render alphabetically by label (matching the order Characters, Locations, Organisations, Plot Threads, Themes, Worlds — alphabetical by display label).

- [ ] **T-4.2.** Create `components/layout/SidebarContextSection.tsx`. Props: `{ type, label, nodes, onToggle, onCreateClick, onSelect }`. Renders the section header (chevron + label + count + `+` button on hover) and the rows. Each row uses `getContextIcon(type)` at 14px and the name at Inter 400 12px `--color-text-secondary`. Hover state per Component Spec §2.3. Acceptance: TC-V-01, TC-V-02, TC-V-03 pass.

- [ ] **T-4.3.** Wire the Sidebar's row-click handler. Selecting a context node sets the active node ID in the existing detail-panel store and invokes its `loadNode` flow — the same path a tree row uses. The detail panel renders the context-node body composition (no ProseEditor / WordCount / FocusModeButton). Acceptance: TC-U-06 passes.

### 3.5 ContextCreateModal + scope toggle

Authoritative spec: Component Spec §9.1 (Modal pattern); API Contract §3.1.

- [ ] **T-5.1.** Create `components/context/ContextCreateModal.tsx`. Props: `{ open, defaultType, projectId, onClose, onCreated }`. Layout: title ("New Character" / "New Location" / etc. — based on `defaultType`), close button, scope toggle (Project | Document), conditional document selector, name input (autofocused), short_description input, MetadataForm for the type, [Cancel] and [Create] buttons. On Create: POST to the API; on success, `onCreated(node)` is invoked and the modal closes. Validation errors render inline. Acceptance: TC-U-03, TC-U-04, TC-U-05 pass.

- [ ] **T-5.2.** Create `components/context/ScopeToggle.tsx`. Two-button toggle (`role="group"` with `role="radio"` children — `aria-pressed` per button). Default: Project selected. When Document is selected, the document selector becomes visible below it. Acceptance: TC-V-06, TC-U-04 pass.

- [ ] **T-5.3.** Create `components/context/DocumentSelector.tsx`. Dropdown listing the project's documents (via the existing `GET /api/projects/[id]/documents`). Single-select. Validation: required when scope is Document. Acceptance: form-level validation prevents submit with scope=Document and no document; selected document_id is included in the POST.

### 3.6 Detail-panel Context tab + ContextLinker + NodePicker

Authoritative spec: Component Spec §5.1, §5.2, §5.12; API Contract §3.5.

- [ ] **T-6.1.** Update `components/detail/TabStrip.tsx`. Activate the existing `Context` placeholder tab (currently "Coming in Phase 4" per Phase 3 v1.1's TabStrip update). The tab order remains Content · Comments · Agent · History · Context. A small badge on the Context tab shows the count of direct + inherited context links (suppressed when 0). Acceptance: TabStrip renders 5 tabs; Context tab now navigates to the ContextLinker.

- [ ] **T-6.2.** Create `components/detail/ContextTab.tsx`. Renders the `<ContextLinker />` component when active. Acceptance: clicking the Context tab renders the linker area; the previous placeholder is gone.

- [ ] **T-6.3.** Create `components/detail/ContextLinker.tsx` per Component Spec §5.12. Two sections:
  - **Linked context (direct):** array of rows, each with type icon + name + [Open] button + [Unlink] button (hover-revealed). `--color-bg-base`, `1px --color-border-subtle`, 4px radius.
  - **Inherited from ancestors (N):** collapsible (collapsed by default). Count badge from the API response. When expanded: same row layout but at 0.7 opacity with an "inherited" pill label and a tooltip-on-hover showing the source ancestor's name.
  - **[+ Link context node] button** at the bottom. Opens `<NodePicker />`.
  Reads via `GET /api/nodes/<id>/context-links`. Acceptance: TC-U-08, TC-U-13, TC-U-14, TC-U-15, TC-U-16, TC-V-04 pass.

- [ ] **T-6.4.** Create `components/detail/NodePicker.tsx`. Modal/dropdown panel (UI Spec line 397 modal pattern, but anchored — opens below the [+] trigger). Search input (autofocused) filters the list as the user types. List is the project's context nodes (via `GET /api/projects/<id>/context-nodes?document_id=<currentDoc>`) grouped by `node_type`, alphabetical within group. Already-linked entries render at 0.5 opacity and are non-clickable (per TC-V-05). Pressing Enter on the highlighted row creates the link via `POST /api/nodes/<id>/context-links`. Acceptance: TC-U-09, TC-U-10, TC-U-11, TC-U-12, TC-AX-02 pass.

- [ ] **T-6.5.** Wire the `ContextLinker` and `NodePicker` to the detail-panel state machine. Optimistic updates: linking a context node adds it to the direct list immediately; unlinking removes it; rollback on API error. Use a small Zustand slice or extend the existing detail-panel store. Acceptance: TC-U-11 / TC-U-16 transitions feel instant; rollback verified by mocking a 423 lock response and asserting the row reappears.

- [ ] **T-6.6.** Create `components/context/DeleteContextNodeModal.tsx`. Triggered from the detail panel's overflow menu when the active node is a context node. Fetches `GET /api/nodes/<id>/back-links` on open. Renders the back-links list and a [Delete and unlink everywhere] button that calls `DELETE /api/nodes/<id>?force=true`. Acceptance: TC-U-17, TC-U-18 pass.

### 3.7 MetadataForm extension for context types

Authoritative spec: Component Spec §5.1 (MetadataForm renders for both); `lib/context/metadata-schemas.ts`.

- [ ] **T-7.1.** Update `components/detail/MetadataForm.tsx` (Phase 3 implementation) to read its schema from `getMetadataSchema(node.node_type)` when `node.node_category === 'context'`. The form's existing field-rendering primitives (text, number, date, select, textarea) are unchanged — only the schema lookup branches. Acceptance: TC-U-07 passes; opening Elena renders the Character schema fields; opening a Location renders the Location schema.

- [ ] **T-7.2.** Add a metadata-schema test helper `tests/helpers/metadata-form.ts` exposing `expectFormFieldsForType(type, page)`. Used in TC-U-07 and per-type sub-cases. Acceptance: helper compiles; called from at least three TC-U cases.

### 3.8 Pre-merge — regression suite, cloud smoke, audit

These tasks come after §3.1–§3.7 and verify the build before merge. They are the equivalent of Phase 3's pre-merge group (build checklist §3.10 of that phase).

- [ ] **T-8.1.** Run the full Phase 4 test suite locally. Group runs (per the chunk-runs feedback memory): API + integrity + boundary; UI Sidebar + Modal + Picker; UI ContextLinker + Inheritance; visual + motion + accessibility. Each group must pass on its own. Acceptance: every TC-* in the test plan reports PASS; total verdict count matches the plan's case count.

- [ ] **T-8.2.** Run the Phase 3 regression suite. The Phase 3 tree CRUD + autosave + version-history tests must still pass — Phase 4's wrappers and routes did not modify the existing endpoints (other than the lawful `/move` rejection). Acceptance: full Phase 3 test report still PASSES.

- [ ] **T-8.3.** Phase B cloud smoke per Build Checklist §3.9 of Phase 3 (precedent). Temporarily swap `.env.local` to point at `stelavox-dev` (project `zhcdbofshifzblkgqrsc`); restart dev server; run the four-case cloud subset (TC-U-01, TC-U-08, TC-A-01, TC-A-15) with `--timeout=60000`; restore `.env.local` and restart on local. The user provides the service-role key when prompted. Acceptance: all four cases PASS against the cloud DB.

- [ ] **T-8.4.** Audit verdict count against test bodies. `grep -rE "test\('TC-[UVMABDX]+-[0-9]+" tests/ | wc -l` must equal the plan's case count. Mismatches mean either a missing test (write it) or an outdated count (update Test Plan + Test Report). This is the **direct corrective action** for the Phase 3 v1.5 audit-disclosure failure mode. Acceptance: count matches; no claimed-but-not-authored cases.

- [ ] **T-8.5.** Run the pre-merge invariants:
  - `npm run type-check` exit 0
  - `npm run lint` exit 0
  - `npm run build` exit 0
  - `diff CLAUDE.md docs/CLAUDE_stelavox_project.md` returns nothing
  - `git diff master -- lib/types/database.ts` is empty (no migrations this phase)
  Acceptance: all pass.

- [ ] **T-8.6.** Inviolable audit. Search the diff for `var(--color-accent)`, `#3d7858`, `#254a38`, `Cinzel`, `Cormorant`, `Lora` (in non-prose-editor files). Verify each match is a non-introduction (existing line). Acceptance: zero new verdigris uses; zero new Cinzel uses; no Lora outside prose files.

- [ ] **T-8.7.** Update CLAUDE.md and `docs/CLAUDE_stelavox_project.md` per the §6 SU items list below. If the SU items demand an upstream-spec bump (TA, Component Spec, Product Spec), that is part of this task. The two CLAUDE.md files must be byte-identical post-update. Acceptance: `diff` reports no differences; the new version's changelog entry is present.

- [ ] **T-8.8.** Author the Phase 4 Test Report at `docs/stelavox_phase4_test_report_v1_0.md`. Mirror Phase 3's report structure: §1 environment summary, §2 test execution log (chunked groups + cloud smoke), §3 iteration history (any case that failed during the build, with classification + root cause + fix + re-test), §4 verdict, §5 spec-update items raised, §6 hand-off note for Phase 5. Acceptance: every iteration during the build appears in §3 with a verdict; the verdict count matches T-8.4's grep count.

- [ ] **T-8.9.** Push the branch first, then merge. `git push origin claude/phase4-context`. Then a separate decision: `git -C C:/dev/stelavox_2 checkout master && git pull && git merge --no-ff claude/phase4-context -m "Merge Phase 4 — Context system complete (<count>/<count> active + 4/4 cloud smoke)" && git push origin master`. Match the Phase 1 / 2 / 3 merge style (per-commit history preserved via `--no-ff`). Acceptance: master is at the merge commit; the pushed master triggers Vercel preview rebuild.

- [ ] **T-8.10.** Update memory at the merge moment per the Phase / session start + shutdown procedure feedback memory. Add `project_phase4_progress.md` capturing: the merge SHA on master, verdict, spec versions at merge, deferred items with SU IDs, open SUs, the starting point for Phase 5. Update the prior `project_phase3_progress.md` index entry to note Phase 4 has shipped. Acceptance: memory file written; MEMORY.md index has the entry.

---

## 4. Test Pass Criteria

Delegated to the Phase 4 Test Plan (`stelavox_phase4_test_plan_v1_0.md` §9). The phase passes if and only if every test case in the plan passes (or is formally deferred), the Phase B cloud smoke passes, and the pre-merge invariants in T-8.5 all return clean.

The **verdict count** is the count of `test('TC-…')` blocks in `tests/` at merge time, not the planned 90. If a case is deferred during the build, it must be explicitly named in the Test Report's "Deferred" subsection (Phase 3 v1.5 set the precedent — this is the corrective for the audit-disclosure failure mode).

---

## 5. Hand-off Note for the Phase 4 Test Report

The Test Report (`stelavox_phase4_test_report_v1_0.md`) is authored by the agent that completes the build, on Opus per the model_selection advisory §5. It records:

- §1 — Environment as run (local Supabase ports, dev-server URL, Phase B target).
- §2 — Test execution log: which group runs, in what order, with results per group. The chunk pattern from Phase 3 v1.6 ("api+integrity+boundary; UI editors; UI focus-mode; visual; accessibility") is the recommended chunking for Phase 4 too, adapted to: api+integrity+boundary; UI Sidebar+Modal+Picker; UI ContextLinker+inheritance; visual+motion; accessibility; Phase 3 regression; Phase B cloud smoke.
- §3 — Iteration history. Every case that failed during the build, with classification (spec gap / spec error / impl gap / env), root cause (one paragraph), fix applied (the commit SHA), and re-test outcome.
- §4 — Verdict. `<count>/<count>` PASS or FAIL with details. Cloud smoke `<n>/<n>`.
- §5 — Spec-update items raised. Each SU candidate noted in the build (G-1 → DB-level CHECK constraint; G-2 → V2 metadata_schemas table; G-4 → V1 whitelist promotion to Product Spec; etc.) gets an entry. Categorise as upstream-spec-bump-now vs deferred-to-later-phase.
- §6 — Hand-off for Phase 5. The Agent System phase needs context-assembly to read context links (TA §2.4 architecture). The Phase 4 hand-off names the API endpoints Phase 5's `lib/llm/context-assembler.ts` will consume (`GET /api/nodes/<id>/context-links` for the calling node's context — direct + inherited).

---

## 6. SU items (open list — to be populated during the build)

Initial entries seeded from the API Contract §5 gaps:

- **SU-14 (G-1)** — Add a PostgreSQL CHECK constraint to enforce `nodes.scope` conditional NOT NULL at the DB layer. Migration target: post-Phase-4 close-out, before Phase 5 starts. TA v1.8 documents the constraint.
- **SU-15 (G-2)** — V2 introduces `metadata_schemas` config table (per organisation, per type) that supersedes the hardcoded V1 schemas in `lib/context/metadata-schemas.ts`. TA v2.0 documents the table.
- **SU-16 (G-4)** — Promote the V1 six-core context type whitelist into Product Spec §4.7 (currently lists names in prose; pin the underscored slugs `'character' | 'location' | 'organisation' | 'theme' | 'plot_thread' | 'world'`). Cross-reference TA H-12 to clarify the architectural-vs-operational distinction. Product Spec v1.4.
- **SU-17 (G-5)** — Phase 2 `/move` endpoint amendment: context-node sources rejected with `400 invalid_move_target`. Phase 2 API Contract gets a retroactive amendment row at merge time, same way Phase 3 amended the PATCH endpoint.

Additional SU items raised during the build will be appended here. The agent surfaces SU candidates as it works; the Test Report §5 absorbs them at the end of the phase.

---

## 7. Changelog

**v1.0 — 2026-05-04** Initial Phase 4 Build Checklist. Eight task groups (§3.1 schemas + types; §3.2 data layer; §3.3 API routes; §3.4 Sidebar UI; §3.5 ContextCreateModal; §3.6 Context tab + ContextLinker + NodePicker; §3.7 MetadataForm extension; §3.8 pre-merge). PB-1..PB-7 prerequisites unchanged from Phase 3 except for the master commit (`f849b7d`) and the spec versions at start (TA v1.7, Product Spec v1.3, Component Spec v2.5, CLAUDE.md v1.8). Four initial SU items seeded from API Contract gaps. Goal: deliver six core context types creatable from Sidebar + linkable from Context tab + inherited from ancestors, with all test cases in the test plan PASS and the four-case Phase B cloud smoke PASS.
