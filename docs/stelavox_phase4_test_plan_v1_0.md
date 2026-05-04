# Stelavox — Phase 4 Pre-Phase Test Plan
## Version 1.0

> **Tier-B per-phase document.** Written before any implementation. Derived from `stelavox_phase4_api_contract_v1_0.md` and the Phase 4 checkpoint criterion in `stelavox_technical_architecture_v1_7.md` §11. Executed at the end of Phase 4; results recorded in `stelavox_phase4_test_report_v1_0.md` (created during the build's pre-merge group).

**Phase:** 4 — Context System: context node CRUD, project- vs document-scope, structural↔context linking, per-type metadata schemas (six core context types), Sidebar context library, Detail-panel Context tab.
**Phase 4 checkpoint criteria (Technical Architecture v1.7 §11):** "Can create characters/locations; link them to scenes."
**Companion documents:** `stelavox_phase4_api_contract_v1_0.md`, `stelavox_phase4_build_checklist_v1_0.md`.

---

## 1. Test Environment

### 1.1 Where tests run

Phase 4 builds on the Phase 3 environment. Local Supabase stack started via `supabase start`; all 22 migrations applied (001–021 + 023; number 022 intentionally skipped per TA v1.7 §3.5); seed loaded; Next.js dev server on `http://localhost:3000`. The Phase 4 worktree shifts ports +10 the same way Phase 1 / 2 / 3 worktrees did.

A second smoke run is performed against cloud `stelavox-dev` (Phase B) before merge — same migrations, same seed, plus a Phase 4-specific subset: TC-U-01 (Sidebar library renders), TC-U-08 (link a context node from the Context tab), TC-A-01 (POST creates a project-scoped character), TC-A-15 (POST link succeeds with both endpoints valid).

### 1.2 Test users

Three test users created via `supabase.auth.signUp` at the start of the run, identical to Phase 1 / 2 / 3:

| Handle | Email | Password | Display name |
|---|---|---|---|
| **User A** | `test-a@example.com` | `Test1234!Test1234!` | `Author A` |
| **User B** | `test-b@example.com` | `Test1234!Test1234!` | `Author B` |
| **User C** | `test-c@example.com` | `Test1234!Test1234!` | `Author C` |

Test users are deleted between full runs by truncating `auth.users` (cascades). `supabase db reset` is acceptable in Phase A.

### 1.3 Test data

Pre-loaded by the seed (unchanged from Phase 3):
- Three layer-stack templates (Novel, Short Story, Series).
- All 41 keys in `platform_config`.
- One `director_configs` row with `status = 'production'`.

Phase 4 does not add seed rows. Every project, document, structural node, context node, and link used in tests is created during the run via the Phase 1 / 2 / 3 / 4 endpoints (or via service-role fixtures for performance).

### 1.4 Tooling

Same as Phase 3 (Vitest / Playwright API-mode for API tests, Playwright headed for UI checkpoints, service-role client only in test setup/teardown). New for Phase 4:

- **Context-node fixtures:** helper `tests/helpers/context-fixtures.ts` exposes `createCharacter(opts)`, `createLocation(opts)`, etc. — thin wrappers around the new POST that default `scope='project'` and a minimal `metadata` payload. Used to seed test trees rapidly.
- **Link fixtures:** helper `tests/helpers/link-fixtures.ts` exposes `linkContext(structuralId, contextId)` and `expectLinked(structuralId, contextId)` — the latter polls the GET endpoint until the link appears (or times out at 2s).
- **Inheritance scenario builder:** helper `tests/helpers/inheritance-scenario.ts` exposes `buildInheritanceTree(spec)` — given a JSON spec like `{ "Book": { "links": ["elena"], "Chapter1": { "Scene1": {} } } }`, creates a structural tree plus context nodes plus links so inherited-link tests can be authored declaratively.
- **MetadataForm assertion helper:** `tests/helpers/metadata-form.ts` exposes `expectFormFieldsForType(type, page)` — verifies the rendered form shape against the V1 schema for a given `node_type`.

### 1.5 Mocking

No external services mocked. The LLM abstraction layer is not exercised in Phase 4 (agent operations arrive Phase 5). Tiptap is loaded as a real npm dependency; tests do not mock the editor (the Summary and Notes editors on a context node use the same Tiptap setup as on a structural node).

### 1.6 Independence

Test cases are independent. Where a test requires a context-link precondition ("User A has a project with Elena and Chapter 3 linked"), the test's setup creates that state via the API (or via service-role for performance) and tears it down in `afterEach`. No test reads state another test modifies.

### 1.7 Notation

- **TC-U-NN** — UI checkpoint test (Section 2). Verifies the visible behaviour of the Sidebar library, Context tab, ContextLinker, NodePicker, MetadataForm, and ContextCreateModal.
- **TC-V-NN** — Visual / styling test (Section 3). Verifies type icons, inherited-tint opacities, sidebar item layout.
- **TC-M-NN** — Motion / transition test (Section 4). Verifies modal entry/exit timing, picker dropdown 200ms, `prefers-reduced-motion` honour.
- **TC-A-NN** — API integration test (Section 5). POST/GET context nodes, POST/DELETE/GET links, back-links, pagination, filters.
- **TC-B-NN** — Authorisation boundary test (Section 6). RLS on context nodes and links, cross-org rejection.
- **TC-D-NN** — Data integrity test (Section 7). UNIQUE constraints, cascade delete, scope/document_id consistency, V1 whitelist, immutability.
- **TC-AX-NN** — Accessibility test (Section 8). Keyboard-only flows through Picker and Modal, ARIA, screen-reader announcements.
- **Verdict:** `PASS` if actual matches expected exactly. `FAIL` otherwise; the Test Report classifies the cause.

---

## 2. Section 1 — UI Checkpoint Tests

These verify the Phase 4 checkpoint from a user's perspective: "Can create characters/locations; link them to scenes."

### TC-U-01 — Sidebar Context library renders six type sections
**Spec:** Component Spec §2.3 (Sidebar — Context library); API Contract §3.2.
**Setup:** User A signed in; project with no context nodes.
**Procedure:** Open project. Inspect the Sidebar's Context library section.
**Expected:** Six collapsible sections in order: Characters, Locations, Organisations, Themes, Plot Threads, Worlds. Each shows its plural label, count `(0)` in `--color-text-muted`, and a `+` icon button on hover. All sections collapsed by default.

### TC-U-02 — Sidebar lists context nodes alphabetically within a type
**Spec:** API Contract §2.8 (ordering).
**Setup:** Three characters seeded: "Charlie", "Alice", "Bob" (creation order).
**Procedure:** Expand Characters section.
**Expected:** Three rows in alphabetical order: Alice, Bob, Charlie. Each row: 14px type icon (`--color-text-muted`) + name (Inter 400 12px `--color-text-secondary`).

### TC-U-03 — Sidebar [+] opens ContextCreateModal pre-set to that type
**Spec:** Component Spec §2.3; the modal spec is in §3.6 (TabStrip Context tab) cross-referenced by §5.1.
**Setup:** Sidebar open.
**Procedure:** Hover Locations section header → click `+`.
**Expected:** Modal opens. Type field reads "Location" (locked — type is fixed by the entry path; user cannot change it without closing and using a different `+`). Name input is autofocused. Scope toggle defaults to "Project". MetadataForm rendered for the Location schema.

### TC-U-04 — ContextCreateModal scope toggle switches between Project and Document
**Spec:** API Contract §2.5 (scope field); Component Spec §2.3.
**Setup:** Modal open from TC-U-03.
**Procedure:** Click "Document" toggle. A document selector appears.
**Expected:** Scope toggle visually switches; document selector is a dropdown listing the project's documents (from GET `/api/projects/[id]/documents`); placeholder reads "Select document". Submitting without a document selected → form-level validation error "Please select a document."

### TC-U-05 — ContextCreateModal submit creates a project-scoped character
**Spec:** API Contract §3.1.
**Setup:** Modal opened to Characters → fill `name = "Elena Vasquez"`, role = "protagonist" (metadata field), age = 42, leave scope = Project.
**Procedure:** Click `Create`.
**Expected:** Modal closes. Sidebar Characters section count increments to (1) and expands; new "Elena Vasquez" row appears. POST returned 201; Network log shows one POST to `/api/projects/<id>/context-nodes` with `scope: "project"`, `node_type: "character"`, `metadata: { role: "protagonist", age: 42, ... }`.

### TC-U-06 — Selecting a context node in the Sidebar opens the detail panel
**Spec:** Component Spec §5.1 (NodeDetailPanel — context-node body composition).
**Setup:** Continuation of TC-U-05.
**Procedure:** Click "Elena Vasquez" in the Sidebar.
**Expected:** Detail panel opens. Header shows "Elena Vasquez" with a Character icon. Tab strip shows Content · Comments · Agent · History · Context (same five tabs as a structural node). Content tab body: SummaryEditor (Inter, empty), MetadataForm (Character schema with role/age/want/fear pre-filled), NotesEditor (Inter, empty). **No ProseEditor**, **no FocusModeButton**, **no WordCount** — context nodes are non-leaf-equivalent (`is_leaf=false` always).

### TC-U-07 — MetadataForm renders the Character schema
**Spec:** API Contract G-2; `lib/context/metadata-schemas.ts`.
**Setup:** Continuation of TC-U-06.
**Procedure:** Inspect the MetadataForm's rendered fields.
**Expected:** Fields in order: Role (select: protagonist/antagonist/supporting/minor), Age (number), Want (text), Fear (text), Voice (textarea). Each labelled in Inter 500 12px `--color-text-secondary`; inputs styled per Phase 3 metadata form conventions. Pre-filled with whatever was submitted in TC-U-05.

### TC-U-08 — Context tab on a structural node lists linked context nodes
**Spec:** Component Spec §5.12 (ContextLinker); API Contract §3.5.
**Setup:** Project with Elena (project-scoped). Document with Chapter 3 (no scenes yet, but linkable). Service-role inserts a row in `node_context_links(source=Chapter3, target=Elena)`.
**Procedure:** Click Chapter 3 in the tree → Detail panel opens → click `Context` tab.
**Expected:** Direct list shows one row: Elena's Character icon + "Elena Vasquez" + [Open] button. `--color-bg-base` background, `1px --color-border-subtle` border, 4px radius. Inherited section: collapsed by default with badge "Inherited from ancestors (0)" — Chapter 3 has no ancestors with links in this scenario.

### TC-U-09 — [+ Link context node] opens NodePicker filtered to context
**Spec:** Component Spec §5.12; API Contract §3.2.
**Setup:** Continuation of TC-U-08.
**Procedure:** Click `+ Link context node`.
**Expected:** NodePicker opens (modal/dropdown — UI Spec line 397 modal panel pattern). Search input autofocused. Default list shows the project's context nodes grouped by type, alphabetical. Already-linked entries (Elena) appear with a checkmark and are disabled. Each entry: type icon + name + (project|document) scope label.

### TC-U-10 — NodePicker filters as the user types
**Spec:** Component Spec §3.3 (CommandPalette pattern reused).
**Setup:** Project with characters Elena, Marcus; locations Tower, Harbour. Picker open.
**Procedure:** Type "Mar".
**Expected:** Filter narrows to "Marcus" (Character) and any other names starting with "Mar"; non-matches hidden. Type-group headings remain visible only for groups with matches.

### TC-U-11 — Picker selection creates the link
**Spec:** API Contract §3.3.
**Setup:** Picker filtered to Marcus.
**Procedure:** Click "Marcus" or press Enter.
**Expected:** POST `/api/nodes/<chapter3>/context-links` issued with body `{ context_node_id: "<marcus>" }`. 201 response. Picker closes. Direct list now shows two rows (Elena, Marcus). Network log confirms.

### TC-U-12 — Linking the same node twice surfaces the existing-link 409
**Spec:** API Contract §2.3 (`link_already_exists`); §3.3.
**Setup:** Picker open on Chapter 3 with Elena already linked.
**Procedure:** Attempt to click Elena (it should be disabled). If the disabled state is bypassed (force-click), the POST returns 409.
**Expected:** Picker UI: Elena's entry is visually disabled (opacity 0.5) and the row is non-clickable. Force-click via API returns 409 with `link.id = <existing link id>`. The UI's disabled-state prevents this in normal usage.

### TC-U-13 — Inherited links surface from ancestors
**Spec:** API Contract §2.14, §3.5; Component Spec §5.12 ("Inherited from ancestors (4)").
**Setup:** Project with Elena (project-scoped). Document with Book → Act 1 → Chapter 3 → Scene 1. Elena linked to Book.
**Procedure:** Open Detail panel for Scene 1 → Context tab.
**Expected:** Direct list: empty. Inherited section: badge "Inherited from ancestors (1)". Collapsed by default. On expand: one row showing Elena at 0.7 opacity with an "inherited" pill label. Hovering the pill shows tooltip "From: Book".

### TC-U-14 — Closest ancestor wins for duplicated inheritance
**Spec:** API Contract §2.11 invariant 9, G-3a; §3.5.
**Setup:** Document with Book → Act 1 → Chapter 3. Elena linked to BOTH Book AND Chapter 3 (direct).
**Procedure:** Open Detail panel for Scene 1 (a child of Chapter 3) → Context tab.
**Expected:** Inherited section shows ONE row for Elena (not two). The hover tooltip reads "From: Chapter 3" (not "From: Book"). The depth-3 ancestor's link wins.

### TC-U-15 — Direct link suppresses the inherited entry
**Spec:** API Contract §2.11 invariant 10; §3.5.
**Setup:** Document with Book → Chapter 3. Elena linked to Book. Then Elena directly linked to Chapter 3 too.
**Procedure:** Open Detail panel for Chapter 3 → Context tab.
**Expected:** Direct list: one row for Elena. Inherited section: badge reads "Inherited from ancestors (0)". The Book→Elena link is not surfaced as inherited on Chapter 3 (that would be redundant; Chapter 3 already has the direct link).

### TC-U-16 — Unlink removes the link from the direct list
**Spec:** API Contract §3.4; Component Spec §5.12.
**Setup:** Chapter 3 with Elena and Marcus directly linked.
**Procedure:** Hover the Elena row → click the [Unlink] button (or the trailing × icon per Component Spec §5.12 hover affordance).
**Expected:** Confirmation toast "Unlinked Elena Vasquez from Chapter 3" with [Undo] for 5s. DELETE issued. Direct list now shows only Marcus. Sidebar's character count is unchanged (the context node still exists; only the link is gone).

### TC-U-17 — Delete a context node with active back-links shows confirmation
**Spec:** API Contract §3.4 + DELETE `/api/nodes/[id]` with `?force=true` semantics from §2.3.
**Setup:** Elena linked to two structural nodes (Chapter 3, Chapter 5).
**Procedure:** Open Detail panel for Elena → click [Delete] in the panel header overflow menu → confirmation modal opens.
**Expected:** Modal title "Delete Elena Vasquez?". Body text: "This character is linked from 2 structural nodes:" followed by a list (Chapter 3 in The Northern Light; Chapter 5 in The Northern Light) — the list comes from GET `/api/nodes/<elena>/back-links`. Two buttons: [Cancel] (returns), [Delete and unlink everywhere] (calls DELETE `/api/nodes/<elena>?force=true`).

### TC-U-18 — Confirming the delete cascades the links
**Spec:** API Contract §2.3 `cannot_delete_with_back_links` + `?force=true`.
**Setup:** Continuation of TC-U-17.
**Procedure:** Click [Delete and unlink everywhere].
**Expected:** DELETE with `?force=true` returns 200. Modal closes. Sidebar Characters count decrements by 1; Elena row is gone. Open Chapter 3's Context tab: direct list shows no Elena (the link was cascaded via FK ON DELETE CASCADE). Open Chapter 5's Context tab: same.

### TC-U-19 — Document-scoped context only appears in its own document's view
**Spec:** API Contract §2.11 invariant 5–6; §3.2 G-3.
**Setup:** Project with two documents: "Doc A" and "Doc B". Create a Location named "Atrium" with `scope='document'`, `document_id=DocA`.
**Procedure:** Switch to Doc B in the project. Open the Sidebar's Context library OR open a Picker on a Doc B structural node.
**Expected:** "Atrium" does NOT appear in Doc B's lists. Switch back to Doc A: "Atrium" appears under Locations.

### TC-U-20 — Project-scoped context appears in every document's view
**Spec:** API Contract §2.11 invariant 6; Product Spec §4.7 row 3.
**Setup:** Project with Doc A and Doc B. Create Elena with `scope='project'`.
**Procedure:** Open Picker on a Doc A scene; observe Elena listed. Switch to Doc B; open Picker on a Doc B scene; observe Elena listed.
**Expected:** Elena appears in both documents' Picker lists. Linking from Doc B succeeds (TC-A-15).

### TC-U-21 — Cross-document linking of a document-scoped context node fails
**Spec:** API Contract §2.11 invariant 5; §3.3 step 10.
**Setup:** "Atrium" with `scope='document'`, `document_id=DocA`. Try to link from a Doc B structural node.
**Procedure:** Force the POST via API (the UI prevents this — Atrium isn't in Doc B's Picker).
**Expected:** POST returns `400 link_cross_document`. UI: the Atrium row is not in Doc B's Picker at all (TC-U-19 covers the UI suppression).

### TC-U-22 — PATCH a context node updates name, summary, notes, metadata
**Spec:** Phase 2 PATCH semantics carried forward; Phase 3 `expected_version` carried forward.
**Setup:** Elena (`version=1`) open in detail panel.
**Procedure:** Edit the SummaryEditor → wait 1.5s for autosave.
**Expected:** PATCH issued to `/api/nodes/<elena>` with `summary` and `expected_version=1`. Response 200 with `version=2`. Local `expected_version` updates. (Phase 3's optimistic-concurrency contract is unchanged for context nodes.)

---

## 3. Section 2 — Visual / Styling Tests

### TC-V-01 — Sidebar type icons render at 14px in `--color-text-muted`
**Spec:** Component Spec §2.3.
**Setup:** Sidebar with characters, locations, themes seeded.
**Procedure:** Inspect each row's icon element via `getComputedStyle`.
**Expected:** Width and height = 14px. Stroke colour resolves to `--color-text-muted`. Lucide icon set used (`User` for Character, `MapPin` for Location, `Building2` for Organisation, `Sparkles` for Theme, `GitBranch` for Plot Thread, `Globe` for World).

### TC-V-02 — Sidebar item name is Inter 400 12px secondary
**Spec:** Component Spec §2.3.
**Setup:** Sidebar with one character.
**Procedure:** Inspect name element via `getComputedStyle`.
**Expected:** font-family resolves to a stack starting with Inter; font-weight 400; font-size 12px; color resolves to `--color-text-secondary`.

### TC-V-03 — Sidebar item hover state
**Spec:** Component Spec §2.3.
**Setup:** Sidebar with one character.
**Procedure:** Hover the row (Playwright `hover()`).
**Expected:** `background-color` resolves to `--color-bg-hover`; name `color` resolves to `--color-text-primary`.

### TC-V-04 — Inherited link entry renders at 0.7 opacity with "inherited" pill
**Spec:** Component Spec §5.12 ("Inherited from ancestors (4)" — 0.7 opacity rule).
**Setup:** Inherited-scenario tree from `tests/helpers/inheritance-scenario.ts`.
**Procedure:** Open Context tab on a leaf; expand inherited section; inspect each entry.
**Expected:** Each row's `opacity` resolves to 0.7. A "inherited" pill renders next to the name, Inter 300 10px `--color-text-muted`, `1px --color-border-subtle`, 4px radius.

### TC-V-05 — Already-linked entries in the Picker render at 0.5 opacity
**Spec:** Component Spec §5.12 + Picker affordance.
**Setup:** Chapter 3 with Elena already linked. Picker open.
**Procedure:** Inspect Elena's row in the Picker.
**Expected:** `opacity` resolves to 0.5. `pointer-events` resolves to `none`. A checkmark icon (Lucide `Check`) renders next to the name in `--color-accent` … **but wait — verdigris is one of the Five Inviolables enumerated uses (nine sanctioned).** The checkmark must NOT use `--color-accent`. Use `--color-text-muted`.

### TC-V-06 — ContextCreateModal "Project" toggle is selected by default
**Spec:** API Contract §3.1.
**Setup:** Modal open from Sidebar [+].
**Procedure:** Inspect the scope toggle's selected state.
**Expected:** The Project toggle has `aria-pressed="true"` and `--color-bg-elevated` background; the Document toggle has `aria-pressed="false"` and transparent background.

---

## 4. Section 3 — Motion / Transition Tests

### TC-M-01 — ContextCreateModal entry is `--duration-normal --easing-default`
**Spec:** Component Spec §9.1 (Modal pattern); UI Spec line 200 (modal entrance).
**Setup:** Sidebar Characters [+] hovered.
**Procedure:** Click [+]. Capture animation timing via Playwright's `page.evaluate(() => performance.now())`.
**Expected:** Modal panel opacity transitions 0 → 1 over `--duration-normal` (180ms ±50ms tolerance). Translate `translateY(-8px) → translateY(0)` over the same window.

### TC-M-02 — NodePicker dropdown 200ms entrance
**Spec:** Component Spec §3.3 (CommandPalette pattern reused).
**Setup:** Context tab open with [+ Link context node] visible.
**Procedure:** Click [+ Link context node]. Capture timing.
**Expected:** Picker panel `opacity 0 + translateY(-8px) → opacity 1 + translateY(0)` over 200ms ±50ms.

### TC-M-03 — Modal honours `prefers-reduced-motion`
**Spec:** Component Spec §15.5 (Reduced Motion baseline); Brand Identity v2.0 §7.
**Setup:** Reduced-motion fixture from `tests/helpers/motion.ts`.
**Procedure:** With reduced-motion emulated, click Sidebar [+].
**Expected:** Modal renders at full opacity instantly (animation duration 0ms).

### TC-M-04 — Sidebar section collapse animation
**Spec:** Component Spec §2.3 (collapsible sections — width transition).
**Setup:** Sidebar with Characters expanded.
**Procedure:** Click the Characters section header.
**Expected:** Section collapses with `--duration-fast --easing-smooth` height animation. The chevron rotates 90° in the same duration.

---

## 5. Section 4 — API Integration Tests

### TC-A-01 — POST creates a project-scoped character
**Spec:** API Contract §3.1.
**Setup:** User A signed in; project P1.
**Procedure:** POST `/api/projects/<P1>/context-nodes` with `{ scope: "project", node_type: "character", name: "Elena", metadata: { role: "protagonist" } }`.
**Expected:** 201 with full context-node body per §2.12. `id` is a UUID; `node_category="context"`; `scope="project"`; `document_id=null`; `parent_id=null`; `is_leaf=false`; `metadata.role="protagonist"`; `version=1`.

### TC-A-02 — POST creates a document-scoped location
**Spec:** API Contract §3.1.
**Setup:** Project P1 with Document D1.
**Procedure:** POST with `{ scope: "document", document_id: "<D1>", node_type: "location", name: "The North Tower" }`.
**Expected:** 201; `scope="document"`; `document_id="<D1>"`; `node_type="location"`.

### TC-A-03 — POST rejects scope='document' without document_id
**Spec:** API Contract §3.1 step 10.
**Setup:** Same as TC-A-01.
**Procedure:** POST with `{ scope: "document", node_type: "character", name: "X" }` (no `document_id`).
**Expected:** 400 `scope_document_mismatch`.

### TC-A-04 — POST rejects scope='project' with document_id present
**Spec:** API Contract §3.1 step 10.
**Setup:** Same.
**Procedure:** POST with `{ scope: "project", document_id: "<D1>", node_type: "character", name: "X" }`.
**Expected:** 400 `scope_document_mismatch`.

### TC-A-05 — POST rejects unknown node_type
**Spec:** API Contract §3.1 step 7; G-4.
**Setup:** Same.
**Procedure:** POST with `{ scope: "project", node_type: "evidence", name: "X" }`. ("evidence" is in the 30+ extended list, not the V1 six-core.)
**Expected:** 400 `invalid_node_type`.

### TC-A-06 — POST rejects empty name
**Spec:** API Contract §2.5 (name required).
**Setup:** Same.
**Procedure:** POST with `{ scope: "project", node_type: "character", name: "  " }` (whitespace).
**Expected:** 400 `invalid_name`.

### TC-A-07 — POST rejects unknown field
**Spec:** API Contract §2.5 (Phase 2 forbidden-fields).
**Setup:** Same.
**Procedure:** POST with `{ scope: "project", node_type: "character", name: "Elena", parent_id: "<some uuid>" }`.
**Expected:** 400 `unknown_field`.

### TC-A-08 — POST rejects mismatched document
**Spec:** API Contract §3.1 step 12.
**Setup:** Project P1 and Project P2 (same org). Document D2 in P2.
**Procedure:** POST to `/api/projects/<P1>/context-nodes` with `scope: "document", document_id: "<D2>"`.
**Expected:** 400 `document_not_in_project`.

### TC-A-09 — POST returns 404 for non-existent project
**Spec:** API Contract §3.1 step 11.
**Setup:** Random UUID for projectId.
**Procedure:** POST.
**Expected:** 404 `project_not_found`.

### TC-A-10 — GET lists project + document scope by default
**Spec:** API Contract §3.2 G-3b.
**Setup:** Project P1 with Doc D1. Three characters: Alice (project), Bob (project), Carla (document, D1).
**Procedure:** GET `/api/projects/<P1>/context-nodes`.
**Expected:** 200 with `context_nodes` array containing all three. Sort: type ASC, name ASC → Alice, Bob, Carla (all 'character').

### TC-A-11 — GET filters by scope=project
**Spec:** API Contract §3.2.
**Setup:** Same as TC-A-10.
**Procedure:** GET `/api/projects/<P1>/context-nodes?scope=project`.
**Expected:** 200 with two rows (Alice, Bob). `total: 2`.

### TC-A-12 — GET filters by document_id
**Spec:** API Contract §3.2 G-3b.
**Setup:** Project P1 with Doc D1 (Carla document-scoped) and Doc D2 (Diana document-scoped). Plus Alice + Bob project-scoped.
**Procedure:** GET `/api/projects/<P1>/context-nodes?document_id=<D1>`.
**Expected:** 200 with three rows (Alice, Bob, Carla) — D1's document-scoped + project-scoped. Diana excluded.

### TC-A-13 — GET filters by node_type
**Spec:** API Contract §3.2.
**Setup:** Two characters and one location in P1.
**Procedure:** GET `?node_type=location`.
**Expected:** 200 with one row (the location). `total: 1`.

### TC-A-14 — GET paginates
**Spec:** API Contract §2.8.
**Setup:** 150 characters in P1 (service-role bulk insert).
**Procedure:** GET `?limit=50&offset=0`. Then GET `?limit=50&offset=50`.
**Expected:** First call: 50 rows, `total: 150`, `has_more: true`. Second call: 50 more rows (offset 50–99), `has_more: true`.

### TC-A-15 — POST link from structural to context succeeds
**Spec:** API Contract §3.3.
**Setup:** P1 with Elena (project), Doc D1 with Chapter 3.
**Procedure:** POST `/api/nodes/<chapter3>/context-links` with `{ context_node_id: "<elena>" }`.
**Expected:** 201 with link object per §2.13. `link_type="structural_to_context"`; `source_node_id=<chapter3>`; `target_node_id=<elena>`.

### TC-A-16 — POST link rejects context source
**Spec:** API Contract §3.3 step 6; invariant 4.
**Setup:** Two characters Elena, Marcus.
**Procedure:** POST `/api/nodes/<elena>/context-links` with `{ context_node_id: "<marcus>" }`.
**Expected:** 400 `invalid_link_source`.

### TC-A-17 — POST link rejects structural target
**Spec:** API Contract §3.3 step 8.
**Setup:** Chapter 3 and Chapter 4.
**Procedure:** POST `/api/nodes/<chapter3>/context-links` with `{ context_node_id: "<chapter4>" }`.
**Expected:** 400 `invalid_link_target`.

### TC-A-18 — POST link rejects cross-project pair
**Spec:** API Contract §3.3 step 9.
**Setup:** Project P1 with Elena. Project P2 (same org) with Chapter 3.
**Procedure:** POST `/api/nodes/<P2-chapter3>/context-links` with `{ context_node_id: "<P1-elena>" }`.
**Expected:** 400 `link_cross_project`.

### TC-A-19 — POST link rejects cross-document for document-scoped target
**Spec:** API Contract §3.3 step 10.
**Setup:** Project P1 with Doc D1 (Atrium location, scope=document) and Doc D2 (Chapter 3).
**Procedure:** POST `/api/nodes/<D2-chapter3>/context-links` with `{ context_node_id: "<atrium>" }`.
**Expected:** 400 `link_cross_document`.

### TC-A-20 — POST duplicate link returns 409 with existing link
**Spec:** API Contract §2.3 `link_already_exists`; §3.3 step 12.
**Setup:** Chapter 3 already linked to Elena.
**Procedure:** POST again with the same body.
**Expected:** 409 `link_already_exists` with `link.id` matching the existing row.

### TC-A-21 — POST link blocked by source lock
**Spec:** API Contract §3.3 step 11; H-related lock semantics.
**Setup:** Chapter 3 with `locked=TRUE` (set via service role).
**Procedure:** POST link.
**Expected:** 423 `node_locked`.

### TC-A-22 — POST link blocked by ancestor lock
**Spec:** API Contract §3.3 step 11.
**Setup:** Book locked. Chapter 3 child of Book, not locked itself.
**Procedure:** POST link Chapter 3 → Elena.
**Expected:** 423 `parent_locked`.

### TC-A-23 — DELETE link removes the row
**Spec:** API Contract §3.4.
**Setup:** Chapter 3 ↔ Elena linked.
**Procedure:** DELETE `/api/nodes/<chapter3>/context-links/<elena>`.
**Expected:** 200 `{ deleted: true, source_node_id, target_node_id }`. Subsequent GET shows the link is gone.

### TC-A-24 — DELETE non-existent link returns 404
**Spec:** API Contract §3.4 step 6.
**Setup:** Chapter 3 not linked to Elena.
**Procedure:** DELETE.
**Expected:** 404 `link_not_found`.

### TC-A-25 — DELETE blocked by source lock
**Spec:** API Contract §3.4 step 5.
**Setup:** Chapter 3 ↔ Elena linked. Chapter 3 locked.
**Procedure:** DELETE.
**Expected:** 423 `node_locked`. Link not removed.

### TC-A-26 — GET links lists direct entries
**Spec:** API Contract §3.5; §2.14.
**Setup:** Chapter 3 directly linked to Elena and Marcus.
**Procedure:** GET `/api/nodes/<chapter3>/context-links`.
**Expected:** 200 with `direct: [{ link, context_node }, { link, context_node }]` ordered by `created_at` ASC. `inherited: []`.

### TC-A-27 — GET links includes inherited entries from ancestors
**Spec:** API Contract §3.5; §2.14.
**Setup:** Book → Chapter 3 → Scene 1. Elena linked to Book directly. Scene 1 has no direct links.
**Procedure:** GET `/api/nodes/<scene1>/context-links`.
**Expected:** `direct: []`. `inherited: [{ link: <book-elena>, context_node: <elena>, inherited_from: { id: <book>, name: "Book", node_type: "book", depth: 0 } }]`.

### TC-A-28 — GET links: closest ancestor wins on duplication
**Spec:** API Contract §2.11 invariant 9; §3.5.
**Setup:** Elena linked to BOTH Book AND Chapter 3 (direct). Inspect Scene 1.
**Procedure:** GET `/api/nodes/<scene1>/context-links`.
**Expected:** `inherited` has ONE entry for Elena. `inherited_from.id = <chapter3>` (depth 2), not `<book>` (depth 0). The Book→Elena link is suppressed in this response.

### TC-A-29 — GET links: direct supersedes inherited
**Spec:** API Contract §2.11 invariant 10; §3.5.
**Setup:** Elena linked to Book (direct on Book) AND Chapter 3 (direct). Inspect Chapter 3.
**Procedure:** GET `/api/nodes/<chapter3>/context-links`.
**Expected:** `direct` has Elena. `inherited` is empty for Elena (Book→Elena does not appear as inherited on Chapter 3).

### TC-A-30 — GET links rejects context-node sources
**Spec:** API Contract §3.5 step 3.
**Setup:** Elena (context).
**Procedure:** GET `/api/nodes/<elena>/context-links`.
**Expected:** 400 `invalid_link_source`.

### TC-A-31 — GET back-links lists structural sources
**Spec:** API Contract §3.6.
**Setup:** Elena linked from Chapter 3 in Doc D1 and Chapter 5 in Doc D2.
**Procedure:** GET `/api/nodes/<elena>/back-links`.
**Expected:** 200 with two `back_links` rows. Ordered by document_name then depth then name. `total: 2`.

### TC-A-32 — Move on a context node returns 400
**Spec:** API Contract §2.5 G-5; Phase 2 `/move` endpoint amendment.
**Setup:** Elena.
**Procedure:** POST `/api/nodes/<elena>/move` with any valid body.
**Expected:** 400 `invalid_move_target`.

### TC-A-33 — DELETE context node with back-links returns 409 by default
**Spec:** API Contract §2.3 `cannot_delete_with_back_links`; §2.11 invariant 11.
**Setup:** Elena linked from Chapter 3 and Chapter 5.
**Procedure:** DELETE `/api/nodes/<elena>` (no `?force`).
**Expected:** 409 `cannot_delete_with_back_links` with `back_links_count: 2`. Elena still exists.

### TC-A-34 — DELETE with `?force=true` cascades
**Spec:** API Contract §2.11 invariant 11.
**Setup:** Same as TC-A-33.
**Procedure:** DELETE `/api/nodes/<elena>?force=true`.
**Expected:** 200. Elena is gone. Both link rows are gone (FK cascade).

### TC-A-35 — DELETE context node with no back-links succeeds without force
**Spec:** API Contract §2.11 invariant 11.
**Setup:** Lonely Elena (no links).
**Procedure:** DELETE `/api/nodes/<elena>`.
**Expected:** 200. Elena gone.

### TC-A-36 — PATCH context node updates content fields with `expected_version`
**Spec:** Phase 3 §3.1 carried forward.
**Setup:** Elena `version=1`.
**Procedure:** PATCH `/api/nodes/<elena>` with `{ summary: "...", expected_version: 1 }`.
**Expected:** 200 with `version=2`. (Phase 3's optimistic-concurrency contract works on context nodes identically.)

---

## 6. Section 5 — Authorisation Boundary Tests

### TC-B-01 — User B cannot read User A's context nodes
**Spec:** RLS policy `org_members_access_nodes` (Migration 002 carry-forward via Migration 003).
**Setup:** User A creates Project P1 with Elena. User B is in a different organisation.
**Procedure:** Sign in as User B → GET `/api/projects/<P1>/context-nodes`.
**Expected:** 404 `project_not_found` (existence concealment per Phase 1 §2.2).

### TC-B-02 — User B cannot create a context node in User A's project
**Spec:** RLS on `nodes` INSERT.
**Setup:** Same.
**Procedure:** Sign in as B → POST `/api/projects/<P1>/context-nodes` with valid body.
**Expected:** 404 `project_not_found`.

### TC-B-03 — User B cannot link to User A's structural node
**Spec:** RLS on both `nodes` and `node_context_links`.
**Setup:** P1 has Chapter 3. P1 has Elena. User B has separate project.
**Procedure:** Sign in as B → POST `/api/nodes/<P1-chapter3>/context-links` with `{ context_node_id: "<P1-elena>" }`.
**Expected:** 404 `not_found` (the source node is hidden by RLS; the route returns 404 before checking the target).

### TC-B-04 — Same-organisation different-project linking is rejected
**Spec:** API Contract §3.3 step 9 (`link_cross_project`).
**Setup:** User A has Projects P1 and P2 (same organisation). Elena in P1; Chapter 3 in P2.
**Procedure:** POST `/api/nodes/<P2-chapter3>/context-links` with `{ context_node_id: "<P1-elena>" }`.
**Expected:** 400 `link_cross_project`. Both nodes are visible to A; the route's same-project guard catches this.

### TC-B-05 — User B cannot DELETE User A's link
**Spec:** RLS on `node_context_links`.
**Setup:** A has Chapter 3 ↔ Elena. B is in another org.
**Procedure:** Sign in as B → DELETE the link.
**Expected:** 404 `not_found`.

### TC-B-06 — User B cannot list back-links of User A's context node
**Spec:** RLS.
**Setup:** Elena belongs to A's org.
**Procedure:** Sign in as B → GET `/api/nodes/<elena>/back-links`.
**Expected:** 404 `not_found`.

### TC-B-07 — Service role can read any context node (admin / test setup)
**Spec:** Migration 003 service-role policies carry forward.
**Setup:** Same as TC-B-01.
**Procedure:** Service-role client → SELECT from `nodes` where `node_category='context'`.
**Expected:** All rows visible (RLS bypassed for service role).

### TC-B-08 — Anon client cannot read any context node
**Spec:** Phase 1 §2.1.
**Setup:** Any data.
**Procedure:** Anon Supabase client → GET `/api/projects/<id>/context-nodes`.
**Expected:** 401 `unauthorised`.

---

## 7. Section 6 — Data Integrity Tests

### TC-D-01 — `nodes.scope` is non-NULL for every context node
**Spec:** API Contract G-1.
**Setup:** Create one context node via the new POST.
**Procedure:** Service-role SELECT `scope FROM nodes WHERE node_category='context'`.
**Expected:** Every row has `scope IN ('project','document')`. None NULL.

### TC-D-02 — `nodes.scope` is NULL for every structural node
**Spec:** API Contract G-1.
**Setup:** Existing Phase 2 / 3 trees + a freshly-created structural node.
**Procedure:** Service-role SELECT `scope FROM nodes WHERE node_category='structural'`.
**Expected:** Every row has `scope IS NULL`.

### TC-D-03 — UNIQUE(source_node_id, target_node_id) prevents double-link
**Spec:** Migration 005 schema; API Contract §2.3.
**Setup:** Chapter 3 ↔ Elena linked.
**Procedure:** Service-role INSERT `INTO node_context_links (source_node_id, target_node_id, ...) VALUES (chapter3, elena, ...)`.
**Expected:** Unique-constraint violation (PostgreSQL error code 23505).

### TC-D-04 — Cascade delete on context node removes the link
**Spec:** Migration 005 FK ON DELETE CASCADE.
**Setup:** Elena linked to Chapter 3.
**Procedure:** Service-role DELETE `FROM nodes WHERE id=<elena>`.
**Expected:** Link row in `node_context_links` is gone.

### TC-D-05 — Cascade delete on structural node removes the link
**Spec:** Migration 005 FK ON DELETE CASCADE.
**Setup:** Same.
**Procedure:** Service-role DELETE `FROM nodes WHERE id=<chapter3>`.
**Expected:** Link row gone.

### TC-D-06 — Cascade delete on the project removes context nodes and links
**Spec:** Migration 004 FK ON DELETE CASCADE.
**Setup:** Project P1 with Chapter 3, Elena, link.
**Procedure:** Service-role DELETE `FROM projects WHERE id=<P1>`.
**Expected:** Chapter 3, Elena, the link, and the project all gone. (Same cascade as Phase 2.)

### TC-D-07 — Document-scoped context node moves with its document on delete
**Spec:** Migration 004 FK ON DELETE CASCADE on `document_id`.
**Setup:** Doc D1 with Atrium (`scope='document'`, `document_id=D1`).
**Procedure:** Service-role DELETE `FROM documents WHERE id=<D1>`.
**Expected:** Atrium is gone (cascaded via document FK). Project-scoped context nodes in the same project are unaffected.

### TC-D-08 — Migration 023 trigger fires on context-node content changes
**Spec:** Migration 023 (carried forward from Phase 3).
**Setup:** Elena `version=1`.
**Procedure:** Update `summary` via PATCH.
**Expected:** `version` becomes 2 (trigger fires the same way as on structural nodes — the trigger keys on `node_category` agnostic).

---

## 8. Section 7 — Accessibility Tests

### TC-AX-01 — Sidebar Context library section headers have role="button" and aria-expanded
**Spec:** Component Spec §2.3; §15.4.
**Setup:** Sidebar open.
**Procedure:** Inspect the Characters section header.
**Expected:** `role="button"`; `aria-expanded="false"` when collapsed, `"true"` when expanded; `aria-controls` references the section's content list. Tab order: focusable.

### TC-AX-02 — Picker is keyboard-navigable
**Spec:** Component Spec §3.3 (CommandPalette analog); §15.4.
**Setup:** Picker open with five context nodes.
**Procedure:** Press Down five times then Enter.
**Expected:** Each Down moves a visible "selected" highlight one row down (last row wraps to first if at end). Enter triggers the link creation.

### TC-AX-03 — Modal is focus-trapped
**Spec:** Component Spec §9.1; §15.2.
**Setup:** ContextCreateModal open.
**Procedure:** Tab through every focusable element. Continue past the last one.
**Expected:** Focus wraps to the first focusable inside the modal. Focus does not escape into the page below.

### TC-AX-04 — Successful link announces via screen reader
**Spec:** §15.4 (screen-reader announcements).
**Setup:** Picker open. Screen-reader emulator active.
**Procedure:** Select a context node.
**Expected:** A `role="status"` element (or aria-live region) announces "Linked Elena to Chapter 3" within 200ms of the success.

### TC-AX-05 — Modal Esc closes
**Spec:** Component Spec §9.1.
**Setup:** Modal open.
**Procedure:** Press Esc.
**Expected:** Modal closes. Focus returns to the trigger ([+] button on the Sidebar).

### TC-AX-06 — Sidebar list rows are reachable via keyboard
**Spec:** §15.4.
**Setup:** Sidebar with one expanded section, two rows.
**Procedure:** Tab to the section header → Down arrow.
**Expected:** Down moves into the section's first row; subsequent Down navigates rows. Enter on a row opens the detail panel for that context node.

---

## 9. Verdict Criteria

The phase passes if and only if **every** test case in this plan passes against the local Supabase stack, plus the four-case Phase B subset passes against `stelavox-dev`. Any failure must be classified in the Test Report as one of:

- **Specification gap** — spec was silent on this case; agent inferred wrongly. Fix: update the spec, then fix the code.
- **Specification error** — spec was wrong; correct the spec first.
- **Implementation gap** — code diverged from a correct spec; fix the code.
- **Environment issue** — config / secrets / infra; fix the environment.

The Test Report records every iteration during the build (any case that failed, its root cause, the fix applied, and the re-test outcome). The verdict count must match the actual authored case count, not the planned count. Any case formally deferred to a later phase is removed from the verdict count and noted under "Deferred." The plan's authoritative case count for verdict purposes is the count of `test('TC-…')` blocks in the codebase at merge time.

---

## 10. Changelog

**v1.0 — 2026-05-04** Initial Phase 4 Test Plan. 90 cases across seven categories: 22 UI, 6 visual, 4 motion, 36 API, 8 boundary, 8 data integrity, 6 accessibility. Built on the Phase 3 environment + tooling; no new migrations. Cloud smoke subset (TC-U-01, TC-U-08, TC-A-01, TC-A-15) defined for Phase B against `stelavox-dev`.
