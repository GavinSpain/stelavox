# Stelavox — Phase 3 Build Checklist
## Version 1.1

> **Tier-B per-phase document.** The ordered, executable task list for Phase 3. Every task is sized to fit in one Claude Code session, has an explicit acceptance criterion, and references the spec section that authorises it. The agent works through this list top-to-bottom, marking each checkbox complete as the acceptance criterion is satisfied.

**Phase:** 3 — Content Editing: Tiptap (Summary, Prose, Notes), Focus Mode, auto-save with optimistic concurrency, version-history browse and diff preview, metadata forms.
**Goal:** Deliver a working content-editing surface where authors can compose a node's Summary, Prose, and Notes; autosave runs silently in the background with optimistic concurrency; Focus Mode expands to the full viewport on `⌘Return`; the History tab lists versions with hover-diff preview.
**Deliverable:** A merge-ready branch in which all 96 test cases in `stelavox_phase3_test_plan_v1_0.md` pass, deployed against a Phase A (local) Supabase stack and smoke-tested against Phase B (cloud `stelavox-dev`).
**Estimated weeks:** 5 (per Technical Architecture v1.5 §11).
**Dependencies on prior phases:** Phase 2 merged to `master`. Migrations 001–021 + 023 (with 022 intentionally skipped), the Phase 2 PATCH endpoint, the AppShell, and the NodeTree are required preconditions.
**Companion documents:** `stelavox_phase3_api_contract_v1_0.md` (frozen), `stelavox_phase3_test_plan_v1_0.md` (frozen).

---

## 1. Pre-Build Prerequisites

Before any task in §3 begins:

- [ ] **PB-1.** Phase 2 is merged to `origin/master` (commit `f8492a7`) and TA v1.5 / Product Spec v1.3 / Component Spec v2.1 / CLAUDE.md v1.4 are in (the Phase 3 Tier-B prep close-out commits — TA `771056a`, Product Spec `828ff62`, Component Spec `48d79fb`, CLAUDE.md `db851f2` — also on master). Acceptance: `git -C C:/dev/stelavox_2 log --oneline -10 master` shows all four close-out commits and the API/Test Plan/Build Checklist commits ahead of `f8492a7`.
- [ ] **PB-2.** A fresh worktree is created from master at `C:/dev/stelavox_2/.claude/worktrees/<random-name>` on a new feature branch `claude/phase3-editors` (the per-session worktree pattern from Phase 1 / 2). Acceptance: `git worktree list` shows the new worktree; the branch is ahead of master by 0 commits.
- [ ] **PB-3.** Local Supabase stack is started in the new worktree on +10-shifted ports (54330–54339). Acceptance: `supabase status` reports running; Studio reachable at `http://127.0.0.1:54333`; Mailpit at `:54334`.
- [ ] **PB-4.** All 22 prior migrations apply cleanly on a fresh DB (`supabase db reset` succeeds). Seed loads without errors. Acceptance: `nodes` row count is 0; `node_versions` row count is 0; `layer_stacks` template count is 3; `platform_config` has 41 rows; one `director_configs` row.
- [ ] **PB-5.** `npm install` is run in the worktree; `npm run dev` starts on `http://localhost:3000`; `npm run build`, `npm run lint`, `npm run type-check` all pass on the inherited Phase 2 codebase. Acceptance: all four commands exit 0.
- [ ] **PB-6.** Tiptap is added as a dependency: `npm install @tiptap/react @tiptap/pm @tiptap/starter-kit @tiptap/extension-link @tiptap/extension-placeholder`. Acceptance: package installed; lockfile updated.
- [ ] **PB-7.** API Contract v1.0 (`stelavox_phase3_api_contract_v1_0.md`) and Test Plan v1.0 are reviewed and approved by the human. Acceptance: this file's commit message references both as inputs.

If any prerequisite fails, work stops and the cause is fixed before §3 begins.

---

## 2. Phase Checkpoint Criteria

The phase is considered complete when **every** condition holds. The Test Plan tests these:

