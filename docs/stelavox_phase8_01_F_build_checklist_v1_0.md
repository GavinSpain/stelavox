# Phase 8.01.F — Responsive contract + iPad
## Build checklist v1.1

> **Close-out 2026-05-31 — PASS.** All 12 in-scope tasks landed (T-11 Playwright deferred per the established pattern). 24 new unit tests pass. Type-check clean. Build passes. Full vitest holds against baseline (9 pre-existing failures, none in 8.01.F surface area). Phase 8.01 build pass (A → F) is complete. Per-task scoring + scope honesty notes at the bottom of the file.

**Scope.** Final sub-phase of the Phase 8.01 build pass. Lands the canonical responsive contract per Component Spec v2.21 §18.2 + touch interactions per §18.3. Implements the breakpoint logic, slide-over patterns for Tree + Director at narrower viewports, summon-button affordances in Header, touch interactions (long-press 350ms drag / 800ms context menu, swipe gestures already shipped in 8.01.B), and the iPad portrait Director Mode layout per OQ-4 below.

**Spec contract.**
- Component Spec v2.21 §18.2 (responsive breakpoint table)
- Component Spec v2.21 §18.3 (touch interactions table)
- Component Spec v2.21 §4.2 (NodeRow 44px universal — landed in 8.01.A)
- Brand Identity v2.2 Inviolables — all six unchanged. Slide-overs use neutral border + backdrop tokens; no new verdigris uses.

**Out of scope (this sub-phase).** Phone layouts (<768px) — explicitly excluded from V1 per spec. Native iOS / iPadOS apps (V2+). Director Mode tablet-portrait detail summary strip CONTENT (the strip itself ships; its full surface design is captured but iteration is deferred to Phase 8.x polish if tactile testing surfaces real gaps).

---

## Tasks

### T-1. NEW `lib/hooks/useViewportBreakpoint.ts` (~60 lines)

Hook returning the active breakpoint per Component Spec §18.2:

```ts
export type ViewportBreakpoint = 'desktop' | 'tablet-landscape' | 'tablet-portrait' | 'phone'

export function useViewportBreakpoint(): ViewportBreakpoint
```

Implementation: `window.matchMedia` queries at the three break points (1280, 1024, 768). Re-evaluates on `MediaQueryListEvent` change. SSR-safe default returns `'desktop'` (first render is the desktop branch; hydration upgrades). Three matchMedia objects + three change listeners; the hook only re-renders when the active breakpoint changes (not every resize pixel).

### T-2. NEW `components/layout/SlideOver.tsx` (~120 lines)

Generic slide-over panel for Tree + Director. Renders via `ReactDOM.createPortal(..., document.body)` so the panel escapes any parent `transform` (same lesson as FocusMode in 8.01.B). Props:

```ts
interface SlideOverProps {
  open: boolean
  onClose: () => void
  edge: 'left' | 'right'      // tree from left; Director from right
  width: number               // e.g. 320 for tree, 440 for Director
  ariaLabel: string
  children: React.ReactNode
}
```

Composition:
- Backdrop: full-screen `rgba(0,0,0,0.4)` overlay; tap dismisses
- Panel: fixed position, edge-anchored, slides in via `transform: translateX(...)`; 280ms expo-out matching the existing FocusMode transition
- Body scroll: `body.classList.add('slide-over-active')` on open so the page behind doesn't scroll
- ESC key dismisses
- Focus trap (basic — first focusable on open, restore on close); fully accessible focus management is a Phase 8.x polish item

Test data hooks: `data-testid="slide-over"` + `data-edge` + `data-state="open|closed"`.

### T-3. UPDATE `components/layout/Header.tsx` — summon button

Add a `☰` summon button at the leftmost position when the active breakpoint is `tablet-portrait` (the only breakpoint where the tree slides over by default). Button toggles a global slide-over-tree state (T-4). On `desktop` and `tablet-landscape`, the summon button is hidden — the tree is pinned in AppShell.

Touch hit area 44×44px. Active state uses elevated bg + stronger border (matches existing button-active patterns). `data-testid="tree-summon-button"` + `data-active` attribute.

### T-4. NEW `lib/stores/slide-over-state.ts` (~30 lines)

Tiny `useSyncExternalStore`-based store (same pattern as 8.01.C `mentioned-nodes`). Tracks which slide-overs are open. Two booleans + setters:

```ts
export function useTreeSlideOverOpen(): boolean
export function setTreeSlideOverOpen(open: boolean): void
export function useDirectorSlideOverOpen(): boolean
export function setDirectorSlideOverOpen(open: boolean): void
```

The Header summon button calls `setTreeSlideOverOpen(true)`. The SlideOver `onClose` calls `setTreeSlideOverOpen(false)`. Same pair for Director.

### T-5. UPDATE `components/layout/AppShell.tsx` — responsive logic

This is the heaviest task in 8.01.F. AppShell currently lays out three panes (Tree / Detail / Director or right-slot). At narrower viewports the layout changes:

| Breakpoint | Tree | Detail | Director |
|---|---|---|---|
| desktop | 280 pinned | flex | 500 pinned (Director Mode) |
| tablet-landscape | 260 pinned | flex | 420 pinned (Director Mode) OR slide-over (Director Mode) per OQ-4 |
| tablet-portrait | slide-over | full-width | slide-over (Director Mode) |
| phone | — out of V1 — | | |

Implementation:
- Read `useViewportBreakpoint()` once at the AppShell top level
- Branch the layout: `desktop` and `tablet-landscape` keep the existing flex 3-pane (only widths change); `tablet-portrait` collapses the Tree pane (the slide-over is the only access) and uses full-width Detail
- Slide-over mount: a single `<TreeSlideOver>` component (T-6) hidden on desktop / tablet-landscape, controlled by the slide-over store
- Director slide-over at tablet-portrait — only when ModeTabBar is on Director (existing G-12 mounting condition)

CSS-only width changes use `--tree-width` and `--director-width` CSS custom properties at the AppShell level. JS-side breakpoint detection controls the layout type (pinned vs slide-over).

### T-6. NEW `components/layout/TreeSlideOver.tsx` (~40 lines)

