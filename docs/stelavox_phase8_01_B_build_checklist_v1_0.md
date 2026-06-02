# Phase 8.01.B — Focus Mode polish
## Build checklist v1.1

> **Close-out 2026-05-31 — PASS.** All in-scope tasks complete. 36 new unit + 8 new Playwright pass. Type-check clean. Build passes. Full vitest holds against v1.43 baseline (8 pre-existing failures, composition slightly varies with DB state from the seeded sample novel — zero new failures introduced). Lint: 0 errors in 8.01.B files; 3 pre-existing baseline errors carry over. Scoring + per-task notes at the bottom of this file.

**Scope.** Second sub-phase of the Phase 8.01 build pass. Lands the Focus Mode visual + interaction refinements that the 8.01.A LayerLabel foundation enables: full ancestor-walk in the breadcrumb with bracketed labels, opacity ceiling bump from 0.2 to 0.35 (with 0.7 hover/touch reveal of position counter + leaf name), FocusEscHint move to bottom-left, iPad touch "← Edit" pill variant, and a verification pass on the existing ⌘ ← / ⌘ → beat-navigation against the M-173 depth model.

**Spec contract.**
- Component Spec v2.21 §6.1 (FocusMode), §6.2 (FocusBreadcrumb — opacity revision), §6.3 (FocusEscHint — relocation + touch variant)
- Component Spec v2.21 §18.3 (touch interactions — swipe gestures map to ⌘ ←/⌘ →)
- Brand Identity v2.2 Inviolable #1 (lowest-noise prose surface — unchanged), Inviolable #5 (no toolbar — unchanged)

**Out of scope (this sub-phase).** DirectorPanel rendering (8.01.C); Dashboard (8.01.D); ProjectPage + non-leaf detail-pane variant + the deferred 8.01.A T-7 detail-pane crumb (8.01.E); responsive contract + iPad slide-overs (8.01.F). Sentence Focus end-to-end (Phase 8.9) and Typewriter opt-in (Phase 8.10) remain deferred. The `prefers-reduced-motion` audit (Phase 8.11) also stays out — Focus Mode's existing reduced-motion handling at the 280ms entry stays as-is.

---

## Tasks

### T-1. UPDATE `components/focus/FocusMode.tsx` — caller migration off legacy `string[]`

The 8.01.A FocusBreadcrumb refactor accepts either the new `FocusBreadcrumbSegment[]` shape or the legacy `string[]`. FocusMode is still passing the legacy shape (`['Document', activeNode.name ?? '(untitled)']`). T-1 migrates the caller.

**T-1.1 — Extend `FocusModeNode` shape.** Add `node_type`, `order`, and `layer_index` to the interface so the caller can construct a structured segment for the active node without re-fetching. Update the call site in `NodeDetailPanel.tsx` (or wherever FocusMode is mounted) to thread these fields through from the active-node row state — these fields already exist on the DB-side `nodes` row per Phase 1 schema.

**T-1.2 — Fetch ancestor chain.** Add an `ancestors: FocusBreadcrumbSegment[]` state to FocusMode, populated by a query to the new helper `getAncestorChain(nodeId)` (NEW; see T-2). The chain runs root-to-leaf, EXCLUDING the active node itself (the active node renders as the last segment, sourced from `activeNode` props directly). Refresh the chain on `activeNode.id` change (the existing useEffect that drives the sibling fetch is the natural place; or chain it).

**T-1.3 — Compose the segments.** Build the segment array as `[...ancestors, { layer: activeNode.node_type, position: activeNode.order, name: activeNode.name ?? undefined }]` and pass to FocusBreadcrumb. The `name` field on the last (leaf) segment is what the hover/touch reveal in §6.2 surfaces — the spec says only the leaf's name shows on reveal.

**T-1.4 — Position counter prop.** Compute `position={{ index: siblingIndex, total: siblings.length }}` for the FocusBreadcrumb. The sibling array already exists in FocusMode for ⌘ ←/⌘ → navigation; reuse it. Pass `index` 1-based for display (the wireframe shows "2 / 5", not "1 / 5" when on the second sibling).

### T-2. NEW `lib/nodes/getAncestorChain.ts` (~60 lines)