1. **All three editors mount and persist their content.** SummaryEditor (Inter), ProseEditor (Lora), NotesEditor (Inter) each render in the Content tab; each sends a PATCH to `/api/nodes/[id]` 1.5 seconds after the user stops typing; the database row reflects the typed content. (TC-U-01..TC-U-05.)
2. **The typeface boundary holds.** Inter only in Summary / Notes; Lora only in Prose. Programmatic `getComputedStyle` checks confirm. (TC-U-02, TC-U-03.)
3. **Autosave is single-flight per node, all-bundled, and silent on success.** No concurrent PATCHes from the same client; one PATCH carries every changed content field; no toast on success. (TC-U-04..TC-U-07; UI Spec line 751.)
4. **Switching nodes flushes synchronously.** Selecting a different tree row force-flushes any pending autosave on the previous node before the new node loads. (TC-U-06.)
5. **Optimistic concurrency works.** PATCH with stale `expected_version` returns 409; the conflict banner offers `[Use latest]` and `[Keep mine]`; `[Keep mine]` re-PATCHes with the new version. (TC-U-08..TC-U-10; TC-A-01..TC-A-12.)
6. **Lock-state hardens autosave.** A 423 response surfaces a read-only banner; the editor switches to non-editable; no further PATCHes fire. 423 beats 409 in the response. (TC-U-11, TC-U-24, TC-A-12, TC-A-30, TC-A-31.)
7. **Focus Mode entry and exit hit 280ms.** All structural panels transition simultaneously; cursor preserved; `prefers-reduced-motion` collapses to 0ms. (TC-U-12, TC-U-13, TC-M-01..TC-M-03, TC-M-05.)
8. **Sentence focus and typewriter scrolling.** Optional toggles. Sentence focus runs 200ms on cursor move; typewriter keeps active line at 42% viewport. (TC-U-14, TC-U-15, TC-M-04, TC-M-06.)
9. **Visual / opacity state machines hold the locked values.** WordCount opacity 0 typing / 0.4 idle / 0.9 hover. FocusBreadcrumb max 0.2 (Inviolable). FocusEscHint fades at 5s and never returns. ProseEditorCursor 600/400ms blink, no blink while typing, verdigris caret-color. (TC-V-01..TC-V-12.)
10. **Version history reads work and the list renders.** GET `/api/nodes/[id]/versions` paginates (limit 1–100, default 25, ordered version DESC); GET `/api/nodes/[id]/versions/[n]` returns the full version body. The History tab renders the list with current-version star and hover diff preview. (TC-U-20..TC-U-23, TC-A-17..TC-A-29.) **Restore button is NOT rendered** — Phase 6 work.
11. **All 22 migrations apply cleanly in order on a fresh database.** No new migrations in Phase 3. (Tested as part of fresh-DB CI runs.)
12. **`lib/types/database.ts` is up-to-date.** No regeneration needed (no schema changes); a confirmation regen is run anyway and produces a no-op diff. (Hazard H-10.)
13. **`npm run build`, `npm run lint`, `npm run type-check` all succeed** on the final branch state.
14. **Inviolable audits pass.** (a) Inviolable #1 — ProseEditor + FocusMode use `--color-bg-base` only. (b) Inviolable #2 — verdigris uses #3 (cursor) and #6 (word count at target) introduced this phase; manual audit of every `var(--color-accent)` and `#3d7858` / `#254a38` literal in the diff. (c) Inviolable #3 — no Cinzel in the editor surfaces. (d) Inviolable #4 — Inter in Summary/Notes, Lora in Prose, no crossing. (e) Inviolable #5 — no persistent toolbar in ProseEditor.

The Test Plan's Verdict Criteria (§9) is the single authoritative pass/fail rule.

---

## 3. Ordered Task List

Tasks are grouped by subsystem. Within a group, complete top to bottom. Across groups, complete top to bottom unless explicitly marked **(parallelisable)**.

> **Reminder for the agent (per global CLAUDE.md):** before each task, propose the change in one sentence and wait for confirmation. Diagnose before fixing if anything fails. Never refactor adjacent code in the same change.

> **Model selection (per `stelavox_model_selection_v1_0.md`):** Tier-B authoring done; the per-phase advisory recommends **Opus 4.7 for §3.4 (autosave / conflict resolution) and §3.6 (Focus Mode transition choreography)** since these are the H-06-adjacent and motion-correctness areas. Default model for the rest is **Sonnet 4.6**. Promote to Opus mid-task on any of the three triggers — spec contradiction, diagnosis exhausted in 2–3 attempts, hazard-relevant code.

---

### 3.1 Editor primitives — shared scaffolding

Authoritative spec: Component Spec §5.3 / §5.4 / §5.13; TA v1.5 §2.6 (Tiptap conventions); H-06 (plain-text serialisation).

- [ ] **T-1.1.** Create `lib/editor/serialise.ts` exposing `toStorage(editor)` and `fromStorage(text, extensions)`. Both are thin wrappers around `editor.getJSON()` / `JSON.parse` + `editor.commands.setContent(json)`. Centralises the JSON ↔ string conversion per API Contract §5 G-3. Acceptance: round-trip test — start with a Tiptap doc, `toStorage` to a string, `fromStorage` back to a doc, assert structural equality.

- [ ] **T-1.2.** Create `lib/editor/extensions.ts` exposing three named extension lists: `summaryExtensions` (StarterKit minus Heading/Blockquote/Code/HorizontalRule/CodeBlock + Placeholder), `proseExtensions` (StarterKit minus all of the above plus BulletList/OrderedList + Link + Placeholder), `notesExtensions` (StarterKit same as summary plus Link + Placeholder). Each list is a frozen array. **No editor component in §3.2/§3.3 may inline its own extensions** — they must import from this module. Acceptance: each list exported; type-check passes; the three lists are not equal to each other.

- [ ] **T-1.3.** Create `lib/editor/typing-state.ts` — a small utility that exposes `attachTypingDetector(editor, durationMs = 1200)`. Adds the `is-typing` class on keydown; clears it after `durationMs` of inactivity. Used by ProseEditor (cursor blink suppression per Component Spec §5.5). Acceptance: simulated keydown adds the class; absence of further events for 1200ms removes it.

### 3.2 SummaryEditor and NotesEditor (Inter sibling pair) (parallelisable)

Authoritative spec: Component Spec §5.3, §5.13.

- [ ] **T-2.1.** Create `components/detail/SummaryEditor.tsx`. Tiptap React component using `summaryExtensions` from T-1.2. Props: `{ value: string | null; onChange: (newValue: string) => void; readOnly?: boolean }`. Style per Component Spec §5.3 (Inter 400 13px, line-height 1.55, bg `--color-bg-base`, 1px border `--color-border-subtle`, 4px radius, `10px 12px` padding, min-height 80px). Placeholder "Summarise this node for the agent…". On focus, a minimal toolbar (Bold | Italic | • Bullet | 1. Number) appears at 32px height. Acceptance: TC-U-02 passes (Inter, never Lora, programmatic `getComputedStyle` check); component renders against a Beat 2 fixture; placeholder visible when empty.

