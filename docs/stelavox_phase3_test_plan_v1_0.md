# Stelavox — Phase 3 Pre-Phase Test Plan
## Version 1.0

> **Tier-B per-phase document.** Written before any implementation. Derived from `stelavox_phase3_api_contract_v1_0.md` and the Phase 3 checkpoint criterion in `stelavox_technical_architecture_v1_5.md` §11. Executed at the end of Phase 3; results recorded in `stelavox_phase3_test_report_v1_0.md` (created during the build's pre-merge group).

**Phase:** 3 — Content Editing: Tiptap (Summary, Prose, Notes), Focus Mode, auto-save with optimistic concurrency, version-history browse and diff preview, metadata forms.
**Phase 3 checkpoint criteria (Technical Architecture v1.5 §11):** "Can write content; versions created (Phase 2 trigger) and **browsable with hover diff** in this phase. Restore is Phase 6."
**Companion documents:** `stelavox_phase3_api_contract_v1_0.md`, `stelavox_phase3_build_checklist_v1_0.md`.

---

## 1. Test Environment

### 1.1 Where tests run

Phase 3 builds on the Phase 2 environment. Local Supabase stack started via `supabase start`; all 22 migrations applied (001–021 + 023; number 022 intentionally skipped per TA v1.5 §3.5); seed loaded; Next.js dev server on `http://localhost:3000`. The Phase 3 worktree shifts ports +10 the same way Phase 1 / 2 worktrees did.

A second smoke run is performed against cloud `stelavox-dev` (Phase B) before merge — same migrations, same seed, plus a Phase 3-specific subset: TC-U-01 (editor opens), TC-U-04 (autosave debounce → DB write), TC-U-08 (conflict UI), TC-U-12 (Focus Mode entry/exit).

### 1.2 Test users

Three test users created via `supabase.auth.signUp` at the start of the run, identical to Phase 1 / 2:

| Handle | Email | Password | Display name |
|---|---|---|---|
| **User A** | `test-a@example.com` | `Test1234!Test1234!` | `Author A` |
| **User B** | `test-b@example.com` | `Test1234!Test1234!` | `Author B` |
| **User C** | `test-c@example.com` | `Test1234!Test1234!` | `Author C` |

Test users are deleted between full runs by truncating `auth.users` (cascades). `supabase db reset` is acceptable in Phase A.

### 1.3 Test data

Pre-loaded by the seed (unchanged from Phase 2):
- Three layer-stack templates (Novel, Short Story, Series).
- All keys in `platform_config`.
- One `director_configs` row with `status = 'production'`.

Phase 3 does not add seed rows. Every node, document, and version used in tests is created during the run via the Phase 1 / 2 / 3 endpoints (or via service-role tree fixtures for performance).

### 1.4 Tooling

Same as Phase 2 (Vitest / Playwright API-mode for API tests, Playwright headed for UI checkpoints, service-role client only in test setup/teardown). New for Phase 3:

- **Tiptap content fixtures**: helper `tests/helpers/tiptap.ts` exposes `tiptapDoc(text: string)` returning the canonical `{ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] }` shape so tests can assert against deterministic JSON. Bold/italic variants exposed as `tiptapBold(text)`, `tiptapItalic(text)`.
- **Visual state assertions**: helper `tests/helpers/opacity.ts` exposes `expectOpacityWithin(element, low, high, timeout?)` that polls `getComputedStyle` until the opacity is in range or the timeout expires. The Component Spec timings (800ms for WordCount fade-in, 280ms for Focus Mode entry, 200ms for sentence focus) are codified as constants in the helper, with a +50ms tolerance for CI variance.
- **Autosave timing harness**: helper `tests/helpers/autosave.ts` exposes `typeAndWaitForFlush(editor, text, expectedDelayMs?)` — types the text via Playwright's `keyboard.type`, then awaits the next PATCH request matching `/api/nodes/[id]` (no `move` suffix). Default expected delay is 1.5 seconds + 300ms tolerance.
- **Network throttling**: a fixed-rate "slow 3G" preset is applied in TC-A-conflict tests to simulate the 409 race window. Playwright's `page.route` with deliberate `setTimeout` delays the response by 1500ms.
- **Reduced-motion fixture**: `tests/helpers/motion.ts` exposes `withReducedMotion(test, fn)` that emulates `prefers-reduced-motion: reduce` via Playwright's `emulateMedia({ reducedMotion: 'reduce' })` for the duration of `fn`. TC-M cases use it to verify 0ms transitions.

### 1.5 Mocking

No external services mocked. The LLM abstraction layer is not exercised in Phase 3 (agent operations arrive Phase 5). Tiptap is loaded as a real npm dependency; tests do not mock the editor.

### 1.6 Independence

Test cases are independent. Where a test requires a tree precondition ("User A has a document with one beat containing prose"), the test's setup creates that state via the API (or via service-role for performance) and tears it down in `afterEach`. No test reads state another test modifies.

### 1.7 Notation

- **TC-U-NN** — UI checkpoint test (Section 2). Verifies the visible behaviour of the editor surfaces.
- **TC-V-NN** — Visual / opacity state-machine test (Section 3). Verifies opacity transitions and steady-state opacities prescribed by Component Spec §5.7 / §6.2 / §6.3 / §5.5.
- **TC-M-NN** — Motion / transition test (Section 4). Verifies timing and choreography of Focus Mode entry/exit, sentence focus fades, and `prefers-reduced-motion` honour.
- **TC-A-NN** — API integration test (Section 5). PATCH with/without `expected_version`, version-list pagination, single-version reads.
- **TC-B-NN** — Authorisation boundary test (Section 6). RLS on the new and modified routes.
- **TC-D-NN** — Data integrity test (Section 7). End-to-end behaviour of Migration 023 via PATCH.
- **TC-AX-NN** — Accessibility test (Section 8). Keyboard-only flows, ARIA, screen-reader announcements.
- **Verdict:** `PASS` if actual matches expected exactly. `FAIL` otherwise; the Test Report classifies the cause.

---

## 2. Section 1 — UI Checkpoint Tests

These verify the Phase 3 checkpoint from a user's perspective: "Can write content; versions created and browsable with hover diff."

### TC-U-01 — Detail panel opens with all three editors mounted
**Spec:** Component Spec §5.1 (NodeDetailPanel), §5.2 (TabStrip), §5.3, §5.4, §5.13.
**Setup:** User A signed in; document with one beat; click the beat row.
**Procedure:** Detail panel opens. Click `Content` tab.
**Expected:** Three editors are mounted in order: SummaryEditor (Inter font), ProseEditor (Lora font), NotesEditor (Inter font). Each shows its placeholder text (`Summarise this node…`, `Begin writing…`, `Notes to yourself about this node…`). All three are empty (no autosave fires on mount).

### TC-U-02 — SummaryEditor accepts Inter font, never Lora
**Spec:** Component Spec §5.3 (Inviolable #4).
**Setup:** Detail panel open on a beat.
**Procedure:** Type "summary text" into SummaryEditor. Inspect `getComputedStyle(activeEditor).fontFamily`.
**Expected:** Resolves to a font-family stack starting with `Inter`. Lora is not in the stack. `font-size: 13px`. `font-weight: 400`.

### TC-U-03 — ProseEditor accepts Lora font, never Inter
**Spec:** Component Spec §5.4 (Inviolable #4).
**Setup:** Detail panel open on a beat.
**Procedure:** Type "prose text" into ProseEditor. Inspect `getComputedStyle`.
**Expected:** Font-family stack starts with `Lora`. Inter is not in the stack. `font-size: 16px` (Edit Mode). `line-height: 1.85`.

### TC-U-04 — Autosave fires 1.5 seconds after the last keystroke
**Spec:** API Contract §2.11 invariant 3; TA §2.7.
**Setup:** Detail panel open on a beat with `version = 1`.
**Procedure:** Type "hello world" into ProseEditor. Wait. Capture the next PATCH request to `/api/nodes/[beatId]`.
**Expected:** Exactly one PATCH issued ~1.5 seconds (±300ms) after the last keystroke. Body contains `{ "prose": <stringified Tiptap JSON containing "hello world">, "expected_version": 1 }`. Response 200; response body's `version` is `2`. The editor's local `expected_version` updates to `2`.

### TC-U-05 — Autosave bundles all changed editors in one PATCH
**Spec:** API Contract §2.11 invariant 3.
**Setup:** Detail panel open on a beat with `version = 1`.
**Procedure:** Type into SummaryEditor, then ProseEditor, then NotesEditor — all within 800ms of each other (no debounce flush between). Wait 1.5s.
**Expected:** Exactly **one** PATCH issued. Body contains all three content fields populated. Response `version = 2` (single increment per Migration 023 trigger — the trigger fires once per UPDATE statement and the IS DISTINCT FROM check covers all four content fields atomically).

### TC-U-06 — Switching nodes flushes pending autosave synchronously
**Spec:** API Contract §2.11 invariant 1; UI Spec line 678.
**Setup:** Document has Beat A and Beat B. Detail panel open on Beat A. Type "first" into ProseEditor (debounce timer running, no flush yet).
**Procedure:** Click Beat B in the tree.
**Expected:** PATCH to Beat A fires immediately (before Beat B's content loads). Beat B's editor opens with whatever content Beat B has on the server. The "first" text is persisted in Beat A's `prose` (verified by GET on Beat A after the click).

### TC-U-07 — Single-flight per node — no concurrent PATCHes
**Spec:** API Contract §2.11 invariant 2.
**Setup:** Detail panel open on a beat. Network throttled to slow 3G (1500ms PATCH latency).
**Procedure:** Type "first" → wait 1.6s → autosave fires (in-flight). Before it returns, type "second" → wait 1.6s.
**Expected:** Only one PATCH is in flight at any moment. The "second" PATCH is held until the "first" PATCH responds; the "second" PATCH's `expected_version` reflects the "first" PATCH's response. No 409 occurs (the client is not racing itself).

### TC-U-08 — 409 conflict surfaces a banner with [Use latest] / [Keep mine]
**Spec:** API Contract §2.4 / §2.11; Component Spec (no dedicated section — banner is Phase 3 implementation).
**Setup:** Detail panel open on a beat with `version = 1`. Open the same beat in a second browser context (User A again, fresh session). In the second context, type "from second" and wait for autosave (server now at `version = 2`).
**Procedure:** In the first context, type "from first" and wait for autosave.
**Expected:** PATCH from the first context returns `409 version_conflict` with `current` containing the second context's content. A non-dismissible banner appears at the top of the editor: text "This node was edited elsewhere — [Use latest] [Keep mine]" or equivalent. Both buttons are visible. The editor remains showing "from first" until the user chooses.

### TC-U-09 — [Use latest] discards local changes and refreshes editor
**Spec:** API Contract §2.11 invariant 4.
**Setup:** Continuation of TC-U-08 — banner showing.
**Procedure:** Click [Use latest].
**Expected:** Editor content updates to "from second" (the server's current state). Banner dismisses. `expected_version` updates to `2`. `localStorage` shadow for this node is cleared. No further PATCHes fire from this client until the user types again.

### TC-U-10 — [Keep mine] re-PATCHes with the new expected_version
**Spec:** API Contract §2.11 invariant 4.
**Setup:** Continuation of TC-U-08 — banner showing, "from first" still in editor locally.
**Procedure:** Click [Keep mine].
**Expected:** A new PATCH issues with `expected_version` set to the conflicted server version (`2`). Server applies the local content ("from first"); response `version = 3`. Banner dismisses. Editor content remains "from first." `localStorage` shadow cleared.

### TC-U-11 — 423 lock conflict surfaces a read-only banner
**Spec:** API Contract §2.4 / §2.11 invariant 8.
**Setup:** Detail panel open on a beat. Via service role (or admin path), set `nodes.locked = TRUE` on the beat.
**Procedure:** Type any character in any editor → wait for autosave.
**Expected:** PATCH returns `423 node_locked`. A read-only banner appears: "This node is now locked." Only `[Use latest]` is offered (no `[Keep mine]` — locks revoke write access entirely). Editors switch to read-only mode (Tiptap `editable: false`).

### TC-U-12 — Focus Mode entry transition from ProseEditor (⌘Return)
**Spec:** Component Spec §6.1 (entry/exit transition); Brand §7.9.
**Setup:** Detail panel open on a beat. Cursor placed inside ProseEditor.
**Procedure:** Press `⌘Return`.
**Expected:** Within 280ms (±50ms tolerance), the tree, sidebar, header, and detail panel chrome have all faded to opacity 0 and translated off-screen; the ProseEditor's prose column expands to 620px max-width centred on the viewport at 18px Lora; FocusBreadcrumb appears at top centre at opacity ≤ 0.2; FocusEscHint appears bottom-right at opacity ~0.3. Cursor remains in the editor (not lost). Scroll position preserved.

### TC-U-13 — Focus Mode exit (Esc or ⌘Return)
**Spec:** Component Spec §6.1.
**Setup:** Continuation of TC-U-12 — Focus Mode active.
**Procedure:** Press `Esc`.
**Expected:** Inverse transition over 280ms. All structural panels return to their pre-entry positions. Detail panel reopens with cursor still in ProseEditor at the same position. Editor focus is restored.

### TC-U-14 — Sentence Focus toggle and the fade
**Spec:** Component Spec §6.5; Brand §7.5.
**Setup:** Focus Mode active with three sentences typed: "First sentence. Second sentence. Third sentence." Cursor in second sentence.
**Procedure:** Open the three-dot menu → toggle Sentence Focus on.
**Expected:** Within 200ms, the second sentence is at opacity 1.0, the first and third (adjacent) at opacity 0.85, and any other text at opacity 0.55. Move cursor to first sentence: within 200ms, first sentence becomes 1.0, second becomes 0.85, third becomes 0.55. No hard cuts; transitions are smooth.

### TC-U-15 — Typewriter scrolling keeps active line at 42% viewport height
**Spec:** Component Spec §6.4; Brand §7.4.
**Setup:** Focus Mode active with typewriter scrolling enabled (default in Focus Mode).
**Procedure:** Type 60 lines of text continuously.
**Expected:** The line containing the cursor stays at 42% of viewport height (±2px) throughout. As lines accumulate, earlier lines scroll upward. No upward scroll-back happens; the cursor never travels below the 42% mark.

### TC-U-16 — WordCount target colour change at-or-above target
**Spec:** Component Spec §5.7 (verdigris use #6).
**Setup:** Beat with `word_count_target = 10`. ProseEditor empty.
**Procedure:** Type 9 words → wait 3s. Then type 1 more word → wait 3s.
**Expected:** After first wait, WordCount reads `9 / 10` with the count in `--color-text-secondary`. After second wait, WordCount reads `10 / 10` with the count in `--color-accent` (verdigris). No toast, no pulse, no animation other than the colour change.

### TC-U-17 — Selection tooltip appears above prose selection
**Spec:** Component Spec §5.6.
**Setup:** ProseEditor with text "the quick brown fox" selected (drag-select "quick brown").
**Procedure:** Inspect DOM after selection settles.
**Expected:** A SelectionTooltip element is positioned above the selection, horizontally centred. Three buttons visible in order: **B** (Bold), *I* (Italic), 🔗 (Link). On `Esc` or click outside the selection, tooltip vanishes.

### TC-U-18 — ⌘B applies bold via the prose editor (no toolbar)
**Spec:** Brand Inviolable #5; Component Spec §5.4.
**Setup:** ProseEditor with cursor in a word.
**Procedure:** Select the word and press `⌘B`.
**Expected:** Word renders in Lora 700 (bold variant). No persistent toolbar appears at any point.

### TC-U-19 — Notes editor admits Link extension; Summary does not
**Spec:** Component Spec §5.13 (Link extension rationale).
**Setup:** Detail panel open on a beat.
**Procedure:** Press `⌘K` in NotesEditor → enter `https://example.com` → confirm. Then press `⌘K` in SummaryEditor.
**Expected:** In NotesEditor, the link is created. In SummaryEditor, `⌘K` does nothing (the extension is not loaded). No error; the keyboard shortcut is simply unbound.

### TC-U-20 — Version history list renders with newest first
**Spec:** Component Spec §5.11; API Contract §3.2.
**Setup:** A beat with three versions (created via service-role inserts into `node_versions`).
**Procedure:** Open detail panel → click `History` tab.
**Expected:** Three rows render. Top row is the newest (version 3). Each row shows version number (Inter 600 11px), timestamp, author. Current version (3) carries the star ★. **Restore button is NOT visible on any row** (Phase 6 work).

### TC-U-21 — Hover-diff preview shows added/removed text
**Spec:** Component Spec §5.11.
**Setup:** Continuation of TC-U-20. Versions 1 and 2 differ in `prose` ("hello" → "hello world").
**Procedure:** Hover over the row for version 1.
**Expected:** Tooltip appears (max 320px wide) showing diff against version 2: "world" rendered with underline (added). Token "hello" is unstyled (unchanged). On hover-out, tooltip vanishes.

### TC-U-22 — Show N more pagination loads next batch
**Spec:** API Contract §2.8; Component Spec §5.11.
**Setup:** A beat with 12 versions (more than the initial 7 shown).
**Procedure:** Open History tab. Initial 7 rows visible. Click "Show 5 more versions…" link.
**Expected:** All 12 rows now visible (initial 7 plus next batch). The "Show N more" link disappears (no more rows). Total count reflects 12.

### TC-U-23 — Empty version list shows the empty-state message
**Spec:** API Contract §5 G-1.
**Setup:** A freshly-created beat (no `node_versions` rows yet).
**Procedure:** Open History tab.
**Expected:** Empty list. Message: *"Versions are recorded when the agent revises this node. Agent operations arrive in Phase 5."* (or equivalent — the exact wording is not load-bearing as long as the user understands "no versions yet" and the reason).

### TC-U-24 — Switching to a locked node opens editors in read-only mode
**Spec:** API Contract §2.11 invariant 8.
**Setup:** Document has two beats; Beat B has `nodes.locked = TRUE`. Detail panel open on Beat A.
**Procedure:** Click Beat B in the tree.
**Expected:** Editors load Beat B's content but are read-only (Tiptap `editable: false`). A subdued banner reads "Locked — read only." No autosave fires. Switching back to Beat A restores edit mode.

---

## 3. Section 2 — Visual / Opacity State Machine Tests

These verify the steady-state and transitional opacity values prescribed by the Component Spec.

### TC-V-01 — WordCount opacity 0 while typing
**Spec:** Component Spec §5.7.
**Setup:** ProseEditor with focus.
**Procedure:** Type a character. Within 50ms, capture WordCount opacity.
**Expected:** Opacity is 0 (or computed style with display effectively hidden). The transition from "at rest" to "typing" is instant.

### TC-V-02 — WordCount fades to 0.4 after 3s of inactivity
**Spec:** Component Spec §5.7.
**Setup:** ProseEditor — type, then stop typing.
**Procedure:** Wait 3.5 seconds (3s + 800ms transition + buffer). Capture WordCount opacity.
**Expected:** Opacity within [0.35, 0.45] (target 0.4 ± tolerance for sub-pixel rendering).

### TC-V-03 — WordCount fades to 0.9 on hover
**Spec:** Component Spec §5.7.
**Setup:** ProseEditor at rest (opacity 0.4).
**Procedure:** Hover over the bottom 80px of the prose area.
**Expected:** Opacity transitions to within [0.85, 0.95] within `--duration-fast` (~120ms).

### TC-V-04 — FocusBreadcrumb maximum opacity is 0.2
**Spec:** Component Spec §6.2 (Inviolable in spec).
**Setup:** Focus Mode active.
**Procedure:** Move the mouse rapidly across the viewport. Inspect FocusBreadcrumb opacity throughout.
**Expected:** Opacity never exceeds 0.2 at any moment. Maximum observed value across a 5-second sample is ≤ 0.205 (5% tolerance for sub-pixel rounding).

### TC-V-05 — FocusBreadcrumb fades to 0 while typing
**Spec:** Component Spec §6.2.
**Setup:** Focus Mode active. Mouse still. Wait 3s — breadcrumb at opacity 0.2.
**Procedure:** Begin typing.
**Expected:** Within 50ms of the first keystroke, breadcrumb opacity is 0. Breadcrumb stays at 0 throughout typing.

### TC-V-06 — FocusBreadcrumb is `pointer-events: none`
**Spec:** Component Spec §6.2 (Inviolable).
**Setup:** Focus Mode active with breadcrumb visible.
**Procedure:** Click on the breadcrumb element directly.
**Expected:** No click event reaches the breadcrumb (CSS `pointer-events: none`). Click passes through to whatever is below (the prose area). The breadcrumb is decorative, not navigation.

### TC-V-07 — FocusEscHint fades after 5 seconds
**Spec:** Component Spec §6.3.
**Setup:** Focus Mode just entered. EscHint visible at opacity ~0.3.
**Procedure:** Wait 5.5 seconds. Capture EscHint opacity.
**Expected:** Opacity is 0 (fully faded). The transition started at ~5000ms with `--duration-slow`.

### TC-V-08 — FocusEscHint does not return on hover
**Spec:** Component Spec §6.3 (Inviolable: "Returns: Never").
**Setup:** Continuation of TC-V-07 — EscHint at opacity 0.
**Procedure:** Hover near the bottom-right corner where EscHint was.
**Expected:** EscHint opacity remains 0. No hover behaviour. The hint is a one-time entry signal, not a persistent affordance.

### TC-V-09 — ProseEditorCursor blinks at 600/400ms when idle
**Spec:** Component Spec §5.5; Brand §7.3.
**Setup:** ProseEditor with focus, no recent typing.
**Procedure:** Wait 1.5 seconds (past 1200ms typing-detection threshold). Sample cursor opacity at 100ms intervals across 2 seconds.
**Expected:** Cursor opacity oscillates between 1 (~600ms) and 0 (~400ms) per cycle, within 5% timing tolerance.

### TC-V-10 — ProseEditorCursor does not blink while typing
**Spec:** Component Spec §5.5 (Inviolable).
**Setup:** ProseEditor with focus.
**Procedure:** Type continuously for 2 seconds. Sample cursor opacity at 100ms intervals.
**Expected:** Cursor opacity is constantly 1 throughout typing. The `.is-typing` class is present on the editor element. Class clears 1200ms after the last keystroke.

### TC-V-11 — ProseEditorCursor uses verdigris colour
**Spec:** Component Spec §5.5 (verdigris use #3); Brand §7.3.
**Setup:** ProseEditor with focus.
**Procedure:** Inspect computed `caret-color` of the `.ProseMirror` element.
**Expected:** Resolves to `#3d7858` (dark mode) or `#254a38` (light mode) — the value of `--color-accent`.

### TC-V-12 — ProseEditorCursor height matches cap height of current line
**Spec:** Component Spec §5.5; Brand §7.3.
**Setup:** ProseEditor with 18px Lora text and the cursor in the line.
**Procedure:** Measure cursor height in pixels.
**Expected:** Cursor height ≈ 13px (cap height of Lora at 18px ≈ 0.71 × 18). NOT 18px (the full line-height) — the spec is explicit that the cursor matches cap height, not line height. Tolerance ±2px for browser rendering variance.

---

## 4. Section 3 — Motion / Transition Tests

### TC-M-01 — Focus Mode entry takes 280ms
**Spec:** Component Spec §6.1; Brand §9.2.
**Setup:** Detail panel open on a beat with prose. Cursor in ProseEditor.
**Procedure:** Trigger Focus Mode entry (⌘Return). Capture timing of the structural panels' opacity going from 1 → 0.
**Expected:** Transition completes within 280ms ± 50ms tolerance. Easing matches `--easing-default` (cubic-bezier(0.16, 1, 0.3, 1) — expo-out).

### TC-M-02 — Focus Mode exit takes 280ms (mirror of entry)
**Spec:** Component Spec §6.1.
**Setup:** Focus Mode active.
**Procedure:** Press Esc. Capture timing.
**Expected:** 280ms ± 50ms. Exact mirror of entry — opacity 0 → 1 on structural panels, prose column shrinks back to its panel width.

### TC-M-03 — All Focus Mode entry elements transition simultaneously
**Spec:** Component Spec §6.1.
**Setup:** Detail panel open.
**Procedure:** Trigger Focus Mode entry. Capture timestamp of opacity-change start for each of: tree, sidebar, header, detail panel. Sample at 16ms intervals.
**Expected:** All four start their transitions within the same 16ms frame. None lags more than one frame behind another.

### TC-M-04 — Sentence focus transition takes 200ms
**Spec:** Component Spec §6.5; Brand §7.5.
**Setup:** Focus Mode active. Sentence focus enabled. Three sentences in prose. Cursor in second sentence.
**Procedure:** Move cursor to first sentence. Capture timing of opacity transitions.
**Expected:** Transitions complete in 200ms ± 50ms. Easing `--easing-prose`.

### TC-M-05 — `prefers-reduced-motion: reduce` collapses Focus Mode entry to 0ms
**Spec:** Component Spec §6.1 (`⚡ Honour prefers-reduced-motion → 0ms`).
**Setup:** Test environment with `emulateMedia({ reducedMotion: 'reduce' })`.
**Procedure:** Trigger Focus Mode entry.
**Expected:** Transition is instant (≤ 16ms — one frame). All elements snap to their target positions.

### TC-M-06 — `prefers-reduced-motion: reduce` collapses sentence focus to instant
**Spec:** Component Spec §6.5 (`⚡` indicator).
**Setup:** Reduced-motion environment. Focus Mode active. Sentence focus enabled.
**Procedure:** Move cursor between sentences.
**Expected:** Opacity changes are instant (≤ 16ms). No fade.

### TC-M-07 — WordCount fade-in honours `prefers-reduced-motion`
**Spec:** Component Spec §5.7 (`⚡` indicator).
**Setup:** Reduced-motion environment. Type into prose, stop typing.
**Procedure:** Wait 3.5s.
**Expected:** WordCount jumps to 0.4 with no fade animation (≤ 16ms transition).

### TC-M-08 — Sibling navigation in Focus Mode (⌘← / ⌘→) fades prose
**Spec:** Component Spec §6.1 ("Node navigation in Focus Mode").
**Setup:** Focus Mode active on Beat 2 of three siblings. Each beat has prose.
**Procedure:** Press `⌘→` to go to Beat 3.
**Expected:** Prose fades out over ~150ms, breadcrumb updates, prose fades in over ~150ms with Beat 3's content. Total transition ~300ms. No structural chrome appears at any point during the transition.

---

## 5. Section 4 — API Integration Tests

### Convention

Each test uses a service-role-prepared fixture (User A signed in, document with one beat, optional `node_versions` rows) and exercises the route under test via `fetch` with the user's session cookie. Setup performs the prerequisite writes; the procedure issues the request under test; the expected block specifies status, body keys, and post-conditions on the database.

### 5.1 `PATCH /api/nodes/[nodeId]` — concurrency additions

#### TC-A-01 — PATCH with no `expected_version` succeeds (Phase 2 back-compat)
**Spec:** API Contract §3.1.
**Setup:** Beat with `version = 1`, `prose = null`.
**Procedure:** PATCH `{ "prose": "<json>" }` (no `expected_version`).
**Expected:** 200. Response `version = 2`. No 409 path traversed.

#### TC-A-02 — PATCH with matching `expected_version` succeeds
**Spec:** API Contract §3.1.
**Setup:** Beat with `version = 1`.
**Procedure:** PATCH `{ "prose": "<json>", "expected_version": 1 }`.
**Expected:** 200. Response `version = 2`. Prose persisted.

#### TC-A-03 — PATCH with stale `expected_version` returns 409
**Spec:** API Contract §3.1 / §2.3.
**Setup:** Beat with `version = 3` (server has been edited to 3 via service role).
**Procedure:** PATCH `{ "prose": "<new>", "expected_version": 1 }`.
**Expected:** 409 `version_conflict`. Body contains `{ "error": "version_conflict", "message": "...", "current": <full node body with version=3> }`. DB unchanged (the prose is still the version-3 prose, not the request body's prose).

#### TC-A-04 — PATCH with future `expected_version` returns 409
**Spec:** API Contract §3.1.
**Setup:** Beat with `version = 1`.
**Procedure:** PATCH `{ "prose": "<new>", "expected_version": 99 }`.
**Expected:** 409. The mismatch is symmetric — server returns 409 for *any* non-equal value, not just stale ones. The future-version case prevents a malicious or buggy client from short-circuiting concurrency by sending a deliberately-wrong-but-larger value.

#### TC-A-05 — PATCH with `expected_version = 0` returns 400
**Spec:** API Contract §2.5.
**Setup:** Any beat.
**Procedure:** PATCH `{ "prose": "<x>", "expected_version": 0 }`.
**Expected:** 400 `invalid_expected_version`. The minimum valid value is 1 (a fresh row's `version` per Migration 020 is 1).

#### TC-A-06 — PATCH with non-integer `expected_version` returns 400
**Spec:** API Contract §2.5.
**Procedure:** PATCH `{ "expected_version": "1" }` (string).
**Expected:** 400 `invalid_expected_version`. Strict-type validation per Phase 2's Zod conventions.

#### TC-A-07 — PATCH with `version` field returns 400 unknown_field
**Spec:** API Contract §2.5.
**Procedure:** PATCH `{ "prose": "<x>", "version": 5 }`.
**Expected:** 400 `unknown_field` with message naming `version`. The field is server-managed; clients cannot send it.

#### TC-A-08 — PATCH renaming a node does not bump version
**Spec:** Migration 023 trigger; TA v1.5 §3.6.
**Setup:** Beat with `version = 1`, `name = "old"`.
**Procedure:** PATCH `{ "name": "new", "expected_version": 1 }`.
**Expected:** 200. Response `version = 1` (unchanged — `name` is not a content field). No version bump per Migration 023.

#### TC-A-09 — PATCH changing both name and prose bumps version exactly once
**Spec:** Migration 023; API Contract §2.6.
**Setup:** Beat with `version = 1`.
**Procedure:** PATCH `{ "name": "new", "prose": "<x>", "expected_version": 1 }`.
**Expected:** 200. Response `version = 2` (single bump per UPDATE; the trigger fires once and detects a content change among the four content fields).

#### TC-A-10 — PATCH changing only metadata bumps version
**Spec:** Migration 023.
**Procedure:** PATCH `{ "metadata": {"k":"v"}, "expected_version": 1 }`.
**Expected:** 200. Response `version = 2`.

#### TC-A-11 — PATCH with same content (no actual change) does not bump
**Spec:** Migration 023 (`IS DISTINCT FROM` semantics).
**Setup:** Beat with `prose = "x"`, `version = 1`.
**Procedure:** PATCH `{ "prose": "x", "expected_version": 1 }`.
**Expected:** 200. Response `version = 1`. The trigger's `IS DISTINCT FROM` returns false because OLD and NEW are equal.

#### TC-A-12 — PATCH on locked node returns 423 (beats 409)
**Spec:** API Contract §2.4.
**Setup:** Beat with `locked = TRUE` and `version = 5`.
**Procedure:** PATCH `{ "prose": "<x>", "expected_version": 1 }` (intentionally stale).
**Expected:** 423 `node_locked` (NOT 409). The lock check happens before the version check; the 423 wins.

#### TC-A-13 — PATCH with all-null content fields and matching version returns 200
**Spec:** API Contract §2.5.
**Setup:** Beat with `summary != null`, `version = 1`.
**Procedure:** PATCH `{ "summary": null, "expected_version": 1 }`.
**Expected:** 200. Response `version = 2` (NULL transition is `IS DISTINCT FROM` per Migration 023).

#### TC-A-14 — PATCH with no settable fields returns 400
**Spec:** API Contract §3.1 step 8.
**Procedure:** PATCH `{ "expected_version": 1 }` (only the concurrency token, no content / metadata changes).
**Expected:** 400 `missing_body`.

#### TC-A-15 — PATCH on non-existent node returns 404
**Procedure:** PATCH `/api/nodes/<random uuid>` with valid body.
**Expected:** 404 `not_found`.

#### TC-A-16 — PATCH with `prose` exceeding 2,000,000 chars returns 400
**Spec:** API Contract §2.5 / G-2.
**Procedure:** PATCH `{ "prose": "<2,000,001 chars>" }`.
**Expected:** 400 `invalid_prose`.

### 5.2 `GET /api/nodes/[nodeId]/versions` — list

#### TC-A-17 — GET versions returns paginated list, newest first
**Spec:** API Contract §3.2.
**Setup:** Beat with 5 `node_versions` rows (versions 1, 2, 3, 4, 5).
**Procedure:** GET `/api/nodes/[id]/versions`.
**Expected:** 200. `{ versions: [v5, v4, v3, v2, v1], total: 5, has_more: false }`. Order is `version DESC`. `summary`/`prose`/`notes`/`metadata` are NOT in each row (list mode omits content per §2.13).

#### TC-A-18 — GET versions with limit
**Procedure:** GET `?limit=2`.
**Expected:** 200. `{ versions: [v5, v4], total: 5, has_more: true }`.

#### TC-A-19 — GET versions with offset
**Procedure:** GET `?limit=2&offset=2`.
**Expected:** 200. `{ versions: [v3, v2], total: 5, has_more: true }`.

#### TC-A-20 — GET versions exceeds total
**Procedure:** GET `?limit=10&offset=10` (only 5 rows exist).
**Expected:** 200. `{ versions: [], total: 5, has_more: false }`.

#### TC-A-21 — GET versions with limit > 100 returns 400
**Spec:** API Contract §2.8.
**Procedure:** GET `?limit=500`.
**Expected:** 400 `invalid_query`.

#### TC-A-22 — GET versions with negative offset returns 400
**Procedure:** GET `?offset=-1`.
**Expected:** 400 `invalid_query`.

#### TC-A-23 — GET versions on node with zero versions returns empty
**Spec:** API Contract §5 G-1.
**Setup:** A freshly-created beat with no agent operations run.
**Procedure:** GET `/api/nodes/[id]/versions`.
**Expected:** 200. `{ versions: [], total: 0, has_more: false }`.

#### TC-A-24 — GET versions on non-existent node returns 404
**Procedure:** GET `/api/nodes/<random uuid>/versions`.
**Expected:** 404 `not_found`.

### 5.3 `GET /api/nodes/[nodeId]/versions/[versionNumber]` — single version

#### TC-A-25 — GET single version returns full content
**Spec:** API Contract §3.3 / §2.13.
**Setup:** Beat with `node_versions` row at `version = 3` containing `summary`, `prose`, `notes`.
**Procedure:** GET `/api/nodes/[id]/versions/3`.
**Expected:** 200. Body includes all content fields. Shape per §2.13.

#### TC-A-26 — GET single version that does not exist returns 404
**Spec:** API Contract §3.3.
**Setup:** Beat with versions 1, 2, 3.
**Procedure:** GET `/api/nodes/[id]/versions/99`.
**Expected:** 404 `version_not_found`.

#### TC-A-27 — GET single version on non-existent node returns 404 not_found
**Spec:** API Contract §3.3.
**Procedure:** GET `/api/nodes/<random>/versions/1`.
**Expected:** 404 `not_found` (the *node* 404, not `version_not_found` — no version-existence leakage for an inaccessible node).

#### TC-A-28 — GET single version with non-numeric version returns 400
**Procedure:** GET `/api/nodes/[id]/versions/abc`.
**Expected:** 400 `invalid_version_number`.

#### TC-A-29 — GET single version with version=0 returns 400
**Procedure:** GET `/api/nodes/[id]/versions/0`.
**Expected:** 400 `invalid_version_number` (minimum is 1).

### 5.4 Cross-cutting

#### TC-A-30 — 423 beats 409 ordering verified
**Spec:** API Contract §2.4 (explicit ordering note).
**Setup:** Beat at `version = 5`, `locked = TRUE`.
**Procedure:** PATCH with stale `expected_version = 1`.
**Expected:** 423 `node_locked`. Test asserts the response code AND that no 409 path was taken (no `current` field in the body).

#### TC-A-31 — `parent_locked` returns 423 on a content edit
**Spec:** API Contract §2.4.
**Setup:** Beat with `locked = FALSE`. Its parent chapter has `locked = TRUE`.
**Procedure:** PATCH on the beat with valid content.
**Expected:** 423 `parent_locked`.

#### TC-A-32 — PATCH at the moment of a server-side trigger update is consistent
**Spec:** API Contract §2.6.
**Setup:** Beat at `version = 1`. PATCH-1 in flight (writing `prose = "a"`). 
**Procedure:** Issue PATCH-2 with `expected_version = 1` immediately (before PATCH-1 returns).
**Expected:** PATCH-1 returns 200 with `version = 2`. PATCH-2 returns 409 (because `expected_version` is now stale; server has version 2). Both responses are consistent — no torn writes, no lost updates.

---

## 6. Section 5 — Authorisation Boundary Tests

### TC-B-01 — User B cannot PATCH User A's node
**Setup:** User A has a beat. User B signs in.
**Procedure:** User B PATCHes Beat A.
**Expected:** 404 `not_found` (RLS hides existence; 403 is never returned).

### TC-B-02 — User B cannot list versions of User A's node
**Procedure:** User B GETs `/api/nodes/[A's beat]/versions`.
**Expected:** 404 `not_found`.

### TC-B-03 — User B cannot read a single version of User A's node
**Procedure:** User B GETs `/api/nodes/[A's beat]/versions/1`.
**Expected:** 404 `not_found` (the node-level 404, not `version_not_found`).

### TC-B-04 — Anonymous PATCH returns 401
**Procedure:** PATCH without session.
**Expected:** 401 `unauthorised`.

### TC-B-05 — Anonymous GET versions returns 401
**Procedure:** GET `/api/nodes/[id]/versions` without session.
**Expected:** 401 `unauthorised`.

### TC-B-06 — Anonymous GET single version returns 401
**Procedure:** GET `/api/nodes/[id]/versions/1` without session.
**Expected:** 401 `unauthorised`.

### TC-B-07 — User B cannot bypass RLS via service-role-shaped request
**Procedure:** User B forges a request with a non-session header.
**Expected:** 401 (no service-role headers honoured from public requests).

### TC-B-08 — `expected_version` cannot leak existence of inaccessible nodes
**Setup:** User A has a beat at `version = 3`. User B signs in.
**Procedure:** User B PATCHes the beat ID with `expected_version = 1` and content body.
**Expected:** 404 `not_found`. The 404 path runs before the version check; User B cannot infer existence (let alone the version) of User A's node by observing the error code distribution.

---

## 7. Section 6 — Data Integrity Tests

These verify Migration 023's behaviour end-to-end through PATCH (Phase 2 tested the trigger directly with SQL; Phase 3 verifies it from the user-facing endpoint).

### TC-D-01 — Content change bumps `nodes.version` by exactly 1
**Setup:** Beat at `version = 1`.
**Procedure:** PATCH `{ "prose": "<x>" }`.
**Expected:** Read `nodes.version` after — equals 2. Reading via service role (bypassing API caching): also 2.

### TC-D-02 — Non-content change does not bump `nodes.version`
**Setup:** Beat at `version = 5`.
**Procedure:** PATCH `{ "name": "new" }`. Read DB.
**Expected:** `nodes.version = 5` (unchanged).

### TC-D-03 — Sequence of mixed PATCHes produces correct version trajectory
**Setup:** Beat at `version = 1`.
**Procedure:** PATCH `{ "prose": "a" }` → PATCH `{ "name": "b" }` → PATCH `{ "summary": "c" }` → PATCH `{ "metadata": {} }` (no change, was already `{}`).
**Expected:** Final `nodes.version = 3`. Bumps occurred on PATCH 1 (prose) and PATCH 3 (summary). No bump on PATCH 2 (name only) or PATCH 4 (metadata unchanged via `IS DISTINCT FROM`).

### TC-D-04 — `nodes.updated_at` advances on every PATCH
**Setup:** Beat at known timestamp.
**Procedure:** PATCH `{ "name": "x" }` (non-content change).
**Expected:** `updated_at` strictly greater than pre-PATCH timestamp. (Confirms the trigger does not interfere with `updated_at` semantics.)

### TC-D-05 — Concurrent PATCHes from same client are serialised by single-flight
**Setup:** Client harness issues two PATCHes within 10ms (artificially bypassing single-flight).
**Procedure:** Race them via `Promise.all`. Each carries `expected_version = 1`.
**Expected:** Exactly one returns 200 with `version = 2`; the other returns 409. No torn writes — DB reflects exactly one of the two payloads.

### TC-D-06 — Service-role PATCH bypasses `expected_version` (Phase 5 path)
**Setup:** Beat at `version = 5`.
**Procedure:** Service-role client PATCHes with no `expected_version` (Phase 5 agent-job path).
**Expected:** 200. Write succeeds regardless of any version stale-ness because no check was requested. Confirms the optional nature of `expected_version` does not block agent jobs.

---

## 8. Section 7 — Accessibility Tests

### TC-AX-01 — Tab key cycles through editors and tabs in order
**Spec:** Component Spec §15.2.
**Setup:** Detail panel open, focus at the panel's first focusable element.
**Procedure:** Press Tab repeatedly.
**Expected:** Focus order: tabs (Content, Agent, Comments, History, Context) → SummaryEditor → ProseEditor → NotesEditor → FocusModeButton → first tab again. Each Tab moves to the next item; Shift+Tab moves backward.

### TC-AX-02 — Focus Mode entry preserves keyboard focus inside the editor
**Spec:** Component Spec §6.1.
**Setup:** ProseEditor focused.
**Procedure:** Trigger Focus Mode.
**Expected:** Inside Focus Mode, keyboard focus remains in ProseEditor. Typing immediately after entry inserts into the editor. The 280ms transition does not cause focus loss.

### TC-AX-03 — FocusBreadcrumb has `aria-hidden="true"`
**Spec:** Component Spec §6.2.
**Setup:** Focus Mode active.
**Procedure:** Inspect the breadcrumb element's ARIA attributes.
**Expected:** `aria-hidden="true"`. Screen readers do not announce it (it's a decorative location marker, not navigation).

### TC-AX-04 — Conflict banner is announced via `role="alert"` or live region
**Spec:** API Contract §2.11; Component Spec §15.4.
**Setup:** Trigger TC-U-08 conflict scenario in a Playwright run with screen-reader emulation.
**Procedure:** When the banner appears, capture the role and text of any live-region announcement.
**Expected:** Banner has `role="alert"` (or is wrapped in `aria-live="assertive"` region). Screen reader announces "This node was edited elsewhere" or equivalent.

### TC-AX-05 — Reduced-motion users do not lose orientation on Focus Mode transition
**Spec:** Component Spec §15.5.
**Setup:** Reduced-motion environment.
**Procedure:** Trigger Focus Mode entry.
**Expected:** All elements snap to their target positions in ≤ 16ms. No partial-state frames where the user might lose orientation. Cursor position preserved (TC-AX-02 holds).

### TC-AX-06 — Keyboard-only user can complete a write-and-save cycle
**Setup:** No mouse — keyboard only. User A signed in. Tree has a beat.
**Procedure:** Tab to the beat row. Enter to open. Tab to ProseEditor. Type a sentence. Wait 1.5s. Confirm autosave persisted (re-open the node).
**Expected:** Full write flow completes via keyboard alone. No mouse-only affordance blocks the path.

---

## 9. Verdict Criteria

Phase 3 PASSES if and only if **every** test case above resolves to PASS, AND the Phase 3 checkpoint criterion holds:

> "Can write content; versions created (Phase 2 trigger) and browsable with hover diff in this phase. Restore is Phase 6."

Concretely:

1. All 24 UI checkpoint tests (TC-U-01 through TC-U-24) pass.
2. All 12 visual / opacity tests (TC-V-01 through TC-V-12) pass.
3. All 8 motion / transition tests (TC-M-01 through TC-M-08) pass.
4. All 32 API integration tests (TC-A-01 through TC-A-32) pass.
5. All 8 authorisation boundary tests (TC-B-01 through TC-B-08) pass.
6. All 6 data integrity tests (TC-D-01 through TC-D-06) pass.
7. All 6 accessibility tests (TC-AX-01 through TC-AX-06) pass.

**Total: 96 test cases.**

Any failure is recorded in the Phase 3 Test Report with: severity, classification (specification gap / specification error / implementation gap / environment issue), root-cause analysis, fix applied, and re-test result. A FAIL verdict is permitted to convert to PASS only after re-test.

**No Phase 3 fix may modify a test case to make it pass.** If a test reveals an ambiguity in the API Contract, the Component Spec, or the Brand Identity, the relevant document is updated (with a version bump) and the test is regenerated from the updated spec — never the other way round.

---

## 10. Out of Scope for Phase 3 Tests

Tests for the following are explicitly out of scope and are deferred to their relevant phase:

- Version restore (Phase 6 — TC-U-20 verifies the Restore button is *not* rendered, but no restore action is exercised).
- Editorial comments (Phase 5).
- Agent operations on nodes — Expand, Refine, Synthesise, Critique (Phase 5). Phase 3 does not exercise the agent system; the History tab's empty state acknowledges this (TC-U-23).
- `node_versions` row creation. Phase 3 only tests reading the table; the trigger that populates it is Phase 5's responsibility (G-1 in the API Contract).
- Context node CRUD, scope, linking (Phase 4).
- Real-time lock-state updates. Phase 3 ships the lock check (a 423 surfaces a read-only banner) but does not subscribe to lock-state changes via Supabase Realtime (per API Contract §2.11 invariant 8).
- DOCX / PDF / EPUB export (Phase 7).
- Multi-tenant collaboration UX (V2).
- BYOK API key surfaces (V2).
- Cross-browser drag-and-drop edge cases on tablets — Component Spec §11 tablet layout is not exercised by Phase 3 tests; tablet-specific verification is deferred to Phase 8 polish.

These are listed here so the absence of related tests in Phase 3 is intentional, not an oversight.

---

## 11. Approval

This Test Plan is approved before any implementation begins. Changes after approval are version-bumped on this document. The Test Plan is the authoritative tester's reference for Phase 3.

---

## 12. Changelog

**v1.0 — 2026-05-04** Initial Phase 3 Pre-Phase Test Plan. 96 test cases across UI checkpoint (24), visual / opacity state-machine (12 — new category for Phase 3), motion / transition (8 — new category for Phase 3), API integration (32), authorisation boundary (8), data integrity (6), accessibility (6). Derived from `stelavox_phase3_api_contract_v1_0.md` v1.0 and the Phase 3 checkpoint criterion in Technical Architecture v1.5 §11. Out-of-scope categories enumerated to make absences explicit (version restore, agent operations, `node_versions` row creation, context nodes, real-time lock state, export, V2 features).