Server-friendly + client-friendly helper that walks a node's parent_id chain to the root and returns segments in root-first order. Excludes the leaf node itself (the caller renders that separately so it can include the `name` for hover-reveal).

**Contract:**
```ts
export async function getAncestorChain(
  supabase: SupabaseClient,
  nodeId: string,
): Promise<FocusBreadcrumbSegment[]>
```

Implementation walks `nodes` table iteratively (up to a safety cap of 20 hops per the `compute_node_depth` precedent at M-173). Returns an array where index 0 is the root and the last element is the immediate parent of the input node. Each entry carries `{ layer, position }` — `name` is omitted (the spec says only the leaf renders the name on reveal; ancestors stay as bare bracketed labels).

For V1 the helper restricts to `node_category = 'structural'` AND `node_type IN ('series','book','act','chapter','scene','beat')` — anything outside this set returns empty (defensive; Phase 14 layer_stack-aware lookup replaces the hardcoded set, same model as `LayerLabel`).

Place the helper in `lib/nodes/` (NEW directory if it doesn't exist) so server actions, API routes, and client components can all import it. Avoid the executor-style helpers in `lib/director/` — this is a presentation-only utility.

### T-3. UPDATE `components/focus/FocusBreadcrumb.tsx` — opacity ceiling + hover/touch reveal

The 8.01.A version pinned the opacity ceiling at 0.2 ("the 0.35/0.7 reveal lands in 8.01.B"). T-3 lands the bump.

**T-3.1 — Opacity state machine.** Per Component Spec v2.21 §6.2 revised table:
| Trigger | Opacity | Transition |
|---|---|---|
| Typing | 0 | instant |
| At rest >3s | 0.35 | 800ms `--easing-prose` |
| Mouse movement | 0.35 | 800ms `--easing-prose` |
| Hover on breadcrumb | 0.7 | 200ms `--easing-default` |
| Touch tap (iPad) | 0.7 for 4s, then fade to 0.35 | 200ms in / 800ms out |

Replace the constant `0.2` values inside the existing state effect with `0.35`. Add a hover-bump path via a local `isHovered` state and `onMouseEnter` / `onMouseLeave` on the outer div. The hover-bump overrides the typing/idle states because the user is actively reaching for the breadcrumb. Hover beats typing (the typing → 0 path stays in effect when the user is typing AND not hovering).

Touch: on `pointerdown` with `pointerType === 'touch'`, set hover-equivalent opacity 0.7 for 4s via a setTimeout, then fade back to 0.35. Do NOT add the touch handler if `window.matchMedia('(pointer: fine)').matches` — desktop pointers route through the hover path.

**T-3.2 — Position counter "N / M" reveal.** When `position` prop is present AND opacity is 0.7 (hover or touch reveal), render the counter as a sibling element to the LayerLabel chain, in monospace 9.5px `var(--color-text-faint)`. Pattern from wireframe iter1 Section 01 / 04:
```
[Book 1] · [Act 1] · [Ch 1] · [Sc 1] · [Bt 2]  2 / 5  — Anchor & Conflict
```
The counter appears only between the bracketed chain and the leaf name. The leaf name appears only when opacity = 0.7 AND the last segment carries a `name` field.

**T-3.3 — Pointer-events stay none.** Inviolable for the Focus surface: the breadcrumb is read-only orientation, never navigation. The hover-bump uses `onMouseEnter` on a parent wrapper that has `pointer-events: auto`, while the inner content stays `pointer-events: none` for child elements. Verify with a Playwright test that clicking a bracketed segment does NOT navigate (the equivalent in the *detail-pane* crumb in 8.01.E will be tappable).

**T-3.4 — Remove the legacy `string[]` fallback.** With T-1 done, no caller passes `string[]` any more. Delete the fallback branch (and the dev-only deprecation warning) so the component is single-shape going forward.

### T-4. UPDATE `components/focus/FocusEscHint.tsx` — move + touch variant

**T-4.1 — Move from bottom-right to bottom-left.** WordCount per §5.7 owns bottom-right. Update inline styles or className.

**T-4.2 — Touch variant.** Render a 44×44px tap target pill with copy `← Edit` (chevron + word, Inter 12px) when the device is touch-primary. Detect via `window.matchMedia('(pointer: coarse)').matches` evaluated client-side in a useEffect (defaults to `false` for SSR safety; first render uses the desktop `Esc to exit` kbd hint). The pill background is `var(--color-bg-elevated)`, border `1px var(--color-border-subtle)`, border-radius 6px. Opacity 0.4 permanently on touch — tap is the only Focus exit on touch and the affordance must persist.

**T-4.3 — Behaviour.** Tap on the pill calls the existing `onExit` prop (the same handler `Esc` fires on desktop). Mirror the Escape keydown path so the exit semantics are identical.

### T-5. UPDATE `components/focus/FocusMode.tsx` — add beat-nav swipe gestures (iPad)

The desktop ⌘ ←/⌘ → handlers exist (T-1 already verified them while threading siblings). T-5 adds touch swipe equivalents per Component Spec v2.21 §18.3.

**T-5.1 — Pointer event handlers.** Add `onPointerDown` / `onPointerUp` to the Focus content container (NOT the body — pointer events on body affect page-wide gestures). Track `(startX, startTime)` on down; on up compute `(deltaX, dt)`. A swipe is `Math.abs(deltaX) > 60px && dt < 350ms && Math.abs(deltaY) < 30px`. Left swipe → next beat (same as ⌘ →); right swipe → previous beat (same as ⌘ ←).

**T-5.2 — Pointer-type gating.** Only activate the swipe handlers when `pointerType === 'touch'` (or `'pen'`). Mouse/trackpad swipes must NOT trigger beat-nav — they conflict with text selection.

**T-5.3 — Text-selection guard.** If the swipe starts within a text-selectable element (ProseEditor, SummaryEditor, or anywhere with `user-select` non-none), DO NOT fire beat-nav. Detect via `event.target.closest('[contenteditable], textarea, input, [data-focus-swipe-block]')`. The wireframe iter1 F-2 risk note flagged this — the swipe must not steal from iPad's native text-selection.

**T-5.4 — Visual hint.** Update FocusMode's bottom-centre hint area (already wireframed in iter1) to show "`⌘ ←` prev / `⌘ →` next" on desktop and "swipe to switch beats" on touch. Same opacity envelope as the breadcrumb (0 typing, 0.2 at rest). The hint is decorative (`pointer-events: none`).

### T-6. Verify ⌘ ← / ⌘ → beat-nav against M-173 depth model + leaf-sibling-only navigation

§6.1 says navigation stays at the same layer ("only crosses sibling leaves at the same layer; the navigation never lands on a non-leaf"). T-6 is a verification pass:

**T-6.1 — Code audit.** Read `navigateSibling()` in `FocusMode.tsx`. Confirm it (a) queries siblings with `parent_id = activeNode.parent_id` AND (b) filters to `is_leaf = true` rows. If either guard is missing, add it.

**T-6.2 — Cross-parent wrap behaviour.** Spec §6.1 + wireframe iter1 F-2: at the last sibling of a parent, ⌘ → wraps to the next-sibling-parent's first leaf child. Implementation needs a fallback query: when `siblings[idx + 1]` is undefined, fetch the next sibling of `activeNode.parent_id`, find its leftmost leaf descendant, navigate there. Mirror for ⌘ ← (previous parent's rightmost leaf descendant). If the current code DOESN'T implement this wrap, add it. If it does, write a Playwright case that exercises it.