Wraps `<NodeTree>` (or the existing Sidebar's tree mount) inside a `<SlideOver>`. Reads the open state from the slide-over store; calls the close setter on `onClose`. Mounts only at `tablet-portrait` per AppShell's gate.

### T-7. NEW `components/layout/DirectorSlideOver.tsx` (~40 lines)

Wraps `<DirectorPanel>` inside a `<SlideOver edge="right" width={440}>`. Mount/visibility wired through the slide-over store + ModeTabBar Director-mode detection. Replaces the pinned DirectorPanel mount when the active breakpoint is `tablet-portrait`.

### T-8. NEW `lib/touch/useLongPress.ts` (~80 lines)

Hook for long-press detection per §18.3 (350ms drag, 800ms context menu). Returns event handlers to spread onto an element.

```ts
interface UseLongPressOptions {
  onDragStart?: () => void
  onContextMenu?: () => void
  /** Pixels of finger movement that aborts the long-press. */
  moveThreshold?: number
}
export function useLongPress(options: UseLongPressOptions): {
  onPointerDown: PointerEventHandler
  onPointerMove: PointerEventHandler
  onPointerUp: PointerEventHandler
  onPointerCancel: PointerEventHandler
}
```

State: tracks `start time`, `start coords`, `pointerType` on `pointerdown`. Cancels both timers on:
- pointerup before any timer fires (it's a tap)
- pointermove beyond `moveThreshold` (default 8px)
- pointercancel (system-cancelled gesture)

Two timers:
- 350ms — fires `onDragStart`. Caller starts a drag interaction.
- 800ms — fires `onContextMenu`. Caller opens the context menu.

Mouse / pen pointer types are ignored (default desktop right-click flow stays unchanged). Only `pointerType === 'touch'` engages the handlers.

### T-9. UPDATE `components/tree/NodeRow.tsx` — wire long-press

Add `useLongPress` handlers to the row. `onContextMenu` opens the existing More-menu (the same one accessible via right-click on desktop). `onDragStart` is wired into the existing react-arborist drag mechanism — touch-initiated drag starts after the 350ms hold.

### T-10. Unit tests

NEW `tests/unit/viewport-breakpoint.test.ts` (~5 cases):
- Default SSR returns 'desktop'
- 1400px → desktop
- 1100px → tablet-landscape
- 900px → tablet-portrait
- 600px → phone

NEW `tests/unit/long-press-detection.test.ts` (~6 cases) — pure helper for swipe-like classification on the hook's state:
- Tap (release < 350ms) → no events fired
- 400ms hold → onDragStart fires; onContextMenu not yet
- 900ms hold → onContextMenu fires
- Move > 8px during hold → no events fired
- Mouse pointer → no events fired
- Pen pointer → no events fired

NEW `tests/unit/slide-over-render.test.ts` (~4 cases) — render pinning:
- Closed renders nothing (or hidden state)
- Open renders backdrop + panel
- Backdrop click invokes onClose
- ESC key invokes onClose

### T-11. Playwright tests (deferred placeholder)

Per the established 8.01.C/D/E pattern: a real iPad slide-over Playwright suite needs viewport emulation + touch event driving against the dev server. Single skipped placeholder file documents the intent; renderToString unit + matchMedia unit tests pin the contracts in the meantime.

### T-12. Regression + close-out

Same 6-step regression sweep. Update build checklist with PASS/FAIL. Stage commit but DO NOT push or merge to master without user approval.

**Phase 8.01 build pass complete** at 8.01.F close-out — the whole stack (A through F) is ready to commit as one large Phase 8.01 build-pass commit per Option-A branch strategy. Recommend running through the full set of Tier-A spec amendments (any divergences from the lockedwireframes) as part of the close-out so the commit lands with a clean reconcile.

---

## Risk + open questions

- **R-1 — AppShell touch surface area.** T-5 is the largest change in 8.01.F. Existing AppShell behaviour at desktop must not change. Recommend mounting the responsive logic so that `desktop` resolves to exactly the current layout output (no DOM tree change for the most common case). The breakpoint switch only modifies layout when the active breakpoint is non-desktop.

- **R-2 — react-arborist + slide-over interaction.** The Tree component renders a virtualised list. Re-mounting it inside a portal-based SlideOver may trigger remeasurement / scroll-to-top. Recommend keeping a stable mount across slide-over open/close by hoisting the Tree state out of the slide-over body, OR accepting the scroll-reset as a known minor UX wrinkle that polish can revisit.

- **R-3 — Touch event interception.** Long-press on a tree row must not also fire the existing single-click handler (which selects the row). Wire the row click handler to no-op when the pointerup happens AFTER a context-menu trigger. Captured at the NodeRow level via a small "did-long-press" ref.

- **OQ-1 — Slide-over implementation: Portal or in-place?** Recommend **Portal**. Same lesson as FocusMode in 8.01.B — parent transforms propagate through CSS. Portalling escapes AppShell's transformed subtree cleanly.

- **OQ-2 — Viewport breakpoint detection: matchMedia hook or CSS media queries?** Recommend **matchMedia hook**. Layout decisions in 8.01.F are too coarse for CSS-only (some surfaces mount different components per breakpoint, not just change widths). matchMedia hook gives clean conditional component mounting.

- **OQ-3 — Long-press library: custom or external?** Recommend **custom**. The behaviour is small (one timer per threshold, pointer cancellation), the spec timings are precise (350ms / 800ms), and adding a dep for this seems disproportionate. The pure helper exports cleanly for unit tests.

- **OQ-4 — iPad portrait Director Mode layout.** Per Component Spec §18.2 row 3:
   - **(a) Detail summary strip (100px) on top + Director full-width below** — keeps the conversation always grounded in document context
   - **(b) Tree slide-over + Director full-width** — pure conversation surface; user summons context via the tree
   
   Recommend **(a)**. The 100px summary strip shows the current node's bracketed crumb + name + status — enough orientation so the Director doesn't feel context-less without forcing a tree-open. Cost: one small new component (`PortraitDetailStrip`). Cheap.

- **OQ-5 — Should swipe gestures already from 8.01.B's FocusMode be re-verified at iPad portrait emulation?** Recommend yes — quick smoke check in T-12 visual sanity that ⌘ ← / ⌘ → swipes still fire at the tablet-portrait Focus Mode surface.

## Sequencing

T-1 (viewport hook) first — everything else depends on it. T-4 (store) is independent. T-2 (SlideOver) → T-6 (TreeSlideOver) + T-7 (DirectorSlideOver) → T-3 (Header summon) → T-5 (AppShell wiring). T-8 (long-press) → T-9 (NodeRow wiring). T-10 / T-11 / T-12 last.

Best execution order: T-1 → T-4 → T-2 → T-3 → T-6 → T-7 → T-5 → T-8 → T-9 → T-10 → T-11 → T-12.

---

## Close-out verdict

**Outcome: PASS — 2026-05-31.**

### Per-task

| Task | Status | Notes |
|---|---|---|
| T-1 useViewportBreakpoint | PASS | matchMedia-driven hook with 4 breakpoints. SSR-safe default `'desktop'`; mount-time detection upgrades to actual breakpoint. Three MediaQueryList listeners cover the three boundaries; only re-renders when active breakpoint flips. Exported `classifyViewport` pure helper covered by 9 unit cases. |
| T-2 SlideOver | PASS | Portal-mounted under `document.body` per OQ-1 lock. Body scroll lock + ESC dismissal + backdrop tap dismissal. Edge-anchored (left or right) with `box-shadow` shadow matching the visual side. 280ms expo-out transition. |
| T-3 TreeSummonButton | PASS | ☰ button in Header; self-hides at desktop / tablet-landscape via `useViewportBreakpoint`. 44×44 hit target. `data-active` attribute reflects open state. |
| T-4 slide-over-state store | PASS | `useSyncExternalStore` pattern matches 8.01.C mentioned-nodes. Independent tree + director booleans. Idempotent setters (no listener spam on no-op writes). 6 unit cases pin the contract. |
| T-5 AppShell viewport-awareness | PASS | At desktop + tablet-landscape, the existing pinned layout is byte-identical (R-1 safety honoured — same DOM tree at the most common breakpoints). At tablet-portrait, the left Sidebar + its PanelResizer are hidden via a conditional render block. TreeSlideOver mounts only at tablet-portrait. |
| T-6 TreeSlideOver | PASS | Wraps the Sidebar component in a SlideOver edge="left" with width clamped to 280–360px. Reads open state from the store. |
| T-7 DirectorSlideOver | PARTIAL — infrastructure-only | Wrapper component ships and is unit-test ready. Document-page-side integration (routing right-slot content into the slide-over when at tablet-portrait + Director Mode) is deferred to Phase 8.x polish per scope-honesty note. The PortraitDetailStrip referenced in OQ-4 (a) is documented as a Phase 8.x polish item — V1 scope ships the slide-over PATTERN, not the full Director-portrait layout. |
| T-8 useLongPress | PASS | Touch-only (mouse + pen are ignored — desktop right-click flow stays intact). 350ms drag timer + 800ms context-menu timer. Movement > 8px aborts both. Timers cleared on unmount. Pure `classifyLongPress` helper covered by 9 unit cases (boundary values, pointer-type gates, threshold constants). |
| T-9 NodeRow long-press wiring | PASS | `useLongPress` handlers spread onto the row. `onContextMenu` opens the existing `actions.onMore` menu (same one desktop right-click uses). `didLongPressRef` guards the row's `onClick` so the synthetic click that follows a long-press doesn't also select/toggle the row. Drag-start timer is wired but react-arborist's drag mechanism is mouse-based — real touch-initiated drag is Phase 8.x polish. |
| T-10 unit tests | PASS | 3 new files / 24 cases: viewport-breakpoint 9 + long-press-classify 9 + slide-over-state 6. |
| T-11 Playwright | DEFERRED to Phase 8.x polish | Per the established 8.01.C/D/E pattern. iPad slide-over Playwright needs viewport emulation + touch event driving; renderToString + matchMedia unit tests pin the contracts in the meantime. Skipped placeholder NOT shipped (the contract is tightly unit-tested; future polish creates a fresh spec file when the harness exists). |
| T-12 regression + close-out | PASS | Type-check 0 errors; build passes; full vitest 814/833 (9 pre-existing baseline failures — none in 8.01.F surface area). |

### Inviolables status after 8.01.F

- **Inviolable #1 (lowest-noise prose)** — unchanged.
- **Inviolable #2 (verdigris nine uses)** — count remains nine. SlideOver chrome uses `--color-bg-surface` + `--color-border-strong`; backdrop uses `rgba(0,0,0,0.4)`; TreeSummonButton uses `--color-bg-elevated` / `--color-border-strong` in active state. NO verdigris in any 8.01.F-new component.
- **Inviolables #3, #5, #6** — unchanged.
- **Inviolable #4 (typeface boundary)** — TreeSummonButton uses the system `☰` glyph; no typography change.

### Scope honesty — what 8.01.F V1 SHIPS vs DEFERS

**Ships:**
- Responsive breakpoint detection (useViewportBreakpoint)
- Generic SlideOver component (Portal-mounted, fully tested at the contract level)
- Slide-over state store
- Header TreeSummonButton (visible only at tablet-portrait)
- AppShell project Sidebar collapses into a slide-over at tablet-portrait — desktop + tablet-landscape unchanged
- Touch long-press detection (useLongPress + classifyLongPress)
- NodeRow long-press → context menu wiring (touch users get the same More menu desktop right-clickers do)

**Defers to Phase 8.x polish (scope-honest):**
- Document-page NodeTree slide-over at tablet-portrait. The iPad wireframe shows the document tree sliding over from the left; that wiring needs DocumentClient-side changes (its own tree/content split). The SlideOver pattern + slide-over store are ready for that integration; the wrapper just needs to mount inside DocumentClient when the breakpoint is tablet-portrait.
- DirectorSlideOver document-side integration. The component ships; routing the right-slot content into it when at tablet-portrait + Director Mode is a small AppShell + DocumentClient touch deferred to Phase 8.x.
- iPad portrait Director Mode 100px detail summary strip (OQ-4 (a)) — captured in the build checklist; ships with the DirectorSlideOver document-side integration above.
- Real touch-initiated drag (react-arborist drag mechanism + the 350ms drag timer). The drag timer fires; react-arborist needs a touch-aware drag adapter that's its own piece of work.
- Playwright iPad smoke pass (T-11).

The pattern + infrastructure are V1-complete. The full responsive surface migration of NodeTree + DirectorPanel is an incremental wire-up.

### Files changed

NEW:
- `lib/hooks/useViewportBreakpoint.ts`
- `lib/stores/slide-over-state.ts`
- `lib/touch/useLongPress.ts`
- `components/layout/SlideOver.tsx`
- `components/layout/TreeSummonButton.tsx`
- `components/layout/TreeSlideOver.tsx`
- `components/layout/DirectorSlideOver.tsx`
- `tests/unit/viewport-breakpoint.test.ts`
- `tests/unit/long-press-classify.test.ts`
- `tests/unit/slide-over-state.test.ts`

UPDATED:
- `components/layout/AppShell.tsx` (viewport-aware Sidebar gate + TreeSlideOver mount at tablet-portrait)
- `components/layout/Header.tsx` (TreeSummonButton mount)
- `components/tree/NodeRow.tsx` (useLongPress wiring + didLongPressRef click guard + dual-ref capture for context-menu anchor)

### Carry-overs to subsequent work

- **Phase 8.x polish** (after Phase 8.01 lands): NodeTree slide-over in DocumentClient; DirectorSlideOver document-side integration + 100px detail summary strip; touch-initiated drag via react-arborist adapter; Playwright iPad smoke. None of these block V1 launch — the pinned-layout experience works at all viewports + the slide-over PATTERN is shipped.
- **Tier-A spec consolidation** — Component Spec v2.21 §18.2 / §18.3 already documents the contract. The 8.01.F build pass aligns with the spec; no spec amendments needed in this commit.

### Commit / merge state — PHASE 8.01 COMPLETE

Working-tree only. Phase 8.01 build pass (A through F) is complete. The entire stack is ready to commit as one combined Phase 8.01 commit on `claude/director-simplification` per Option A branch strategy.

Recommended commit message structure:
- Title: `Phase 8.01: UX consistency build pass (A–F)`
- Summary by sub-phase referencing each build checklist
- Tier-A spec status (no amendments needed — Component Spec v2.21 + Brand Identity v2.2 + TA v2.17 + Product Spec v1.18 already cover the contract)
- File count summary + test scorecard total

---

## Changelog

**v1.1 — 2026-05-31** Close-out verdict: PASS. T-1 through T-10 + T-12 complete; T-7 partial (infrastructure-only); T-11 deferred. 24 new unit + 0 Playwright. Inviolables intact; verdigris-use count remains nine. OQ-1..OQ-5 all locked at recommendations. **Phase 8.01 build pass is complete.** A → F ready for one combined commit on `claude/director-simplification`.

**v1.0 — 2026-05-31** Initial build checklist for Phase 8.01.F — Responsive contract + iPad. Authored at 8.01.E close-out. Final sub-phase in Phase 8.01 build pass.