- [ ] **T-2.2.** Create `components/detail/NotesEditor.tsx`. Same shape as SummaryEditor but uses `notesExtensions` (Link admitted). Style per §5.13 — Inter 400 13px, but min-height 100px, max-height 400px (then scrolls). Placeholder "Notes to yourself about this node…". Toolbar adds a Link button (🔗). Acceptance: TC-U-19 passes (Link works in NotesEditor; same `⌘K` is unbound in SummaryEditor).

### 3.3 ProseEditor (Lora — the constrained component)

Authoritative spec: Component Spec §5.4, §5.5, §5.6, §5.7, §5.8; Brand §7. **Inviolable territory — Opus discretion if any subtlety surfaces.**

- [ ] **T-3.1.** Create `components/detail/ProseEditor.tsx`. Tiptap React component using `proseExtensions`. Props: `{ value: string | null; onChange: (newValue: string) => void; mode: 'edit' | 'focus'; readOnly?: boolean }`. Style per Component Spec §5.4 — Lora 400, 16px (edit) / 18px (focus), line-height 1.85, max-width 620px (focus) / fills panel (edit), bg `--color-bg-base`, side margins 48px+ (focus), bottom padding 120px. **No persistent toolbar** (Inviolable #5). Placeholder "Begin writing…" italic. Acceptance: TC-U-03 passes (Lora, never Inter); 18px in focus, 16px in edit; line-height 1.85 confirmed.

- [ ] **T-3.2.** Wire `ProseEditorCursor` styles via the editor instance. Per Component Spec §5.5: `caret-color: var(--color-accent)`; `@keyframes stelavox-blink` 600ms on / 400ms off; `.is-typing` class suppresses the animation. Use `lib/editor/typing-state.ts` from T-1.3. **Verify the 2px width via `getComputedStyle` against the actual ProseMirror element.** Acceptance: TC-V-09, TC-V-10, TC-V-11, TC-V-12 all pass.

- [ ] **T-3.3.** Create `components/detail/SelectionTooltip.tsx`. Per Component Spec §5.6 — appears above non-empty text selection in ProseEditor only. Three buttons: B (bold), I (italic), 🔗 (link). Background `--color-bg-elevated`, 1px border `--color-border-default`, 5px radius, `--shadow-md`. Wires `⌘K`/`⌘B`/`⌘I` keyboard shortcuts via Tiptap. Acceptance: TC-U-17, TC-U-18 pass; tooltip vanishes on deselect / Esc / cursor-move.

- [ ] **T-3.4.** Create `components/detail/WordCount.tsx`. Per Component Spec §5.7 — bottom of prose column, right-aligned, Inter 300 11px `--color-text-muted`. Opacity state machine: 0 typing / 0.4 idle (3s after last keypress, 800ms `--easing-prose` fade-in) / 0.9 hover. Display formats per spec: `87 words`, `87 / 400`, `400 / 400` (verdigris colour at-or-above target — verdigris use #6). Acceptance: TC-V-01, TC-V-02, TC-V-03, TC-U-16 all pass.

- [ ] **T-3.5.** Create `components/detail/FocusModeButton.tsx`. Per Component Spec §5.8 — Inter 400 11px `--color-text-muted`, 1px border `--color-border-subtle`, 4px radius, `5px 10px` padding. Label `⊞ Focus Mode` with `⌘↵` hint at opacity 0.5. Click triggers Focus Mode entry. Acceptance: button renders in the Content tab's prose label row; click triggers the entry path from §3.6.

### 3.4 Autosave + concurrency — `editor-store` and PATCH wiring

Authoritative spec: API Contract §2.11, §3.1; TA v1.5 §2.7. **Opus territory** per the model_selection advisory — autosave races + H-06 are the subtle area of this phase.

- [ ] **T-4.1.** Create `lib/stores/editor-store.ts` (Zustand). State per active node: `{ summary, prose, notes, expectedVersion, dirty, inflight, conflictCurrent }`. Actions: `loadNode(node)`, `setField('summary'|'prose'|'notes', value)`, `flushPending()`, `acceptCurrent()`, `keepMine()`, `clear()`. `setField` debounces a flush at 1.5s; `flushPending` is single-flight (no concurrent PATCHes per the same node). On 200, `expectedVersion` updates from response. On 409, populates `conflictCurrent` (the server's current node body) and pauses the debounce. On 423, populates a `lockedReason` flag and switches editors to read-only. Acceptance: unit tests for the state machine cover the four paths (success, no-content-change-no-version-bump, 409 conflict, 423 lock); single-flight verified by issuing two `setField` calls within 200ms and asserting only one PATCH fires.

- [ ] **T-4.2.** Wire SummaryEditor / ProseEditor / NotesEditor `onChange` handlers to `editorStore.setField`. The store owns the timer. Editors are presentation only. Acceptance: typing in any of the three editors fires exactly one PATCH 1.5s after the last keystroke (TC-U-04); typing across all three within the debounce window produces one PATCH carrying every changed field (TC-U-05).

- [ ] **T-4.3.** Update `lib/data/nodes.ts` to support PATCH with the optional `expected_version` field. The data wrapper passes the field through to Supabase; conflict detection is in the route, not the wrapper. Acceptance: the wrapper's TS signature now includes `expectedVersion?: number`; the field round-trips through type generation cleanly.

- [ ] **T-4.4.** Update `app/api/nodes/[nodeId]/route.ts` PATCH handler to implement the new validation order from API Contract §3.1 — including the lock check (steps 10) before the `expected_version` check (step 11), the strict `expected_version` integer ≥ 1 validation (TC-A-05, TC-A-06), and the 409 response shape with `current` field per §2.3. The Migration 023 trigger handles version bumping; the route does not need a manual `version + 1` write. Acceptance: TC-A-01 through TC-A-16 pass; TC-A-30, TC-A-31 (lock-beats-conflict) pass; TC-A-32 (consistency under race) passes.

- [ ] **T-4.5.** Implement `lib/validation/nodes.ts` updates — Zod schema for the PATCH body now includes `expected_version: z.number().int().min(1).optional()`. The existing forbidden-field list is unchanged; `version` remains forbidden. Acceptance: schema rejects `expected_version: 0`, `expected_version: "1"`, `expected_version: -1`; accepts integer ≥ 1 or omitted entirely.

- [ ] **T-4.6.** Create `components/detail/ConflictBanner.tsx`. Non-dismissible bar at top of the editor area. Two states: 409 (`[Use latest]` + `[Keep mine]` buttons) and 423 (`[Use latest]` only, message reads "This node is now locked"). Wires to `editorStore.acceptCurrent()` and `editorStore.keepMine()`. ARIA: `role="alert"` for screen reader announcement (TC-AX-04). Acceptance: TC-U-08, TC-U-09, TC-U-10, TC-U-11 all pass; banner announced via screen reader emulation.

- [ ] **T-4.7.** Implement local-storage shadow per API Contract §2.11 invariant 7. On every `setField` write, persist `{ summary, prose, notes, expectedVersion, savedAt }` under `stelavox_editor_<nodeId>`. On `loadNode`, if shadow exists and `shadow.expectedVersion < server.version`, surface the conflict UI. On successful PATCH, clear the shadow. Acceptance: closing the tab mid-edit and reopening surfaces the conflict banner; choosing `[Keep mine]` re-applies the shadow content.

- [ ] **T-4.8.** Implement beforeunload guard per §2.11 invariant 6. Listener on `window` checks `editorStore.dirty` and either prompts (no-flush case) or fires a `navigator.sendBeacon()` PATCH (flush attempt). Acceptance: manual verification — unsaved changes prompt the user; on confirm-leave, a PATCH request is observable in the network log via `sendBeacon`.

- [ ] **T-4.9.** Implement node-switch synchronous flush per §2.11 invariant 1. The `NodeTree` row click handler awaits `editorStore.flushPending()` before setting the new active node ID. Acceptance: TC-U-06 passes — clicking a sibling row immediately after typing forces the previous node's PATCH to commit before the new node loads.

### 3.5 Detail panel wiring — Content tab + Notes tab + History tab

Authoritative spec: Component Spec §5.1, §5.2 (TabStrip — already in Phase 2 placeholder).

- [ ] **T-5.1.** Update `components/detail/NodeDetailPanel.tsx` (Phase 2 stub). Replace the `Content` tab's "Coming in Phase 3" placeholder with a layout containing: name heading (existing from Phase 2), status pill (existing), then a stack of `<SummaryEditor />`, **(leaves only)** `<ProseEditor mode="edit" /> + <FocusModeButton /> + <WordCount />`, `<MetadataForm />`, `<NotesEditor />`. Each editor's value comes from `editorStore`; `onChange` calls `editorStore.setField`. The prose group renders only when `node.is_leaf === true` per **API Contract v1.1 §2.12** + **TA v1.6 H-15** + **Component Spec v2.2 §5.1** — leaf-ness is structural (`node.layer_index === max(layer_stack.layers[*].index)`), never inferred from child count. The `⌘Return` Focus Mode entry handler is correspondingly leaf-gated. Acceptance: TC-U-01 / TC-U-25 / TC-U-26 / TC-U-28 pass; on a Beat all three editor surfaces mount; on a Chapter only Summary/Metadata/Notes mount.

- [ ] **T-5.2.** The `Notes` tab is folded into the Content tab per the Phase 2 placeholder TabStrip's prior arrangement — Notes is the last editor in the Content tab, not a separate tab. Update the TabStrip to remove the `Notes` placeholder. Tabs remaining: `Content`, `Agent` (placeholder, Phase 5), `Comments` (placeholder, Phase 5), `History` (Phase 3, this build), `Context` (placeholder, Phase 4). Acceptance: TabStrip renders 5 tabs; the `Notes` tab is gone; `History` becomes the third active tab.

- [ ] **T-5.3.** Create `components/detail/HistoryTab.tsx`. Renders the `<VersionHistory />` component (T-5.4) when active. Acceptance: clicking the History tab renders the version list area; placeholder removed.

- [ ] **T-5.4.** Create `components/detail/VersionHistory.tsx` per Component Spec §5.11. Reads via `GET /api/nodes/[id]/versions?limit=7`. Renders rows: version number (Inter 600 11px) + timestamp + author (row 1), change description (row 2). Star ★ on the current version. **No Restore button** (Phase 6). On hover, fires `GET /api/nodes/[id]/versions/[n]` and renders the diff tooltip (added underlined, removed strikethrough). "Show N more versions…" link appears when `has_more` is true; click loads the next 25 rows. Empty state per TC-U-23. Acceptance: TC-U-20, TC-U-21, TC-U-22, TC-U-23 all pass.

- [ ] **T-5.5.** Create `app/api/nodes/[nodeId]/versions/route.ts` with `GET`. Implements API Contract §3.2 — query parsing (`limit` 1–100 default 25, `offset` ≥ 0 default 0), node-existence check (404 not_found), `node_versions` query ordered `version DESC, created_at DESC`, response shape `{ versions, total, has_more }` with content fields omitted from list rows. Acceptance: TC-A-17 through TC-A-24 pass.

- [ ] **T-5.6.** Create `app/api/nodes/[nodeId]/versions/[versionNumber]/route.ts` with `GET`. Implements API Contract §3.3 — UUID + integer validation, two-tier 404 (`not_found` for the node, `version_not_found` for the version), response shape per §2.13. Acceptance: TC-A-25 through TC-A-29 pass.

- [ ] **T-5.7.** Create `lib/validation/versions.ts` with the `versionsListQuerySchema` Zod. Mirror Phase 2's pattern. Acceptance: schema rejects `limit=500`, `limit=0`, `offset=-1`; accepts default omitted.

- [ ] **T-5.8.** Create `lib/data/versions.ts` with `listVersions(nodeId, limit, offset)` and `getVersion(nodeId, versionNumber)` thin Supabase wrappers. Acceptance: each returns typed rows from `lib/types/database.ts`.

- [ ] **T-5.9.** *(v1.1 corrective)* Wire the server-derived `is_leaf` field through the data + API + frontend per **API Contract v1.1 §2.12** + **TA v1.6 H-15** + **Component Spec v2.2**. (a) `lib/types/nodes.ts` exports `type NodeWithMeta = NodeRow & { is_leaf: boolean }`. (b) `lib/data/nodes.ts` `getNode()` and `listNodes()` decorate every returned row with `is_leaf` computed as `node.layer_index === (max layer_index in document's layer_stack.layers)`; the layer_stack is fetched once per request. (c) The PATCH and POST node endpoints include `is_leaf` in their response shapes. (d) `components/tree/NodeRow.tsx` hides the `+ Add child` button when `data.is_leaf === true`. (e) `components/detail/NodeDetailPanel.tsx` gates the prose group (ProseEditor + FocusModeButton + WordCount) and the `⌘Return` entry handler on `node.is_leaf`. **Implementation note:** `is_leaf` is a derived property — never stored on the row; never inferred from child count (a Chapter created before any Scenes still has zero children but is structurally not a leaf). Acceptance: TC-A-33 / TC-A-34 / TC-A-35 / TC-U-25 / TC-U-26 / TC-U-27 / TC-U-28 pass.

### 3.6 Focus Mode

Authoritative spec: Component Spec §6.1 / §6.2 / §6.3 / §6.4 / §6.5; Brand §7.9. **Opus territory** for the transition choreography.

- [ ] **T-6.1.** Create `components/focus/FocusMode.tsx`. Full-viewport overlay (`position: fixed; inset: 0; z-index: 100`); background `--color-bg-base`. Mounts a `<ProseEditor mode="focus" />` (centred 620px max-width, 18px Lora, typewriter positioning), a `<FocusBreadcrumb />`, a `<FocusEscHint />`, and (when typewriter or sentence-focus is enabled) wraps in `<TypewriterContainer />` / `<SentenceFocus />`. Entry triggered by `⌘Return` from ProseEditor or `<FocusModeButton />`; exit triggered by `Esc` or `⌘Return`. Acceptance: TC-U-12, TC-U-13 pass.

- [ ] **T-6.2.** Implement the Focus Mode entry/exit transition. 280ms `--easing-default` simultaneously: tree → translateX(-100%) + opacity 0; right panels → translateX(100%) + opacity 0; header → translateY(-48px) + opacity 0; prose column expands its max-width from panel-width to 620px. Honour `prefers-reduced-motion` → 0ms. Cursor and scroll position preserved across the transition. Acceptance: TC-M-01, TC-M-02, TC-M-03, TC-M-05 all pass.

- [ ] **T-6.3.** Create `components/focus/FocusBreadcrumb.tsx` per Component Spec §6.2. `aria-hidden="true"` (Inviolable). `pointer-events: none` always. Inter 200 11px tracking 0.04em `--color-text-muted`. Position absolute top: 20px, centred, full width, text-align center. Format: `Document · Layer · Layer · Current` (separator `·` at opacity 0.4). Opacity state machine: 0 typing / 0.2 at rest > 3s / 0.2 on mouse movement / never above 0.2 (Inviolable). Acceptance: TC-V-04, TC-V-05, TC-V-06 all pass.

- [ ] **T-6.4.** Create `components/focus/FocusEscHint.tsx` per Component Spec §6.3. Inter 300 10px tracking 0.12em `--color-text-disabled`. Bottom-right of viewport, inside prose column right edge. Text "Esc to exit". Entry opacity 0.3. Fades to 0 after 5000ms (`--duration-slow`). **Never returns** (Inviolable: no hover behaviour after fade). Acceptance: TC-V-07, TC-V-08 pass.

- [ ] **T-6.5.** Create `components/focus/TypewriterContainer.tsx` per Component Spec §6.4. Keeps the active line at 42% of viewport height (±2px tolerance). `scroll-behavior: smooth`. On in Focus Mode by default; off in Edit Mode (opt-in via three-dot menu). Persists in `localStorage.stelavox_typewriter_enabled`. Acceptance: TC-U-15 passes.

- [ ] **T-6.6.** Create `components/focus/SentenceFocus.tsx` per Component Spec §6.5. Off by default (opt-in via three-dot menu). Persists in `localStorage.stelavox_sentence_focus_enabled`. Active sentence at opacity 1.0; adjacent (±1) at 0.85; all other text at 0.55 (locked minimum). Cursor-move transition 200ms `--easing-prose`. During selection, all text returns to opacity 1. Sentence detection: `Intl.Segmenter` with `granularity: "sentence"`; fallback to abbreviation-aware regex if unavailable. Acceptance: TC-U-14, TC-M-04, TC-M-06 pass.

- [ ] **T-6.7.** Implement Focus Mode sibling navigation per Component Spec §6.1 — `⌘←` / `⌘→` moves to previous/next sibling at the same layer. Transition: prose fades out 150ms, breadcrumb updates, prose fades in 150ms with the new node's content. Total ~300ms. Acceptance: TC-M-08 passes.

- [ ] **T-6.8.** Wire ⌘Return into the ProseEditor (Edit Mode) as the entry shortcut, and Esc + ⌘Return inside Focus Mode as exit shortcuts. Hot-key conflict check: ⌘Return must not fire Tiptap's "insert hard break" or any other extension command. Acceptance: TC-U-12, TC-U-13 pass; manual verification that ⌘Return does not insert a paragraph break in either mode.

### 3.7 MetadataForm (per-node-type schemas — client-side only in Phase 3)

Authoritative spec: TA v1.5 §2.4 (`MetadataForm.tsx` referenced); API Contract §5 G-4.

- [ ] **T-7.1.** Create `lib/editor/metadata-schemas.ts` exposing `metadataSchemaForNodeType(node_type: string): MetadataSchema`. A `MetadataSchema` is `{ key: string; label: string; type: "text"|"number"|"date"|"select"; options?: string[] }[]`. Initial schemas (all fields optional) for the V1 structural types: `book`, `act`, `chapter`, `scene`, `beat` (novel) and equivalents for `short_story` and `series`. Suggested fields: `pov_character`, `time_of_day`, `location`, `mood`. Acceptance: schema returned for each known node_type; unknown node_type returns `[]`.

- [ ] **T-7.2.** Create `components/detail/MetadataForm.tsx`. Renders the schema for the active node's `node_type`. Each field maps to a labelled input. On change, updates `editorStore` (which then bundles the change into the next autosave PATCH alongside any content edits). The form is part of the Content tab, rendered between ProseEditor and NotesEditor. Acceptance: clicking a chapter row shows chapter-relevant fields; typing in any field flushes to `nodes.metadata` 1.5s later as part of the same PATCH that carries other content edits.

### 3.8 Empty states and onboarding (parallelisable)

- [ ] **T-8.1.** Update the History tab's empty-state copy per TC-U-23 wording: *"Versions are recorded when the agent revises this node. Agent operations arrive in Phase 5."* Acceptance: opening History on a fresh beat shows this message.

- [ ] **T-8.2.** Verify the existing Phase 2 empty-state hint (root row "Hover the row and click + to add your first ___") is unaffected by Phase 3 changes. Acceptance: Phase 1 / 2 regression.

### 3.9 Phase A → Phase B smoke test (parallelisable with §3.10)

- [ ] **T-9.1.** No new migrations to apply to `stelavox-dev` (Phase 3 has no schema changes). Acceptance: `mcp__...__list_migrations(stelavox-dev)` returns 22 migrations (the same as end-of-Phase-2).

- [ ] **T-9.2.** Run a 4-test cloud smoke subset against `stelavox-dev`: TC-U-01 (editors mount), TC-U-04 (autosave fires), TC-U-08 (409 conflict), TC-U-12 (Focus Mode entry). Use `--timeout=60000` per the Phase 1 / 2 lesson. Acceptance: all 4 pass.

### 3.10 Test execution

- [ ] **T-10.1.** Create test files matching Phase 1 / 2 structure:
    - `tests/api/nodes-patch.spec.ts` — TC-A-01 through TC-A-16, TC-A-30 through TC-A-32.
    - `tests/api/versions.spec.ts` — TC-A-17 through TC-A-29.
    - `tests/boundary/editors-rls.spec.ts` — TC-B-01 through TC-B-08.
    - `tests/integrity/version-trigger.spec.ts` — TC-D-01 through TC-D-06.
    - `tests/ui/editors.spec.ts` — TC-U-01 through TC-U-11, TC-U-16 through TC-U-19, TC-U-24.
    - `tests/ui/focus-mode.spec.ts` — TC-U-12, TC-U-13, TC-U-14, TC-U-15, TC-M-01 through TC-M-08.
    - `tests/ui/version-history.spec.ts` — TC-U-20, TC-U-21, TC-U-22, TC-U-23.
    - `tests/visual/opacity.spec.ts` — TC-V-01 through TC-V-12.
    - `tests/accessibility/editors-ax.spec.ts` — TC-AX-01 through TC-AX-06.
    - `tests/helpers/tiptap.ts`, `tests/helpers/opacity.ts`, `tests/helpers/autosave.ts`, `tests/helpers/motion.ts` (per Test Plan §1.4).
   Acceptance: all 9 spec files exist; all 4 helper files exist.

- [ ] **T-10.2.** Run `npx playwright test` from the worktree. Iterate on any failures: classify (spec gap / spec error / impl gap / env), fix the cause (spec fix → contract version bump → regenerate the test; impl fix → code change), re-run. **Do not modify a test case to make it pass** — that is forbidden by the Test Plan §9 rule. Acceptance: 102/102 PASS in a clean run (96 original cases + 6 v1.1 leaf-aware cases TC-A-33..35 / TC-U-25..28).

- [ ] **T-10.3.** Run `npm run build`, `npm run lint`, `npm run type-check`. Acceptance: all three exit 0.

### 3.11 Pre-merge checks

- [ ] **T-11.1.** Diff review of every changed file. Look for: hardcoded operational values (H-12); brand violations (Cinzel/Cormorant outside `components/brand/`; verdigris outside the nine permitted locations — Phase 3 introduces uses #3 (cursor) and #6 (word count at target)); direct LLM SDK calls (still N/A in Phase 3); H-01 (`.single()` vs `.maybeSingle()`); H-05 (real-time subscriptions — none in Phase 3, confirm absence); H-06 (Tiptap → plain text — N/A in Phase 3 since no LLM prompts include content; the helper exists for Phase 5).

- [ ] **T-11.2.** Confirm `lib/types/database.ts` is unchanged (no new migrations means no regen needed). Run `npm run db:types` anyway and assert a no-op diff. Acceptance: `git diff lib/types/database.ts` shows no changes.

- [ ] **T-11.3.** Confirm `CLAUDE.md` (root) and `docs/CLAUDE_stelavox_project.md` are byte-identical.

- [ ] **T-11.4.** Update `CLAUDE.md` Spec Library Reference table if any spec versions bumped during Phase 3 (none expected — TA stays v1.5, Product Spec v1.3, Component Spec v2.1 unless a Phase 3 SU forces a bump).

- [ ] **T-11.5.** Bump `stelavox_phase3_build_checklist_v1_0.md` to v1.1 if anything in this document needed correction during the build. Add a changelog entry.

- [ ] **T-11.6.** Compose `docs/stelavox_phase3_test_report_v1_0.md` per AI-Native Spec Standard §2.12 — every test case PASS/FAIL with root cause + fix + re-test. **Model: Opus 4.7** (advisory §5).

---

## 4. Migration Ordering (Unchanged from Phase 2)

The 22-file migration sequence is unchanged in Phase 3:

| # | Filename | Phase introduced |
|---|---|---|
| 001–019 | (Phase 1 set; see Phase 2 build checklist §4 for full list) | Phase 1 |
| 020 | create_document_with_layer_stack_extend_root_node | Phase 2 |
| 021 | move_node | Phase 2 |
| 022 | *(intentionally skipped)* | — |
| 023 | nodes_version_bump_trigger | Phase 2 |

Phase 3 adds **zero** new migrations. The Phase 3 contract relies on Migrations 005 (`node_versions`) and 023 (content-only version bump trigger) which already exist.

---

## 5. Migration Authority Note

There are no new migration files in Phase 3, so this section is a no-op for this phase. Carries forward unchanged for the file-format consistency.

---

## 6. Specification Updates Required After Phase 3

Items raised during Phase 3 build that imply a TA v1.6 / Product Spec v1.4 / Component Spec v2.2 update. These are tracked here so they're not lost:

- **SU-1 (Phase 3).** API Contract §5 G-1: `node_versions` row creation is deferred to Phase 5 (the agent system is the principal author of versions in V1; manual edits do not snapshot). Document in TA v1.6 §11 Phase 5 commitment block + Product Spec v1.4 §4.12.
- **SU-2 (Phase 3).** API Contract §5 G-2: `prose` field max raised from 1M to 2M chars; editor's 100,000-char warning threshold. Document in Product Spec v1.4 §4.5.
- **SU-3 (Phase 3).** API Contract §5 G-3: editor storage shape = stringified Tiptap JSON in TEXT columns; `lib/editor/serialise.ts` centralises the conversion. Document in TA v1.6 §2.6 (Rich Text Editing).
- **SU-4 (Phase 3).** API Contract §5 G-4: `metadata` schema validation is client-side only in Phase 3; server-side validation arrives with Phase 4 context schemas. Document in TA v1.6 §3.6 Migration 004 (or a new §3.x section on metadata) + Product Spec v1.4 §4.5.

**SU items resolved in this v1.1 corrective (post-merge):**

- **SU-5 (Phase 3 v1.1).** Tiptap v2 → v3 API drift. TA v1.5 §1 listed Tiptap 2.x; the build installed `3.22.5` (exact-pinned per the risk register's mitigation). v3 requires `immediatelyRender: false` on every `useEditor()` call for SSR safety; `setContent`'s second argument is `SetContentOptions`, not a boolean; and `useEditor` returns `Editor | null` (the editor doesn't exist during SSR). **Resolved:** TA v1.6 §2.6 (Rich Text Editing) now documents these v3 quirks explicitly; the editor components honour them.
- **SU-6 (Phase 3 v1.1).** API Contract §5 G-6: leaf-ness is server-derived, never inferred from child count. Phase 3 v1.0's UI rendered ProseEditor on every node; the "no children" client-side heuristic mis-classifies in-construction non-leaf nodes as leaves. **Resolved:** API Contract v1.1 §2.12 adds `is_leaf: boolean`; TA v1.6 H-15 documents the structural rule; Component Spec v2.2 §4.2 / §5.1 / §5.4 / §5.7 / §5.8 / §6.1 gate the affected affordances. Build Checklist task T-5.9 (this document) implements the wiring.
- **SU-7 (Phase 3 v1.1).** Component Spec §5.11 calls for a `--color-accent`-tinted current-version star, but Brand Identity v2.0 / CLAUDE.md Inviolable #2 enumerates exactly nine permitted verdigris uses, and the star is not among them. Phase 3 ships the star at `--color-text-primary` pending upstream resolution. Tracked for either Component Spec v2.3 (drop the verdigris call-out) or Brand Identity v2.1 + CLAUDE.md v1.6 (add a tenth Inviolable #2 entry).

Additional SU items may surface during the build; add them to this list when discovered, then process them in a single follow-up TA / Product Spec / Component Spec close-out commit after Phase 3 merges (mirror of the TA v1.5 close-out after Phase 2).

---

## 7. Risk Register

Phase-3-specific risks and their mitigations.

| Risk | Likelihood | Mitigation |
|---|---|---|
| **Tiptap `getJSON()` shape changes between versions.** | Low | Pin `@tiptap/*` to exact versions in `package.json`. Centralise serialisation in `lib/editor/serialise.ts` (T-1.1) so a future Tiptap upgrade has one chokepoint. |
| **Autosave races with rapid node-switching produce torn writes.** | Medium | T-4.9 forces a synchronous flush on node switch. T-4.1 single-flight prevents concurrent PATCHes. TC-U-06, TC-U-07, TC-A-32 verify. Run on Opus. |
| **`expected_version` semantics slip into Phase 5 agent jobs.** | Low–Medium | API Contract §2.11 invariant 5 explicitly admits omission. Phase 5 agent code must NOT send `expected_version`. The Phase 5 build checklist will codify this; Phase 3 documents it. |
| **Focus Mode transition flicker on slow GPUs.** | Medium | All four panels transition simultaneously on the same frame (T-6.2). `prefers-reduced-motion` collapses to 0ms. TC-M-03 verifies single-frame start. |
| **Sentence-focus regex misses paragraphs without terminal punctuation.** | Low | `Intl.Segmenter` is the primary path (handles edge cases via Unicode rules); the regex fallback is for legacy browsers only. Document the limitation in the sentence-focus section. |
| **Local-storage shadow grows without bound across many nodes.** | Low | Shadow is keyed by `nodeId`; only the currently-edited node has a shadow. Cleared on successful PATCH. A garbage-collection pass in T-4.7 prunes shadows older than 30 days on each editor mount. |
| **`prefers-reduced-motion` honoured inconsistently.** | Low | A single helper `hooks/useReducedMotion()` reads the media query and returns a 0ms duration override. Every transition in §3.6 reads from this hook. TC-M-05 to TC-M-07 verify. |
| **Conflict banner not announced by screen readers.** | Low | T-4.6 sets `role="alert"`. TC-AX-04 verifies via Playwright's screen-reader emulation. |
| **PATCH 409 race condition under network-throttled conditions.** | Medium | TC-A-32 explicitly tests this; T-4.1 single-flight + T-4.7 local-storage shadow cover the recovery path. The conflict UI is silent on success and audible on conflict — this is the brand's intended trade-off. |

---

## 8. Approval

This Build Checklist is approved before any Phase 3 implementation begins. Changes after approval are version-bumped on this document. The Build Checklist is the authoritative implementer's reference for Phase 3.

The four architectural decisions that shaped the contract (and therefore this checklist) were resolved with the human on 2026-05-04:

| # | Decision | Choice |
|---|---|---|
| Q1 | Notes tab in scope | Yes — Tiptap-Inter editor sibling of SummaryEditor; folded into the Content tab (not a separate tab) |
| Q2 | VersionHistory in scope | Partial — list, star, hover diff, pagination ship Phase 3; Restore is Phase 6 |
| Q3 | Autosave shape | Optimistic concurrency — 1.5s debounce, optional `expected_version`, 409 with conflict banner, 423 beats 409, last-write-wins when omitted |
| Q4 | TA v1.5 / SU close-out timing | First — TA v1.5, Product Spec v1.3, Component Spec v2.1, CLAUDE.md v1.4 landed before this checklist was drafted |

Plus four implementation calls confirmed during contract drafting:

| # | Call | Choice |
|---|---|---|
| 1 | Editor storage shape | Stringified Tiptap JSON in TEXT columns; `lib/editor/serialise.ts` centralises (T-1.1) |
| 2 | Manual edits do NOT create `node_versions` rows | Yes — agent system creates them in Phase 5 (G-1) |
| 3 | `prose` field max | Raised 1M → 2M chars |
| 4 | `metadata` schema enforcement | Client-side only in Phase 3 |

---

## 9. Changelog

**v1.1 — 2026-05-04** Post-Phase-3-merge corrective absorbed. **§3.5 T-5.1 amendment:** the Content-tab editor stack composition is now leaf-aware — the prose group (ProseEditor + FocusModeButton + WordCount) and the `⌘Return` entry handler are gated on `node.is_leaf` per API Contract v1.1 §2.12 + TA v1.6 H-15 + Component Spec v2.2. **§3.5 new T-5.9:** the wiring task — extension type, data-layer derivation, API decoration, NodeRow `+` button gating, NodeDetailPanel prose-group gating. **§3.10 T-10.2 acceptance:** test count raised from 96 to 102 (six new cases TC-A-33..35 / TC-U-25..28 added in Test Plan v1.1). **§6 SU registry:** three additional items recorded — SU-5 (Tiptap v2 → v3 drift, resolved in TA v1.6 §2.6), SU-6 (server-derived leaf-ness, resolved across API Contract v1.1 + TA v1.6 H-15 + Component Spec v2.2 + this checklist's T-5.9), SU-7 (current-version star verdigris call-out vs Inviolable #2 — pending upstream resolution). No PB or task-list reordering; corrective is purely additive on top of the merged Phase 3 v1.0 implementation.

**v1.0 — 2026-05-04** Initial Phase 3 Build Checklist. Eleven task groups: §3.1 editor primitives (3 tasks), §3.2 SummaryEditor + NotesEditor (2 tasks, parallelisable), §3.3 ProseEditor + cursor + tooltip + word count + focus-mode button (5 tasks — Inviolable territory), §3.4 autosave + concurrency (9 tasks — Opus territory), §3.5 detail panel wiring + history tab + version endpoints (8 tasks), §3.6 Focus Mode (8 tasks — Opus territory for transitions), §3.7 metadata form (2 tasks), §3.8 empty states (2 tasks), §3.9 Phase B smoke (2 tasks), §3.10 test execution (3 tasks), §3.11 pre-merge checks (6 tasks). Seven pre-build prerequisites (PB-1 to PB-7). Fourteen phase-checkpoint criteria. Four SU items pre-staged for TA v1.6 / Product Spec v1.4 / Component Spec v2.2 absorption. Risk register lists nine Phase-3-specific risks with mitigations.