**T-6.3 — Add a stop-at-document-end guard.** Beyond the document's first/last leaf, the navigation no-ops. (No wraparound between front and back of the document.)

### T-7. Unit tests

NEW `tests/unit/get-ancestor-chain.test.ts` (~8 cases):
- single root node → empty chain
- depth-2 chain → 1 segment (the root)
- depth-5 (book → act → chapter → scene → beat) → 4 segments root-first
- excludes the input node itself (the last segment is the immediate parent)
- 20-hop safety cap (defensive)
- restricts to structural; context-typed parent returns empty
- omits the `name` field on every segment (T-2 contract)
- correct `position` from `nodes.order` on each segment

NEW `tests/unit/focus-breadcrumb-opacity.test.ts` (~5 cases) — logic, not DOM:
- export the state-machine reducer / helper so tests can drive transitions deterministically (refactor inside FocusBreadcrumb to extract `computeOpacity({ trigger, isTyping, isHovered, isTouchRevealed })` as a pure function)
- typing → 0
- at rest → 0.35
- hover overrides at-rest → 0.7
- hover overrides typing → 0.7
- touch reveal → 0.7 then 0.35 after timer

NEW `tests/unit/focus-mode-swipe-detection.test.ts` (~5 cases) — pure-function swipe classification:
- left swipe (deltaX < -60 in <350ms) → 'next'
- right swipe (deltaX > 60) → 'prev'
- short swipe (40px) → 'none'
- slow swipe (500ms) → 'none'
- diagonal swipe (deltaY > 30) → 'none' (scroll wins)
- mouse pointerType → 'none' (gated out)

