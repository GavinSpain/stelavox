# Stelavox — Phase 5d Test Plan
## Version 1.0

> **Tier-B per-phase document.** Frozen for Phase 5d build. Companion to `stelavox_phase5d_build_checklist_v1_0.md` and `stelavox_phase5d_qa_strategy_v1_0.md`. Enumerates every End-to-End test case for Phase 5d by surface × move × axis. Phase 5d is a cross-cutting confidence-builder layered over Phase 1-5c substrate, **not** a launch gate. Cross-cutting test conventions are inherited from Phase 5b's Test Plan and not restated.

**Phase:** 5d — Quality Assurance & End-to-End Confidence.

**Methodology.** Local-first. Author the suite + iterate against local dev. Vercel becomes a smoke-subset only after local proves clean. Every happy path has at least one matching sad-path case. Every PR that adds a feature must include its own Phase 5d cases. Red CI on the suite blocks merges.

---

## 1. Scope

### 1.1 What's tested

Phase 5d treats the application as a black box of **surfaces** (places the user looks) and **moves** (atomic actions the user performs from a surface). For every (surface, move) cell that's reachable in the V1 product, Phase 5d enumerates at least one happy-path case and at least one sad-path case. Coverage emphasis falls on the **integration seams** — the boundaries where two substrate components meet — because that's where Phase 5c's post-merge bugs lived (CSP/realtime, plain-text/Tiptap, profile resolution, XML leak).

Specifically:

- **Cross-feature regression** — no change in J5 (agent ops) breaks J3 (manual authoring) or J6 (Director).
- **Cloud-vs-local equivalence** — every CSP / Vercel-runtime / Realtime-WebSocket dependency is verified once on `stelavox-dev` so that Vercel-only failures (Phase 5c bug #1) surface in CI, not user testing.
- **Test-data isolation** — every test owns its own document; cleans up regardless of pass/fail. (SU-50 was the lesson.)
- **Workflow-dispatched paths and user-clicked paths share an outcome contract** — Phase 5c bug #4 was the workflow path skipping a transformation the user-clicked path did. Phase 5d asserts the contract on both.

### 1.2 What's not tested

- **LLM prose quality.** Voice fidelity, narrative quality, "is this prose good?" — different discipline. The Director eval methodology (`docs/stelavox_director_eval_methodology_v1_0.md`) covers this for the Director; agent-prose quality is an upstream-spec / agent-profile-tuning concern, not a Phase 5d gate.
- **Performance benchmarking.** Phase 5d asserts wall-time **upper bounds** on user-visible surfaces (e.g. "tree renders within 2s") but doesn't track regression deltas across runs. Performance regression is Phase 8.
- **Visual baselines for animated/streaming surfaces.** Streaming text, typewriter motion, breadcrumb fade, plan-card live edits — these are excluded from the screenshot-baseline set in J10 because pixel diffs would be noise. Static states only.
- **A11y auditing beyond what Phase 1-5c shipped.** Phase 5d re-runs the existing AX cases as part of cross-feature regression but does not add new AX coverage. AX expansion is Phase 8.
- **Multi-user concurrency stress.** Two authors editing the same document in parallel is a V2 surface. Phase 5d's lock cases use a single user's two-tab simulation only.
- **Mobile breakpoints.** V1 ships desktop-first; the responsive states are stubbed in Component Spec but not built. Phase 5d targets desktop only.

### 1.3 Test models

Per `feedback_haiku_default.md` user-preference memory: all Phase 5d testing defaults to Haiku 4.5. Sonnet 4.6 / Opus 4.7 are touched only by the cross-model regression cases in J5/J6/J7 (carry-forward from Phase 5b/5c — re-run on the existing probe set, no new probes).

### 1.4 Multi-session structure

Phase 5d ships across multiple sessions (estimated 6-12). The Tier-B trilogy (this Test Plan + Build Checklist + QA Strategy) is session 1. Each subsequent session implements one Journey (J1-J10). Sessions can ship to master independently as Phase 5d sub-merges (`Phase 5d.J3 — manual authoring journey`) once that journey's CK passes.

---

## 2. Surface taxonomy

A **surface** is a place the user looks at to perform work. Each surface has a stable identity (a route, a panel, a tab, a modal, a mode). Phase 5d enumerates surfaces, not screens, because a surface is the right granularity for the (surface, move) matrix — multiple surfaces share a screen.

### 2.1 Auth surfaces (J1)

| ID | Surface | Route / mount | V1 |
|---|---|---|---|
| S-AUTH-01 | Login form | `/login` | ✓ |
| S-AUTH-02 | Signup form | `/signup` | ✓ |
| S-AUTH-03 | Forgot-password form | `/forgot-password` | ✓ |
| S-AUTH-04 | Reset-password form | `/reset-password` (token gated) | ✓ |
| S-AUTH-05 | Email-verification flow | Inbucket-driven in test; landing on `/auth/callback` in prod | ✓ |

### 2.2 Project shell surfaces (J1, J2)

| ID | Surface | Route / mount | V1 |
|---|---|---|---|
| S-PROJ-01 | Dashboard (project list) | `/dashboard` | ✓ |
| S-PROJ-02 | Project detail (document list + members) | `/projects/[projectId]` | ✓ |
| S-PROJ-03 | New-project flow | Modal from S-PROJ-01 | ✓ |
| S-PROJ-04 | New-document flow | Modal from S-PROJ-02 | ✓ |

### 2.3 Document editor — global surfaces (J3 baseline)

| ID | Surface | Mount | V1 |
|---|---|---|---|
| S-DOC-01 | AppShell (header + sidebar + main + detail panel slots) | `(app)/projects/[projectId]/documents/[documentId]/page.tsx` | ✓ |
| S-DOC-02 | HeaderBreadcrumb | AppShell header | ✓ |
| S-DOC-03 | ModeTabBar (Edit / Director / Focus Mode) | AppShell header right | ✓ |
| S-DOC-04 | Sidebar (project nav, recent docs) | AppShell left | ✓ |
| S-DOC-05 | NodeTree (the spine) | AppShell main, Edit mode | ✓ |
| S-DOC-06 | NodeRow (per-row interactive surface inside NodeTree) | NodeTree row | ✓ |
| S-DOC-07 | NodeMoreMenu (kebab menu) | Per-row hover popover | ✓ |
| S-DOC-08 | LayerDivider (between layer levels) | NodeTree | ✓ |

### 2.4 Document editor — Detail Panel surfaces (J3 detail, J4, J5, J6)

| ID | Surface | Mount | V1 |
|---|---|---|---|
| S-DET-01 | NodeDetailPanel (right slot when Edit mode) | AppShell detail | ✓ |
| S-DET-02 | TabStrip (Edit / Notes / Context / Agent / History) | NodeDetailPanel header | ✓ |
| S-DET-03 | SummaryEditor | Edit tab, all node types | ✓ |
| S-DET-04 | NotesEditor | Notes tab, all node types | ✓ |
| S-DET-05 | MetadataForm (Character / Setting / etc.) | Edit tab, context nodes only | ✓ |
| S-DET-06 | ProseEditor | Edit tab, leaf nodes only (`is_leaf===true`) | ✓ |
| S-DET-07 | WordCount + FocusModeButton | Beside ProseEditor | ✓ |
| S-DET-08 | SelectionTooltip (Bold / Italic / Link) | Floating over ProseEditor selection | ✓ |
| S-DET-09 | AgentTab | Agent tab | ✓ |
| S-DET-10 | AgentJobHistory | Agent tab, secondary panel | ✓ |
| S-DET-11 | ContextTab + ContextLinker | Context tab | ✓ |
| S-DET-12 | BackLinksList | Context tab, secondary panel | ✓ |
| S-DET-13 | HistoryTab + VersionHistory | History tab | ✓ |
| S-DET-14 | CommentThread | Floating beside selection or anchor | ✓ |
| S-DET-15 | ConflictBanner (lock / version conflict) | NodeDetailPanel header | ✓ |

### 2.5 Focus Mode surfaces (J3)

| ID | Surface | Mount | V1 |
|---|---|---|---|
| S-FOC-01 | FocusMode overlay | Portal to `document.body` | ✓ |
| S-FOC-02 | FocusBreadcrumb | Inside FocusMode top | ✓ |
| S-FOC-03 | FocusEscHint | Inside FocusMode bottom | ✓ |
| S-FOC-04 | TypewriterContainer (the prose surface in Focus) | Inside FocusMode | ✓ |
| S-FOC-05 | SentenceFocus | Phase 8 — deferred | ✗ |

### 2.6 Director surfaces (J6)

| ID | Surface | Mount | V1 |
|---|---|---|---|
| S-DIR-01 | DirectorPanel (right slot when Director mode) | AppShell detail | ✓ |
| S-DIR-02 | ConversationThread | DirectorPanel scroll body | ✓ |
| S-DIR-03 | UserMessage | Inside ConversationThread | ✓ |
| S-DIR-04 | DirectorMessage (text bubble) | Inside ConversationThread | ✓ |
| S-DIR-05 | ThinkingIndicator | Inside ConversationThread when streaming | ✓ |
| S-DIR-06 | PlanCard | Inside DirectorMessage when proposal present | ✓ |
| S-DIR-07 | ExecutionCard | Inside DirectorMessage when workflow live | ✓ |
| S-DIR-08 | DirectorInput (textarea + @-mention picker) | DirectorPanel footer | ✓ |
| S-DIR-09 | NodePicker (@-mention popover) | Floating over DirectorInput | ✓ |

### 2.7 Streaming agent surfaces (J7)

| ID | Surface | Mount | V1 |
|---|---|---|---|
| S-STR-01 | AgentTab streaming surface (synthesise) | Inside AgentTab when SSE active | ✓ |
| S-STR-02 | AgentTab cancel control | Beside S-STR-01 | ✓ |
| S-STR-03 | AgentTab post-stream accept/dismiss | Replaces S-STR-01 on `agent_job_complete` | ✓ |

### 2.8 Cross-cutting / system surfaces (J8, J9)

| ID | Surface | Mount | V1 |
|---|---|---|---|
| S-SYS-01 | Toast / ToastManager | Portal | ✓ |
| S-SYS-02 | Modal (overlay base) | Portal | ✓ |
| S-SYS-03 | CommandPalette | Cmd+K / Ctrl+K | (not yet — verify presence in code before targeting) |
| S-SYS-04 | NodeStatusBadge | NodeRow + NodeDetailPanel header | ✓ |
| S-SYS-05 | AgentActivityIndicator | NodeRow when job running | ✓ |
| S-SYS-06 | TrialExpiryModal | Triggered by subscription state | ✓ (Phase 1) |

---

## 3. Move taxonomy

A **move** is an atomic user action initiated from a surface. Moves are surface-agnostic in their categorisation (e.g. "click button" applies to every surface with a button) but each move carries a contract — the post-condition that must hold after a successful execution. The matrix in §4 names which surface × move cells are tested.

### 3.1 Navigation moves

| ID | Move | Atom |
|---|---|---|
| M-NAV-01 | Visit URL directly | `page.goto(url)` |
| M-NAV-02 | Click breadcrumb segment | `page.click(breadcrumb)` |
| M-NAV-03 | Click sidebar entry | `page.click(sidebar item)` |
| M-NAV-04 | Switch ModeTab (Edit ↔ Director ↔ Focus Mode) | `page.click(mode tab)` |
| M-NAV-05 | Switch DetailPanel TabStrip | `page.click(tab)` |
| M-NAV-06 | Browser back / forward | `page.goBack/goForward` |

### 3.2 Auth moves

| ID | Move | Atom |
|---|---|---|
| M-AUTH-01 | Submit signup form | fill+click |
| M-AUTH-02 | Confirm email link from Inbucket | mailbox poll + click |
| M-AUTH-03 | Submit login form | fill+click |
| M-AUTH-04 | Submit forgot-password | fill+click |
| M-AUTH-05 | Submit reset-password | fill+click |
| M-AUTH-06 | Logout from header | click |

### 3.3 Tree moves

| ID | Move | Atom |
|---|---|---|
| M-TREE-01 | Select a node (click row) | click |
| M-TREE-02 | Expand/collapse a parent node | click chevron |
| M-TREE-03 | Drag-drop reorder (sibling) | drag |
| M-TREE-04 | Drag-drop reparent | drag |
| M-TREE-05 | Open NodeMoreMenu (kebab) | click |
| M-TREE-06 | Add child via more-menu | click + form |
| M-TREE-07 | Delete node via more-menu (with confirm) | click + confirm |
| M-TREE-08 | Rename node via inline-edit | dbl-click + type + Enter |
| M-TREE-09 | Mark/unmark as context node | click + toggle (where supported) |

### 3.4 Editor moves

| ID | Move | Atom |
|---|---|---|
| M-EDIT-01 | Type text into SummaryEditor | type |
| M-EDIT-02 | Type text into NotesEditor | type |
| M-EDIT-03 | Type text into ProseEditor | type |
| M-EDIT-04 | Paste content (plain or rich) | clipboard inject |
| M-EDIT-05 | Undo / Redo (Ctrl/Cmd+Z, +Shift+Z) | keystroke |
| M-EDIT-06 | Bold / Italic / Link toggle (keyboard) | keystroke |
| M-EDIT-07 | Bold / Italic / Link toggle (SelectionTooltip) | click |
| M-EDIT-08 | Trigger autosave (idle 2s after type) | wait |
| M-EDIT-09 | Title inline-edit (Save on blur) | click + type + blur |
| M-EDIT-10 | MetadataForm field edit (context nodes) | type + blur |

### 3.5 Focus Mode moves

| ID | Move | Atom |
|---|---|---|
| M-FOC-01 | Enter Focus Mode (click FocusModeButton) | click |
| M-FOC-02 | Exit Focus Mode (Esc) | keystroke |
| M-FOC-03 | Type in Focus prose surface | type |
| M-FOC-04 | Hover breadcrumb to peek opacity | hover |

### 3.6 Agent moves (J5, J7)

| ID | Move | Atom |
|---|---|---|
| M-AGT-01 | Open AgentTab | tab click |
| M-AGT-02 | Select agent profile from dropdown | select |
| M-AGT-03 | Type agent instruction | type |
| M-AGT-04 | Click Synthesise (streaming) | click → SSE |
| M-AGT-05 | Click Expand | click → background job |
| M-AGT-06 | Click Refine | click → background job |
| M-AGT-07 | Click Generate Context | click → background job |
| M-AGT-08 | Cancel running job | click |
| M-AGT-09 | Accept completed job | click |
| M-AGT-10 | Dismiss completed job | click |
| M-AGT-11 | View past job in AgentJobHistory | click |

### 3.7 Director moves (J6)

| ID | Move | Atom |
|---|---|---|
| M-DIR-01 | Type Director message | type |
| M-DIR-02 | Open NodePicker via @ | type `@` |
| M-DIR-03 | Select node from NodePicker | click |
| M-DIR-04 | Send Director message (Enter) | keystroke → SSE |
| M-DIR-05 | Newline in Director input (Shift+Enter) | keystroke |
| M-DIR-06 | Approve plan (PlanCard Approve) | click |
| M-DIR-07 | Toggle plan-step checkbox | click |
| M-DIR-08 | Cancel plan (before approve) | click |
| M-DIR-09 | Pause workflow execution | click |
| M-DIR-10 | Resume paused workflow | click |
| M-DIR-11 | Stop running workflow | click |
| M-DIR-12 | Resume after page refresh (mid-turn / mid-execution) | reload |

### 3.8 Comment moves (J3, J4)

| ID | Move | Atom |
|---|---|---|
| M-CMT-01 | Open CommentThread on a selection | click |
| M-CMT-02 | Post a comment | type + Enter |
| M-CMT-03 | Resolve a comment | click |
| M-CMT-04 | Reply in thread | type + Enter |

### 3.9 Context moves (J4)

| ID | Move | Atom |
|---|---|---|
| M-CTX-01 | Link a context node from ContextLinker | search + click |
| M-CTX-02 | Unlink a context node | click X |
| M-CTX-03 | Inspect propagation (Settings → linked nodes appear) | navigate |
| M-CTX-04 | Generate context node via agent | click → background job |

### 3.10 Version moves (J3)

| ID | Move | Atom |
|---|---|---|
| M-VER-01 | Open HistoryTab | tab click |
| M-VER-02 | Browse version list | scroll/click |
| M-VER-03 | Hover diff preview on a version | hover |
| M-VER-04 | (Restore — Phase 6, not Phase 5d) | — |

### 3.11 Lock moves (J8)

| ID | Move | Atom |
|---|---|---|
| M-LCK-01 | Acquire a lock (open editor) | implicit |
| M-LCK-02 | Release a lock (close / blur away) | implicit |
| M-LCK-03 | Encounter a conflict (second tab / stale) | trigger |
| M-LCK-04 | Resolve a conflict via ConflictBanner | click |

### 3.12 System moves (J8, J9)

| ID | Move | Atom |
|---|---|---|
| M-SYS-01 | Resize PanelResizer | drag |
| M-SYS-02 | Open Modal / dismiss with Esc | click + key |
| M-SYS-03 | Acknowledge Toast | click X |
| M-SYS-04 | Open CommandPalette (Cmd+K) | keystroke (where present) |
| M-SYS-05 | Trigger TrialExpiryModal (subscription state) | seed + reload |

---

## 4. Test case matrix

The matrix is presented per Journey (J1-J10). Each Journey block has a table:

- **TC ID** — `TC-J{n}-{nn}` numbered within the journey
- **Surface** — from §2 taxonomy
- **Move** — from §3 taxonomy
- **Axis** — Happy / Common-sad / Security-sad
- **Description** — what the test does
- **LLM cost** — only for cases that touch the API ($0 otherwise)
- **Cloud-smoke?** — `Y` if this case is on the Vercel smoke subset; `N` otherwise

Cross-Journey cells (e.g. M-NAV-04 from any document mode) are tested once per Journey if they're load-bearing for that Journey's flow, **not** once per surface — that would explode case count without adding signal. Phase 5d's QA Strategy §3 explains the rule.

### 4.1 J1 — Onboarding (signup → org → first project)

Phase 5d inherits Phase 1's TC-U-* and TC-A-* shape; J1 re-runs the user journey end-to-end.

| TC ID | Surface | Move | Axis | Description | LLM | Cloud |
|---|---|---|---|---|---|---|
| TC-J1-01 | S-AUTH-02 | M-AUTH-01 | Happy | Submit valid signup form; email arrives in Inbucket; click verification link; org auto-provisioned; redirected to /dashboard | $0 | N |
| TC-J1-02 | S-AUTH-02 | M-AUTH-01 | Common-sad | Submit signup with existing email; surface "email already in use" error; no row created | $0 | N |
| TC-J1-03 | S-AUTH-02 | M-AUTH-01 | Common-sad | Submit signup with weak password; surface validation; no submission | $0 | N |
| TC-J1-04 | S-AUTH-02 | M-AUTH-01 | Security-sad | Inject SQL/XSS in name field; sanitised; account creates with literal text | $0 | N |
| TC-J1-05 | S-AUTH-03 | M-AUTH-04 | Happy | Submit valid email; reset email arrives; click; reset form loads | $0 | N |
| TC-J1-06 | S-AUTH-03 | M-AUTH-04 | Common-sad | Submit unknown email; UI does not leak existence (always-success message) | $0 | N |
| TC-J1-07 | S-AUTH-04 | M-AUTH-05 | Happy | Reset password via valid token; login with new password works | $0 | N |
| TC-J1-08 | S-AUTH-04 | M-AUTH-05 | Common-sad | Reset password with expired token; surface "link expired"; no DB write | $0 | N |
| TC-J1-09 | S-AUTH-04 | M-AUTH-05 | Security-sad | Reset password by replaying a token already consumed; rejected | $0 | N |
| TC-J1-10 | S-AUTH-01 | M-AUTH-03 | Happy | Login with valid credentials; redirected to /dashboard with org context | $0 | Y |
| TC-J1-11 | S-AUTH-01 | M-AUTH-03 | Common-sad | Login with wrong password; "invalid credentials" surfaced; no session | $0 | N |
| TC-J1-12 | S-AUTH-01 | M-AUTH-03 | Security-sad | Login attempt rate-limit (N attempts in window); 429 surfaced | $0 | N |
| TC-J1-13 | S-PROJ-01 | M-NAV-01 | Happy | Newly-signed-up user sees empty Dashboard with "Create your first project" affordance | $0 | N |
| TC-J1-14 | S-PROJ-01 | M-AUTH-06 | Happy | Logout from header; redirected to /login; second tab also de-authed (Realtime broadcast) | $0 | N |

**J1 subtotal: 14 cases. ~3 happy / 7 common-sad / 4 security-sad. LLM cost: $0.**

### 4.2 J2 — Document creation (new project → seed structure)

| TC ID | Surface | Move | Axis | Description | LLM | Cloud |
|---|---|---|---|---|---|---|
| TC-J2-01 | S-PROJ-01 | M-NAV-01 + new project | Happy | Click "New project" → modal → fill name → submit; redirected to project page; project listed in Dashboard | $0 | Y |
| TC-J2-02 | S-PROJ-03 | (modal submit) | Common-sad | Submit empty name; client validation fails; modal stays open | $0 | N |
| TC-J2-03 | S-PROJ-03 | (modal submit) | Common-sad | Submit name >255 chars; server rejects 422; surface error | $0 | N |
| TC-J2-04 | S-PROJ-03 | (modal submit) | Security-sad | Submit name as user from another org via direct API; cross-org isolation holds (RLS) | $0 | N |
| TC-J2-05 | S-PROJ-02 | M-NAV-01 + new doc | Happy | Click "New document" → choose template (Novel / Short Story / Series) → submit; document appears with seed nodes per template | $0 | Y |
| TC-J2-06 | S-PROJ-04 | (modal submit) | Common-sad | Submit empty doc title; validation fails | $0 | N |
| TC-J2-07 | S-PROJ-04 | (modal submit) | Common-sad | Submit doc with invalid template id; server rejects 422 | $0 | N |
| TC-J2-08 | S-DOC-01 | M-NAV-01 | Happy | Open newly-created Novel doc; AppShell renders with NodeTree showing seed structure (Book → Acts → Chapters → Scenes → Beats) | $0 | Y |
| TC-J2-09 | S-DOC-01 | M-NAV-01 | Common-sad | Visit a non-existent document URL; 404 page surfaced; no error toast spam | $0 | N |
| TC-J2-10 | S-DOC-01 | M-NAV-01 | Security-sad | Visit another org's document URL via guessed projectId/documentId; RLS blocks; 404 (not 403, to avoid existence leak) | $0 | N |
| TC-J2-11 | S-DOC-05 | M-TREE-06 | Happy | Add child node to a parent via more-menu; node appears in tree; sibling order correct; agent_jobs untouched | $0 | N |
| TC-J2-12 | S-DOC-05 | M-TREE-06 | Common-sad | Try to add a child under a leaf node; blocked client-side (UI hides option); server rejects 422 if forced | $0 | N |
| TC-J2-13 | S-DOC-05 | M-TREE-08 | Happy | Inline-rename a node; persists; tree updates; no autosave race | $0 | N |
| TC-J2-14 | S-DOC-05 | M-TREE-08 | Common-sad | Rename to empty string; reverts to previous; no DB write | $0 | N |
| TC-J2-15 | S-DOC-05 | M-TREE-07 | Happy | Delete a leaf node via more-menu + confirm modal; row disappears; sibling order recomputed | $0 | N |
| TC-J2-16 | S-DOC-05 | M-TREE-07 | Common-sad | Delete a parent with children; cascade-confirm modal warns; on confirm all descendants gone | $0 | N |
| TC-J2-17 | S-DOC-05 | M-TREE-07 | Security-sad | Delete a node from another org via API; RLS rejects | $0 | N |
| TC-J2-18 | S-DOC-05 | M-TREE-03 | Happy | Drag-drop sibling reorder; positions update in single transaction (H-04); reload preserves | $0 | N |
| TC-J2-19 | S-DOC-05 | M-TREE-04 | Happy | Drag-drop reparent within layer rules; updates parent_id + position | $0 | N |
| TC-J2-20 | S-DOC-05 | M-TREE-04 | Common-sad | Try to drop into a leaf as parent; blocked client-side; if forced server rejects 422 | $0 | N |
| TC-J2-21 | S-DOC-05 | M-TREE-04 | Common-sad | Try to drop a node into its own descendant (cycle); blocked | $0 | N |

**J2 subtotal: 21 cases. ~9 happy / 9 common-sad / 3 security-sad. LLM cost: $0.**

### 4.3 J3 — Manual authoring (summary / prose / notes / versions / comments)

| TC ID | Surface | Move | Axis | Description | LLM | Cloud |
|---|---|---|---|---|---|---|
| TC-J3-01 | S-DET-03 | M-EDIT-01 + M-EDIT-08 | Happy | Type in SummaryEditor; idle 2s; autosave fires; row.summary updated; SummaryEditor never shows Lora | $0 | Y |
| TC-J3-02 | S-DET-03 | M-EDIT-01 | Common-sad | Type while autosave in flight; second autosave queues correctly; no lost edits | $0 | N |
| TC-J3-03 | S-DET-03 | M-EDIT-04 | Common-sad | Paste rich HTML with disallowed marks; sanitised to allowed schema | $0 | N |
| TC-J3-04 | S-DET-03 | M-EDIT-01 | Security-sad | Inject `<script>` via paste; sanitised; rendered as text | $0 | N |
| TC-J3-05 | S-DET-04 | M-EDIT-02 + M-EDIT-08 | Happy | Type in NotesEditor; autosave; row.notes updated; Notes uses Inter (never Lora) | $0 | N |
| TC-J3-06 | S-DET-04 | M-EDIT-06 | Happy | Apply Link via keyboard; Link mark allowed (Component Spec §5.13); persists | $0 | N |
| TC-J3-07 | S-DET-03 | M-EDIT-06 | Common-sad | Try to apply Link in SummaryEditor; no Link extension loaded; nothing happens | $0 | N |
| TC-J3-08 | S-DET-06 | (mount) | Happy | Open a leaf node; ProseEditor mounts; Lora 16px renders | $0 | Y |
| TC-J3-09 | S-DET-06 | (mount) | Common-sad | Open a non-leaf node; ProseEditor does NOT mount (H-15 leaf-only); only Summary visible | $0 | N |
| TC-J3-10 | S-DET-06 | M-EDIT-03 + M-EDIT-08 | Happy | Type prose; autosave; row.prose updated as Tiptap JSON; verdigris caret only on cursor (Inviolable #2 — verdigris use #3) | $0 | Y |
| TC-J3-11 | S-DET-06 | M-EDIT-04 | Common-sad | Paste >50KB plain text; performs without lag; autosave fires once at end | $0 | N |
| TC-J3-12 | S-DET-06 | M-EDIT-05 | Happy | Type, undo (Ctrl+Z); editor reverts; redo (Ctrl+Shift+Z); editor restores | $0 | N |
| TC-J3-13 | S-DET-06 | M-EDIT-07 | Happy | Select text → SelectionTooltip appears with Bold/Italic/Link; click Bold; mark applied | $0 | N |
| TC-J3-14 | S-DET-06 | M-EDIT-07 | Common-sad | Select across paragraph boundary; tooltip still functions; mark applies to entire range | $0 | N |
| TC-J3-15 | S-DET-07 | (idle) | Happy | While typing, WordCount opacity 0; idle 3s, opacity 0.4; hover, opacity 0.9 (Component Spec §5.7) | $0 | N |
| TC-J3-16 | S-DET-07 | M-EDIT-03 | Happy | Type until target word count reached; WordCount turns verdigris (Inviolable #2 — verdigris use #6) | $0 | N |
| TC-J3-17 | S-FOC-01 | M-FOC-01 | Happy | Click FocusModeButton; FocusMode portal mounts at body; AppShell stays mounted but invisible; Lora 18px prose surface | $0 | Y |
| TC-J3-18 | S-FOC-01 | M-FOC-02 | Happy | Press Esc; FocusMode unmounts; cursor restored to ProseEditor; selection preserved | $0 | N |
| TC-J3-19 | S-FOC-02 | M-FOC-04 | Happy | Hover FocusBreadcrumb; opacity ≤0.2 (Component Spec §6.2); click does nothing (`pointer-events: none`) | $0 | N |
| TC-J3-20 | S-DET-01 | (mode switch) | Common-sad | Switch from leaf node A (in Focus) to non-leaf node B via tree; Focus exits gracefully; B opens with no ProseEditor | $0 | N |
| TC-J3-21 | S-DET-13 | M-VER-01 + M-VER-02 | Happy | Edit prose 3 times (3 versions); open HistoryTab; 3 entries listed newest-first | $0 | N |
| TC-J3-22 | S-DET-13 | M-VER-03 | Happy | Hover a non-current version; diff preview surfaces (browse-only — no restore in V1) | $0 | N |
| TC-J3-23 | S-DET-13 | M-VER-02 | Common-sad | Open HistoryTab on a node with zero edits; surface "No versions yet" | $0 | N |
| TC-J3-24 | S-DET-14 | M-CMT-01 + M-CMT-02 | Happy | Select prose → comment icon → type comment → Enter; CommentThread persists; visible after reload | $0 | N |
| TC-J3-25 | S-DET-14 | M-CMT-03 | Happy | Resolve a comment; thread collapses to "resolved" state; reload preserves | $0 | N |
| TC-J3-26 | S-DET-14 | M-CMT-02 | Security-sad | Inject `<img onerror=...>` in comment body; sanitised; renders as text | $0 | N |
| TC-J3-27 | S-DET-15 | M-LCK-03 + M-LCK-04 | Common-sad | Open node in tab A, edit. Open same node in tab B, edit. Tab A autosave succeeds, tab B autosave shows ConflictBanner. Click "discard mine, reload" → tab B refreshes to A's state | $0 | N |
| TC-J3-28 | S-DET-15 | M-LCK-03 | Common-sad | Lock-acquire conflict (rare race during simultaneous open); ConflictBanner surfaces; resolution path clean | $0 | N |

**J3 subtotal: 28 cases. ~13 happy / 13 common-sad / 2 security-sad. LLM cost: $0.**

### 4.4 J4 — Context system (create context → link → see propagation)

| TC ID | Surface | Move | Axis | Description | LLM | Cloud |
|---|---|---|---|---|---|---|
| TC-J4-01 | S-DOC-05 | M-TREE-06 | Happy | Add a Character context node; SummaryEditor + MetadataForm render in Edit tab | $0 | N |
| TC-J4-02 | S-DET-05 | M-EDIT-10 + M-EDIT-08 | Happy | Fill Character metadata fields; autosave; persists | $0 | N |
| TC-J4-03 | S-DET-05 | M-EDIT-10 | Common-sad | Submit invalid metadata (e.g. wrong scope) per the conditional NOT NULL CHECK (Migration 024); rejected at DB | $0 | N |
| TC-J4-04 | S-DET-11 | M-CTX-01 | Happy | Open ContextLinker on a beat; search a Character; click to link; ContextTab shows new link | $0 | N |
| TC-J4-05 | S-DET-11 | M-CTX-01 | Common-sad | Search returns no matches; surface "No matches"; no link created | $0 | N |
| TC-J4-06 | S-DET-11 | M-CTX-01 | Security-sad | Try to link a context node from another project via direct API; RLS rejects | $0 | N |
| TC-J4-07 | S-DET-12 | M-NAV-01 | Happy | Open the Character node; BackLinksList shows the beats that link to it | $0 | N |
| TC-J4-08 | S-DET-11 | M-CTX-02 | Happy | Unlink a context node; ContextTab updates; BackLinksList on the context node updates | $0 | N |
| TC-J4-09 | S-DOC-05 | M-TREE-09 | Happy | Mark a leaf prose node as context; conditional NOT NULL CHECK passes (Migration 024 / SU-14); stack-membership updates | $0 | N |
| TC-J4-10 | S-DOC-05 | M-TREE-09 | Common-sad | Try to mark a node whose required `scope` field is missing; surface validation; no DB write | $0 | N |
| TC-J4-11 | S-DOC-05 | (move-API) | Security-sad | Attempt to use `/api/nodes/[nodeId]/move` to make a context-source node a child of a non-source parent; blocked (SU-17 retroactive amendment) | $0 | N |
| TC-J4-12 | (cross-cut) | M-CTX-03 | Happy | Open a beat with a linked Character context; the Character's summary appears as part of the agent context (verified in TC-J5 happy path) | $0 | N |
| TC-J4-13 | S-PROJ-01 | (V1 whitelist) | Common-sad | Try to create a context node with a slug not in the V1 six-core whitelist (SU-16); rejected | $0 | N |

**J4 subtotal: 13 cases. ~6 happy / 5 common-sad / 2 security-sad. LLM cost: $0.**

### 4.5 J5 — Single-node agent ops (expand / synthesise / refine / generate-context)

J5 hammers the cells: every operation × every applicable node type × every applicable target_field. The matrix relies on Phase 5's existing per-operation TC suite as foundation; J5 layers integration assertions over those.

| TC ID | Surface | Move | Axis | Description | LLM | Cloud |
|---|---|---|---|---|---|---|
| TC-J5-01 | S-DET-09 | M-AGT-01 + M-AGT-04 | Happy | Click Synthesise on a Beat (leaf prose); SSE opens; result_prose populates as Tiptap JSON; Accept advances version | $0.01 | Y |
| TC-J5-02 | S-DET-09 | M-AGT-04 | Common-sad | Click Synthesise on a Beat with locked-by-other-job state; 409 surfaced; no second job | $0 | N |
| TC-J5-03 | S-DET-09 | M-AGT-04 | Common-sad | Click Synthesise on a non-leaf node; UI hides the option (or 422 if forced via API) | $0 | N |
| TC-J5-04 | S-DET-09 | M-AGT-04 | Security-sad | Inject canary-leak in mock model output; stream terminates with `canary_violation`; result_prose NOT persisted | $0 (mock) | N |
| TC-J5-05 | S-DET-09 | M-AGT-04 | Security-sad | Token-budget gate (H-07) at 0; 429 returned BEFORE agent_jobs row created | $0 | N |
| TC-J5-06 | S-DET-09 | M-AGT-05 | Happy | Click Expand on an Act; new Chapter children appear after Accept; layer rules respected | $0.02 | N |
| TC-J5-07 | S-DET-09 | M-AGT-05 | Common-sad | Click Expand on a Beat (leaf); UI hides (only non-leaf can expand) | $0 | N |
| TC-J5-08 | S-DET-09 | M-AGT-06 | Happy | Click Refine on a Beat (target_field=prose); refine_beat_prose profile resolves (post-e533377 fix); result populates | $0.02 | N |
| TC-J5-09 | S-DET-09 | M-AGT-06 | Happy | Click Refine on a Beat (target_field=summary); refine_beat_summary profile resolves; result populates | $0.02 | N |
| TC-J5-10 | S-DET-09 | M-AGT-06 | Happy | Click Refine on an Act / Chapter / Scene; correct refine profile per (operation_type, node_type, target_field) | $0.05 | N |
| TC-J5-11 | S-DET-09 | M-AGT-06 | Common-sad | Click Refine on a node whose target_field is empty; surface "nothing to refine" | $0 | N |
| TC-J5-12 | S-DET-09 | M-AGT-07 | Happy | Click Generate Context (Character) from a beat; new Character context node created with metadata; linked to beat | $0.02 | N |
| TC-J5-13 | S-DET-09 | M-AGT-07 | Common-sad | Click Generate Context with budget at 0; 429 before any DB write | $0 | N |
| TC-J5-14 | S-DET-09 | M-AGT-08 | Happy | Click Cancel on a streaming Synthesise; SSE closes; agent_jobs ends `cancelled` | $0.005 | N |
| TC-J5-15 | S-DET-09 | M-AGT-08 | Happy | Click Cancel on a background Expand; agent_jobs ends `cancelled` | $0.005 | N |
| TC-J5-16 | S-DET-09 | M-AGT-09 | Happy | Click Accept on a completed Synthesise; ProseEditor reloads with the new prose; node version advances | $0.01 | Y |
| TC-J5-17 | S-DET-09 | M-AGT-09 | Common-sad | Click Accept after another tab already accepted; conflict banner; refresh path | $0 | N |
| TC-J5-18 | S-DET-09 | M-AGT-10 | Happy | Click Dismiss on a completed job; agent_jobs row gets dismissed_at; tree returns to idle | $0 | N |
| TC-J5-19 | S-DET-09 | M-AGT-09 | Common-sad | Accept where the result wasn't pre-stringified Tiptap JSON (regression for the workflow_executor bug fc9f14a applied at the user-clicked path too); SummaryEditor parses correctly OR rejects with clear error | $0 | N |
| TC-J5-20 | S-DET-10 | M-AGT-11 | Happy | Open AgentJobHistory; past completed and dismissed jobs listed newest-first; click one opens read-only view | $0 | N |
| TC-J5-21 | S-DET-09 | M-AGT-04 | Cross-cut | Synthesise streaming + workflow integration: TC-A-15 from Phase 5b re-runs PASS post-Phase-5d (regression on workflow path) | $0.005 | N |
| TC-J5-22 | S-DET-09 | (cross-model) | Cross-model | Synthesise probe `P-SYNTH-CH3-SC1-BT1` (Phase 5c carry-forward) on Haiku 4.5 / Sonnet 4.6 / Opus 4.7; all three return Tiptap-JSON result; SU-46 temperature handling holds for stream | $0.27 | N |
| TC-J5-23 | S-SYS-05 | (passive) | Happy | While a Synthesise streams, AgentActivityIndicator on the NodeRow pulses; on completion, NodeStatusBadge transitions to agent-complete (verdigris use #4) | $0 | Y |

**J5 subtotal: 23 cases. ~12 happy / 5 common-sad / 2 security-sad / 1 cross-cut / 1 cross-model + supporting cases. LLM cost: ~$0.42.**

### 4.6 J6 — Director conversation + workflow approve+execute

| TC ID | Surface | Move | Axis | Description | LLM | Cloud |
|---|---|---|---|---|---|---|
| TC-J6-01 | S-DIR-08 | M-DIR-01 + M-DIR-04 | Happy | Type "Help me plan Chapter 3" → Enter; ConversationThread shows user message; ThinkingIndicator; assistant text streams in DirectorMessage | $0.05 | Y |
| TC-J6-02 | S-DIR-08 | M-DIR-04 | Common-sad | Send empty message; client validation blocks | $0 | N |
| TC-J6-03 | S-DIR-08 | M-DIR-02 + M-DIR-03 | Happy | Type `@`; NodePicker opens; pick a Beat; @-mention rendered in input; on send, the message includes node reference | $0 | N |
| TC-J6-04 | S-DIR-08 | M-DIR-02 | Common-sad | `@` with no matches; NodePicker shows "No matches"; close on Esc | $0 | N |
| TC-J6-05 | S-DIR-08 | M-DIR-04 | Security-sad | Inject `<workflow_proposal>` markup in user message; suppressed from text deltas (post-a65ee4d fix); not echoed as visible text | $0.01 | N |
| TC-J6-06 | S-DIR-06 | M-DIR-06 | Happy | Director proposes a multi-step workflow → PlanCard; click Approve All; ExecutionCard appears; each step transitions ◌ → ⟳ → ✓ | $0.10 | Y |
| TC-J6-07 | S-DIR-06 | M-DIR-07 | Happy | Toggle a step checkbox to deselect; Approve button label updates "Approve N of M"; click; only selected steps execute | $0.05 | N |
| TC-J6-08 | S-DIR-06 | M-DIR-08 | Happy | Click Cancel on PlanCard before approve; plan dismissed; no agent_jobs created | $0 | N |
| TC-J6-09 | S-DIR-07 | (heartbeat) | Happy | While a step runs, ExecutionCard heartbeat indicator pulses agent-running fresh (<30s) (Component Spec §7.7 / SU-42) | $0.05 | N |
| TC-J6-10 | S-DIR-07 | (heartbeat) | Common-sad | Simulated stall (>120s no heartbeat); recovery cron marks step `failed`; ExecutionCard surfaces failure | $0 | N |
| TC-J6-11 | S-DIR-07 | M-DIR-09 | Happy | Click Pause on a running workflow; current step finishes, next step doesn't start; status `paused` | $0.05 | N |
| TC-J6-12 | S-DIR-07 | M-DIR-10 | Happy | Click Resume on a paused workflow; remaining steps execute | $0.05 | N |
| TC-J6-13 | S-DIR-07 | M-DIR-11 | Happy | Click Stop on a running workflow; current step finishes; status `stopped`; no further dispatch | $0.05 | N |
| TC-J6-14 | S-DIR-08 | M-DIR-12 | Happy | Mid-stream Director response → page reload → resume route catches up; ConversationThread restores partial assistant text + continues (SU-41) | $0.05 | N |
| TC-J6-15 | S-DIR-07 | M-DIR-12 | Happy | Mid-execution workflow → page reload → ExecutionCard restores from agent_jobs status | $0 | N |
| TC-J6-16 | (cross-cut) | (workflow integration) | Cross-cut | Workflow with a refine step on an Act dispatches via background path (NOT streaming); profile resolution picks correct refine profile (post-e533377 fix); accept_agent_job receives Tiptap JSON (post-fc9f14a fix) | $0.05 | Y |
| TC-J6-17 | S-DIR-01 | M-NAV-04 | Common-sad | Switch ModeTab from Director (mid-stream) to Edit; Director SSE closes cleanly; on switch back, conversation restored; no orphan stream | $0.02 | N |
| TC-J6-18 | S-DIR-08 | M-DIR-04 | Security-sad | Cross-org node @-mention via direct API hack; Director rejects; no message persisted | $0 | N |

**J6 subtotal: 18 cases. ~9 happy / 4 common-sad / 2 security-sad / 3 cross-cut. LLM cost: ~$0.52.**

### 4.7 J7 — Synthesise streaming (Phase 5c surface, deepened)

J7 is a deepening of Phase 5c's existing test coverage — focused on integration seams that Phase 5c bug-trail surfaced.

| TC ID | Surface | Move | Axis | Description | LLM | Cloud |
|---|---|---|---|---|---|---|
| TC-J7-01 | S-STR-01 | M-AGT-04 | Happy | Click Synthesise; streaming surface mounts; Lora 15px / 1.7 line-height; text appears progressively | $0.01 | Y |
| TC-J7-02 | S-STR-01 | M-AGT-04 | Common-sad | Network drop mid-stream (simulated); SSE errors gracefully; agent_jobs ends `failed` with `connection_lost`; UI surfaces a retry affordance | $0.005 | N |
| TC-J7-03 | S-STR-02 | M-AGT-08 | Happy | Click Cancel mid-stream; SSE closes; AbortController fires; agent_jobs ends `cancelled` (`client_disconnect`) | $0.005 | N |
| TC-J7-04 | S-STR-03 | (transition) | Happy | On `agent_job_complete`, surface transitions to accept/dismiss view in <100ms; no flash, no layout shift | $0.01 | N |
| TC-J7-05 | (cross-cut) | (CSP) | Cross-env | Open AgentTab on Vercel deploy; verify Supabase Realtime websocket connects (CSP includes `wss://*.supabase.co` per `reference_vercel_csp_websocket.md`); AgentTab receives realtime status changes | $0.01 | Y |
| TC-J7-06 | (cross-cut) | (CSP) | Common-sad | Drop the wss:// CSP entry locally and load page; verify AgentTab IDLE→COMPLETE transition fails (this is the regression-detection guard for Phase 5c bug #1; expected to FAIL when wss removed, PASS when present) | $0.01 | N |
| TC-J7-07 | S-STR-01 | (state reset) | Happy | Switch to a different leaf node mid-stream; first stream cancels; new node mounts with key={nodeId} reset; no stale text from previous stream | $0.01 | N |
| TC-J7-08 | S-STR-01 | (a11y) | Happy | Streaming surface has `role="status"` + `aria-live="polite"`; screen reader announces deltas | $0 | N |
| TC-J7-09 | S-STR-01 | (motion) | Happy | `prefers-reduced-motion: reduce` removes typewriter caret animation; text still streams | $0 | N |

**J7 subtotal: 9 cases. ~5 happy / 2 common-sad / 2 cross-cut. LLM cost: ~$0.06.**

### 4.8 J8 — Cross-cutting: locks, status transitions, RLS, security frame

| TC ID | Surface | Move | Axis | Description | LLM | Cloud |
|---|---|---|---|---|---|---|
| TC-J8-01 | (cross-doc) | (lock) | Happy | User opens node A in tab 1, edits; tab 2 opens same node read-only with "open in another tab" banner | $0 | N |
| TC-J8-02 | (cross-doc) | M-LCK-04 | Happy | Resolve via "take over" in tab 2; tab 1 transitions to read-only with surface notice | $0 | N |
| TC-J8-03 | (cross-doc) | (status) | Happy | Run an Expand on a node; status transitions IDLE → AGENT_RUNNING → AGENT_COMPLETE; NodeStatusBadge reflects each | $0.02 | N |
| TC-J8-04 | (cross-doc) | (status) | Happy | Accept the agent result; status transitions to APPROVED; NodeStatusBadge verdigris (use #5) | $0 | N |
| TC-J8-05 | (cross-doc) | (status) | Happy | Edit the prose after approval; status transitions to MODIFIED; existing approval clears | $0 | N |
| TC-J8-06 | (cross-doc) | RLS | Security-sad | User in org A makes a fetch to `/api/nodes/[id]` for a node in org B; 404 (not 403); no leak | $0 | N |
| TC-J8-07 | (cross-doc) | RLS | Security-sad | User in org A subscribes to Realtime for a channel in org B; subscription drops with no events | $0 | N |
| TC-J8-08 | (cross-doc) | injection | Security-sad | All editor inputs (Summary, Notes, Prose, MetadataForm, comment, Director) escape via `escapeXml` + wrap in `<user_data>` per TA §4.2; verified by inspecting agent prompts for any test case in J5 with adversarial input | $0.01 | N |
| TC-J8-09 | (cross-doc) | injection | Security-sad | Canary scan runs on every model response (TA §4.4); inject mock leak in mid-stream; stream halts; response not persisted | $0 (mock) | N |
| TC-J8-10 | (cross-doc) | (rate limit) | Common-sad | Hammer `/api/agent/synthesise/stream` 20× in 60s as one user; rate limit kicks in at threshold; subsequent requests 429 | $0.01 | N |
| TC-J8-11 | (cross-doc) | (BYOK) | Happy | User configures BYOK Anthropic key; subsequent agent runs use BYOK (verified by Edge Function memory boundary per H-09); token cost still recorded | $0.02 | N |
| TC-J8-12 | (cross-doc) | (BYOK) | Security-sad | User's BYOK key never leaks into client-side responses or logs (grep responses + console for key prefix) | $0 | N |
| TC-J8-13 | (cross-doc) | (search_path) | Security-sad | Verify all SECURITY DEFINER functions have `SET search_path = public` (H-13); regression check via SQL introspection | $0 | N |
| TC-J8-14 | (cross-doc) | (subscription cleanup) | Common-sad | Open and close 10 documents rapidly; verify no Supabase real-time subscription leaks (H-05); inspect `__client.realtime.channels` count returns to baseline | $0 | N |
| TC-J8-15 | (cross-doc) | (search_path) | Happy | Run scheduled job concurrency test: two cron firings at the same instant; one acquires `FOR UPDATE SKIP LOCKED`; the other no-ops (H-11) | $0 | N |

**J8 subtotal: 15 cases. ~6 happy / 3 common-sad / 6 security-sad. LLM cost: ~$0.06.**

### 4.9 J9 — Edge / sad paths (token budget, malformed input, unauth, errors)

| TC ID | Surface | Move | Axis | Description | LLM | Cloud |
|---|---|---|---|---|---|---|
| TC-J9-01 | (any) | (auth) | Common-sad | Hit any `/api/*` route with no session cookie; 401 surfaced; no DB writes | $0 | N |
| TC-J9-02 | (any) | (auth) | Common-sad | Hit any `/api/*` route with an expired session; refresh flow kicks in; one retry succeeds | $0 | N |
| TC-J9-03 | (validation) | M-EDIT-09 | Common-sad | Submit a node title >255 chars via inline-edit; client truncates or server rejects 422 | $0 | N |
| TC-J9-04 | (validation) | (any zod schema) | Common-sad | Send malformed JSON to any POST endpoint; 400 returned with descriptive error; no DB writes | $0 | N |
| TC-J9-05 | (LLM) | M-AGT-04 | Common-sad | Anthropic upstream returns 5xx mid-stream; SSE error event; agent_jobs `failed`; cost recorded for tokens received | $0 | N |
| TC-J9-06 | (LLM) | M-AGT-04 | Common-sad | Anthropic rate-limits us (429); SSE error; agent_jobs `failed` with `provider_rate_limit`; UI surfaces actionable message | $0 | N |
| TC-J9-07 | (LLM) | M-AGT-04 | Common-sad | Token budget exhausted mid-stream (rare but possible after stream opens); stream aborts; agent_jobs `failed` with `budget_exhausted`; partial tokens recorded | $0.01 | N |
| TC-J9-08 | (storage) | (paste) | Common-sad | Paste 500KB content into ProseEditor; Tiptap chunks correctly; autosave succeeds; no payload-too-large error from PostgREST | $0 | N |
| TC-J9-09 | (storage) | M-EDIT-08 | Common-sad | Network drops during autosave; client retries; succeeds; no duplicate version row | $0 | N |
| TC-J9-10 | (data) | (corrupt) | Common-sad | A node has `summary` as plain string (corrupt — pre-fc9f14a-fix data); SummaryEditor handles gracefully (renders empty + flag), does not crash; toast surfaces | $0 | N |
| TC-J9-11 | (data) | (corrupt) | Common-sad | A node has `prose` as malformed Tiptap JSON; ProseEditor handles gracefully (renders empty); toast surfaces | $0 | N |
| TC-J9-12 | (validation) | (concurrency) | Common-sad | Two simultaneous requests to start a Synthesise on the same node; one succeeds (200), one rejected (409); no double-DB-row | $0 | N |
| TC-J9-13 | (validation) | (workflow) | Common-sad | Approve a workflow whose proposed step has become invalid (target node deleted between propose+approve); workflow rejects with clear error; partial execution does NOT proceed | $0 | N |
| TC-J9-14 | (a11y) | (any) | Common-sad | Tab-key navigates through interactive elements in document order; focus indicators visible; screen reader announces correctly (subset re-run from Phase 4 AX) | $0 | N |

**J9 subtotal: 14 cases. ~0 happy / 14 common-sad. LLM cost: ~$0.01.**

### 4.10 J10 — Visual regression (screenshot baselines for stable component states)

J10 captures static snapshots at fixed surfaces × stable states. **Excluded:** streaming text, typewriter motion, breadcrumb fade, plan-card live edits — these are excluded because pixel diffs are noise.

| TC ID | Surface | State | Description |
|---|---|---|---|
| TC-J10-01 | S-AUTH-01 | Default | Login form, no input |
| TC-J10-02 | S-AUTH-02 | Validation error | Signup with weak password, error visible |
| TC-J10-03 | S-PROJ-01 | Empty | Dashboard immediately after signup, no projects |
| TC-J10-04 | S-PROJ-01 | Populated | Dashboard with 3 projects |
| TC-J10-05 | S-PROJ-02 | Default | Project page with 1 document |
| TC-J10-06 | S-DOC-01 | Default | Document editor on a Novel template, root selected |
| TC-J10-07 | S-DOC-05 | Expanded | NodeTree fully expanded showing all layers |
| TC-J10-08 | S-DOC-06 | Hovered | NodeRow with hover-revealed actions |
| TC-J10-09 | S-DET-03 | Default | SummaryEditor empty (Inter placeholder) |
| TC-J10-10 | S-DET-03 | With content | SummaryEditor with multi-paragraph content |
| TC-J10-11 | S-DET-06 | Default | ProseEditor empty (Lora placeholder) |
| TC-J10-12 | S-DET-06 | With content | ProseEditor with prose; cursor visible (verdigris use #3) |
| TC-J10-13 | S-DET-08 | Open | SelectionTooltip visible over a selection |
| TC-J10-14 | S-DET-09 | Idle | AgentTab pre-click, profile dropdown closed |
| TC-J10-15 | S-DET-09 | Completed | AgentTab post-stream, accept/dismiss view |
| TC-J10-16 | S-DET-13 | Populated | HistoryTab with 5 versions |
| TC-J10-17 | S-FOC-01 | Default | FocusMode entered, prose with content |
| TC-J10-18 | S-DIR-01 | Empty | DirectorPanel with empty thread |
| TC-J10-19 | S-DIR-06 | Plan visible | DirectorPanel with PlanCard fully expanded |
| TC-J10-20 | S-DIR-07 | Mid-execution | DirectorPanel with ExecutionCard, 2 steps complete, 1 running, 2 pending |
| TC-J10-21 | S-SYS-04 | Visible | NodeStatusBadge in each of: idle / agent-running / agent-complete / approved / modified |

**J10 subtotal: 21 cases. All visual snapshots. LLM cost: $0 (no LLM; this is a static-state screenshot suite).**

---

## 5. Per-case cost budget summary

| Journey | Active cases | Happy | Common-sad | Security-sad | Cross-cut/Cross-model | LLM cost / pass |
|---|---|---|---|---|---|---|
| J1 — Onboarding | 14 | 3 | 7 | 4 | 0 | $0 |
| J2 — Document creation | 21 | 9 | 9 | 3 | 0 | $0 |
| J3 — Manual authoring | 28 | 13 | 13 | 2 | 0 | $0 |
| J4 — Context system | 13 | 6 | 5 | 2 | 0 | $0 |
| J5 — Single-node agent ops | 23 | 12 | 5 | 2 | 4 | ~$0.42 |
| J6 — Director + workflow | 18 | 9 | 4 | 2 | 3 | ~$0.52 |
| J7 — Synthesise streaming | 9 | 5 | 2 | 0 | 2 | ~$0.06 |
| J8 — Locks / status / security | 15 | 6 | 3 | 6 | 0 | ~$0.06 |
| J9 — Edge / sad paths | 14 | 0 | 14 | 0 | 0 | ~$0.01 |
| J10 — Visual regression | 21 | 21 | 0 | 0 | 0 | $0 |
| **Total** | **176** | 84 | 62 | 21 | 9 | **~$1.07** |

A full Phase 5d pass (all 176 active cases, including LLM-bearing ones on Haiku 4.5) costs ~$1.07. The non-LLM subset (146 cases) costs $0 and is the CI-suitable per-PR set.

> **On count.** The original scope memo aimed for 200-300 cases. This Plan converges on 176 active cases because of the rule that cross-Journey cells (e.g. M-NAV-04 from any document mode) are tested once per Journey rather than once per surface — that prevents combinatorial explosion. Build Checklist §3 may add small per-sprint additions during implementation; if the total crosses 250 a Test Plan v1.1 amendment will record the additions.

---

## 6. Cloud-smoke subset

The following 16 cases (~9% of total) form the Vercel smoke subset that runs against `stelavox-dev` post-merge. Selection criteria:

- Happy-path representatives of each Journey
- Every case that exercises a Vercel-runtime-specific dependency (CSP, websocket, edge functions, cron, Realtime)
- The CSP regression-guard (TC-J7-05)

| Cloud-smoke ID | Source TC | Surface |
|---|---|---|
| CS-01 | TC-J1-10 | Login |
| CS-02 | TC-J1-14 | Logout (Realtime broadcast) |
| CS-03 | TC-J2-01 | New project |
| CS-04 | TC-J2-05 | New document |
| CS-05 | TC-J2-08 | Open document, NodeTree renders |
| CS-06 | TC-J3-01 | Summary autosave |
| CS-07 | TC-J3-08 | ProseEditor leaf-only mounting |
| CS-08 | TC-J3-10 | Prose autosave |
| CS-09 | TC-J3-17 | FocusMode portal mount |
| CS-10 | TC-J5-01 | Synthesise streaming end-to-end |
| CS-11 | TC-J5-16 | Accept agent result; node version advance |
| CS-12 | TC-J6-01 | Director conversation streaming |
| CS-13 | TC-J6-06 | Workflow approve + execute |
| CS-14 | TC-J6-16 | Workflow integration (refine on Act) |
| CS-15 | TC-J7-05 | CSP regression guard (wss://) |
| CS-16 | TC-J5-23 | Realtime indicator pulse |

**Cloud-smoke total: 16 cases. LLM cost: ~$0.30 per pass.**

---

## 7. Test execution plan

### 7.1 Local non-LLM cases (CI per PR)

All cases marked LLM `$0` — 146 cases — runnable in CI on every PR without an Anthropic key. Failures block merge.

### 7.2 Local LLM-bearing cases (manual / pre-merge)

The remaining 30 cases require a real Anthropic key on Haiku 4.5. ~$0.77 per pass. Runnable manually before merge or via a tagged "expensive" CI job.

### 7.3 Cross-model verification

TC-J5-22 only — Phase 5b/5c carry-forward on the existing j5-novel probe corpus. Run once per Phase 5d-substantial change. ~$0.27.

### 7.4 Cloud smoke

The 16-case CS-* subset runs once per merge to master via a post-deploy CI job pointed at `stelavox-dev`. Failures block declaring the merge "deployed-and-verified" (but don't auto-revert — that's a manual decision).

### 7.5 Cumulative LLM budget per pass

| Pass | Cost |
|---|---|
| Local non-LLM (146 cases, CI per PR) | $0 |
| Local LLM (30 cases, manual / expensive CI) | ~$0.77 |
| Cross-model verification (1 case × 3 models) | ~$0.27 |
| Cloud smoke (16 cases) | ~$0.30 |
| **Full Phase 5d pass** | **~$1.34** |

Cumulative spend across the multi-session Phase 5d build is bounded by `(sessions × full-pass cost)` plus iteration. Estimated total Phase 5d LLM spend: **~$10-15** across all sessions (well within Phase 5b's $5/session ceiling).

---

## 8. Acceptance verdict

Phase 5d is treated as a **rolling acceptance** — each Journey ships independently as `Phase 5d.J{n}` once that Journey's CK passes. The umbrella verdict is "all CK-{1..n} green, all 176 cases PASS at master HEAD".

A Journey passes when:

- All cases in that Journey's matrix PASS (no skips at PASS time)
- Cross-Journey regression cases unaffected (the prior Journey's cases still PASS)
- Cloud smoke for that Journey's CS-* subset PASSES
- The page-object catalog for that Journey is complete and used (no inline selectors)
- LLM-bearing cases ran on Haiku 4.5 unless explicitly noted

Phase 5d as a whole is "shipped" when all 10 Journeys are individually merged and the umbrella regression run is green.

If any case fails: stop-the-line per `feedback_phase_session_procedure.md`. Diagnose; classify (spec gap / spec error / impl gap / env per CLAUDE.md "Spec vs Implementation Classification"); fix; re-run; document in the Journey's Test Report.

---

## 9. Changelog

**v1.0 — 2026-05-08** Initial Phase 5d Test Plan. Surface taxonomy with 47 surfaces grouped Auth (5) / Project shell (4) / Document editor global (8) / Detail Panel (15) / Focus Mode (5, one deferred to Phase 8) / Director (9) / Streaming (3) / System (6, one tentative). Move taxonomy with 50 atomic moves grouped Navigation (6) / Auth (6) / Tree (9) / Editor (10) / Focus Mode (4) / Agent (11) / Director (12) / Comment (4) / Context (4) / Version (3, one V1-deferred) / Lock (4) / System (5). Test case matrix totalling 176 active cases across 10 Journeys: J1 Onboarding (14), J2 Document creation (21), J3 Manual authoring (28), J4 Context system (13), J5 Single-node agent ops (23), J6 Director + workflow (18), J7 Synthesise streaming (9), J8 Cross-cutting (15), J9 Edge / sad paths (14), J10 Visual regression (21). Distribution: 84 happy / 62 common-sad / 21 security-sad / 9 cross-cut/cross-model. Cumulative LLM budget for a full pass on Haiku 4.5: ~$1.34. Cloud-smoke subset: 16 cases (~9% of total). No new H-NN hazards introduced; this Plan layers tests over the Phase 1-5c hazard surface. Acceptance: rolling per Journey; umbrella shipped when all 10 Journeys merged with regression-green.