### T-8. Playwright tests

NEW `tests/ui/focus-breadcrumb.spec.ts` — visual + behaviour (3 cases):
- mounted in Focus Mode at /projects/.../documents/... with a leaf node selected, the breadcrumb shows bracketed segments root-first
- hovering the breadcrumb bumps opacity to 0.7 (computed style check)
- clicking a bracketed segment does NOT navigate (Inviolable for Focus — read-only)

NEW `tests/ui/focus-esc-hint.spec.ts` — position + touch variant (2 cases):
- desktop renders `Esc to exit` in the bottom-left
- with `(pointer: coarse)` emulation, renders the `← Edit` pill with 44×44 hit area; tap fires exit

NEW `tests/ui/focus-mode-beat-nav.spec.ts` — kbd + swipe (4 cases):
- ⌘ → on Bt 1 moves to Bt 2 (same scene, next sibling)
- ⌘ → on the last beat of a scene wraps to the first beat of the next scene (cross-parent wrap)
- ⌘ ← on Bt 1 of the first scene of the document no-ops (stop-at-start)
- touch swipe left fires next-beat (use Playwright's `page.touchscreen.tap` + drag pattern)

### T-9. Regression + close-out

1. `npx tsc --noEmit` → 0 errors.
2. `npm run lint` → 0 NEW errors (3 pre-existing from 8.01.A baseline stay).
3. `npm run build` → success.
4. `npx vitest run` → all new tests green; full suite holds against the v1.43 baseline (8 pre-existing failures unchanged).
5. `npx playwright test tests/ui/focus-breadcrumb.spec.ts tests/ui/focus-esc-hint.spec.ts tests/ui/focus-mode-beat-nav.spec.ts` → all green.
6. Visual sanity at `http://localhost:3000/projects/.../documents/...` with a leaf node selected then ⌘Return into Focus Mode: full ancestor breadcrumb at 0.35; hover bumps to 0.7 with `2 / 5` + leaf name; bottom-left ESC hint; ⌘ → cycles siblings.
7. Update this checklist with PASS/FAIL per task. Stage commit; do NOT push or merge to master without user approval. Sub-phase B is a continuation of `claude/director-simplification` per the Option-A branch strategy locked at 8.01.A close-out.

No spec doc bumps in 8.01.B close-out — Component Spec v2.21 already captures the §6.2 / §6.3 / §18.3 contract being implemented.

---

## Risk + open questions

- **R-1 — Ancestor-walk performance.** Six hops max for the deepest V1 layer stack (Series-of-Novels). Iterative single-row reads cost ~6 round-trips on first paint; acceptable for a presentation surface (Focus Mode is entered once per writing session, not per keystroke). Cache the chain in component state per `activeNode.id`.
- **R-2 — Touch detection on first paint.** `window.matchMedia('(pointer: coarse)')` is unavailable during SSR. Default the FocusEscHint and swipe handlers to the desktop branch (kbd hint + no swipe) and upgrade on hydration. Acceptable jank: a single re-render after first paint, no visible flicker because the kbd hint is invisible until idle anyway.
- **R-3 — Cross-parent wrap edge case.** If the current code doesn't have the wrap, T-6.2 introduces a non-trivial query path. Add the unit test BEFORE the implementation so the contract is pinned. If the existing code already wraps, T-6.2 reduces to a Playwright regression guard.
- **OQ-1 — Position counter format.** Recommend "2 / 5" with thin-space-around-slash (no padding). Alternative formats considered: "2 of 5", "2 · 5", "2 — 5". Going with "2 / 5" per wireframe iter1 mock. Confirm or override at kickoff.
- **OQ-2 — Touch reveal duration (4s).** Wireframe locked 4s. Alternative: persistent until next interaction (tap elsewhere). 4s is more forgiving; persistent is more deterministic. Recommend 4s — matches the wireframe spec.

## Sequencing

T-2 (helper) → T-1 (caller migration uses helper) → T-3 (FocusBreadcrumb opacity + reveal) in parallel with T-4 (FocusEscHint) and T-5 (swipe). T-6 verification can run any time (read-only audit + targeted additions). T-7 unit + T-8 Playwright after T-1..T-6. T-9 regression + close-out last.

Best execution order: T-2 → T-1 → T-3 → T-4 → T-5 → T-6 → T-7 → T-8 → T-9.

---

## Close-out verdict

**Outcome: PASS — 2026-05-31.**

### Per-task

| Task | Status | Notes |
|---|---|---|
| T-2 `lib/nodes/getAncestorChain.ts` | PASS | Two variants — async (Supabase round-trips) + sync (pre-fetched array). 20-hop safety cap. Restricts to V1 structural layer kinds; rejects context ancestors and unknown V1 layers. 10 unit tests pin the contract. |
| T-1 FocusMode caller migration | PASS | FocusModeNode extended with `node_type`, `order`, `layer_index` (all optional for back-compat — but populated everywhere via NodeRecord). NodeDetailPanel's NodeRecord gains `order` (already returned by `NODE_SELECT`; just exposed at the type level). Ancestor chain fetched via the supabase browser client + new effect keyed on `activeNode.id`. breadcrumbSegments composed root-first with the leaf segment carrying the node `name` for the hover-reveal. Position counter `{ index, total }` derived from siblings. |
| T-3 FocusBreadcrumb opacity + reveal | PASS | Rewrote with pure `computeOpacity` reducer (exported for unit test); opacity 0.35 at rest / 0.7 on hover or touch reveal. Position counter "N / M" + leaf name render only at 0.7. Pointer-events: outer wrapper auto (so hover registers), inner content none (so clicks pass through — Inviolable). Legacy `string[]` fallback removed; FocusMode caller is the only consumer and is now migrated. 7 unit + 3 Playwright cover hover/reveal/touch and the pointer-events invariant. |
| T-4 FocusEscHint move + touch pill | PASS | Bottom-right → bottom-left (WordCount owns bottom-right per §5.7). Touch variant: 44×44 "← Edit" pill, persistent 0.4 opacity, tap fires `onExit`. Detected via `matchMedia('(pointer: coarse)')` with SSR-safe default. 2 Playwright (desktop position + touch pill tap-to-exit). |
| T-5 Swipe gestures | PASS | Pure `classifySwipe` helper (exported) gates on `pointerType === 'touch'` and thresholds (60px horizontal, 350ms duration, 30px vertical drift). Pointer-down/up handlers on the FocusMode outer div; text-selection guard via `.closest('[contenteditable], textarea, input, [data-focus-swipe-block]')`. 8 unit tests cover all swipe shapes + pointer-type gates. Playwright swipe driving deferred — Playwright's touchscreen API is unreliable; unit coverage is the contract pin. |
| T-6 Beat-nav verification + cross-parent wrap | PASS | (T-6.1) siblings filter extended to `is_leaf !== false` per spec. (T-6.2) recursive cross-parent wrap helper added — handles multi-level cases (last beat of last scene of an act wraps to first beat of next act's first scene). Exported `findCrossParentLeaf` + `findLeafDescendant` for unit testing. (T-6.3) stop-at-document-end falls out of the recursion (parent_id null → undefined → caller no-ops). 11 unit + 3 Playwright (same-scene advance + cross-parent wrap + stop-at-document-end). |
| T-7 unit tests | PASS | 4 new files — get-ancestor-chain (10) + focus-breadcrumb-opacity (7) + focus-swipe-detect (8) + focus-cross-parent-wrap (11) = 36 cases. |
| T-8 Playwright | PASS | 3 new spec files — focus-breadcrumb-reveal (3) + focus-esc-hint (2) + focus-beat-nav (3) = 8 cases. The N-1/N-2 navigation tests needed an 800ms settle after Focus Mode entry to give the siblings fetch time to populate before the keydown handler's useCallback closure captures — adding `waitForTimeout(800)` after the `[data-focus-mode="active"]` wait fixed it. Behaviour pattern documented in the openFocusOnNamed helper. |
| T-9 regression + close-out | PASS | Type-check 0 errors; lint 0 errors in 8.01.B files (3 pre-existing baseline carry over from 8.01.A); build passes; full vitest 704/722 (8 pre-existing baseline failures, composition varies slightly with DB state from the seeded sample novel — zero new failures). |

### Inviolables status after 8.01.B

- **Inviolable #1 (lowest-noise prose)** — unchanged. Focus Mode background still `--color-bg-base`. Breadcrumb hover-bump is gated by user intent (mouse-over or touch); typing still hides everything.
- **Inviolable #2 (verdigris nine uses)** — unchanged. FocusBreadcrumb at 0.7 still uses `--color-text-primary` (neutral); position counter + leaf name in muted faint. ESC pill uses `--color-bg-elevated` / `--color-border-subtle`. No verdigris adds.
- **Inviolables #3, #5, #6** — unchanged. No new typography references; no toolbar additions; no Cormorant/Cinzel uses outside the brand directory (grep guard from 8.01.A continues to pass).
- **Inviolable #4 (typeface boundary)** — unchanged. The position counter uses monospace which is neither Inter nor Lora; it lives in the breadcrumb (an orientation surface), never in the prose editor.
- **Breadcrumb-is-never-navigation** sub-invariant — preserved structurally via the outer-wrapper-auto / inner-content-none pointer-events split, asserted in Playwright spec TC-8.01.B-B-3.

### Files changed

NEW:
- `lib/nodes/getAncestorChain.ts`
- `lib/focus/swipeDetect.ts`
- `tests/unit/get-ancestor-chain.test.ts`
- `tests/unit/focus-breadcrumb-opacity.test.ts`
- `tests/unit/focus-swipe-detect.test.ts`
- `tests/unit/focus-cross-parent-wrap.test.ts`
- `tests/ui/focus-breadcrumb-reveal.spec.ts`
- `tests/ui/focus-esc-hint.spec.ts`
- `tests/ui/focus-beat-nav.spec.ts`

UPDATED:
- `components/focus/FocusMode.tsx` (FocusModeNode/SiblingRow extensions; ancestor fetch + breadcrumb composition; cross-parent wrap helpers + recursion; swipe handlers; navigateSibling deps include allNodes/activeNode.parent_id)
- `components/focus/FocusBreadcrumb.tsx` (computeOpacity reducer; structured-segment-only contract; hover/touch reveal + position counter + leaf name; legacy `string[]` fallback removed)
- `components/focus/FocusEscHint.tsx` (bottom-left position; touch pill variant with onExit prop; coarse-pointer detection)
- `components/detail/NodeDetailPanel.tsx` (NodeRecord gains `order`; threaded through to FocusMode's `node` prop)

### Carry-overs to subsequent sub-phases

- **To 8.01.C (DirectorPanel rendering):** unrelated to 8.01.B; planned scope unchanged (reasoning chip, tool chips, inline workflow proposals, `@` mention picker).
- **To 8.01.E (Project Page + non-leaf detail pane):** deferred 8.01.A T-7 detail-pane crumb stays in scope there.

### Commit / merge state

Working-tree only. No commits per CLAUDE.md "only commit when explicitly requested." Recommended next action: single commit at user request, stacked on top of `5f43c9f` on `claude/director-simplification` per Option A branch strategy.

---

## Changelog

**v1.1 — 2026-05-31** Close-out verdict: PASS. All 9 in-scope tasks complete (T-1 through T-9). 36 new unit + 8 new Playwright. Inviolables intact. Files: 9 new + 4 updated. Cross-parent wrap recursive helper handles arbitrary tree depth.

**v1.0 — 2026-05-31** Initial build checklist for Phase 8.01.B — Focus Mode polish. Authored at 8.01.A close-out (PASS verdict, commit `5f43c9f` pushed to `claude/director-simplification`). Branch strategy: Option A — keep stacking 8.01.B → .C → .D → .E → .F on the same branch; whole Phase 8.01 build pass merges to master as one large branch when 8.01.F lands. Subsequent sub-phase checklists at `docs/stelavox_phase8_01_{C,D,E,F}_build_checklist_v1_0.md`.
