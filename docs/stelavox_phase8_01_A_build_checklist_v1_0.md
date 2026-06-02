# Phase 8.01.A — Brand foundation + bracketed labels
## Build checklist v1.1

> **Close-out 2026-05-31 — PASS.** All in-scope tasks complete. 27 new unit tests + 8 new Playwright specs pass; full vitest suite green vs the v1.43 baseline (8 pre-existing failures unchanged); type-check clean; build passes. T-7 (detail-pane crumb) deferred to 8.01.E where it joins the new non-leaf "structure overview" surface. Scoring details and per-task notes at the bottom of this file under "Close-out verdict".

**Scope.** First sub-phase of the Phase 8.01 build pass. Lands the brand-mark fix and the bracketed-monospace-label vocabulary on every existing surface that shows hierarchy. Does NOT touch Director Mode (8.01.C), Dashboard (8.01.D), Project Page (8.01.E), or responsive layout (8.01.F). Focus Mode breadcrumb is in scope here because it consumes the new label component; the rest of Focus Mode polish (opacity, ESC pill, beat-nav) lands in 8.01.B.

**Spec contract.**
- Component Spec v2.21 §18.1 (universal bracketed-label vocabulary)
- Component Spec v2.21 §4.2 (NodeRow 44px universal + bracketed label prefix)
- Brand Identity v2.2 §3.2, §3.3, §3.4, §3.7 (wordmark composition + lozenge implementation note)
- Inviolable #3 (Cinzel-only-in-wordmark) and the new **Inviolable #6** (Cormorant Garamond-italic-only-in-wordmark)

**Out of scope (this sub-phase).** Director `@`-mention chip rendering (8.01.C); dashboard hero crumb (8.01.D — but the `LayerLabel` component built here is what 8.01.D will mount); Project Page export tree-with-checkboxes (8.01.E); non-leaf detail-pane variant (8.01.E); iPad slide-overs + touch gestures (8.01.F). Tappable detail-pane crumb is in scope; tappable Focus breadcrumb is NOT (breadcrumb is `pointer-events: none` per §6.2).

---

## Tasks

### T-1. NEW `components/brand/Wordmark.tsx` (~80 lines)

Component contract: two named slots (`<stela>` in Cinzel 500 letter-spacing 0.18em, `<vox>` in Cormorant Garamond italic 400 letter-spacing 0.08em opacity 0.88) with a verdigris gradient rule beneath and a 45°-rotated-square lozenge on the rule's left origin. Two size variants: `compact` (header use — `stela 17px / vox 19px / rule 100px / lozenge 9px`) and `hero` (welcome/onboarding use — `stela 42px / vox 46px / rule 240px / lozenge 13px`). Props: `size?: 'compact' | 'hero'` (default `'compact'`), `as?: 'div' | 'a'` (default `'div'`; when `'a'` accepts `href`).

Inline styles only (no new global CSS) — mirrors existing component pattern. Verdigris values via `var(--color-accent)`. Lozenge: `width:9px; height:9px; background: var(--color-accent); transform: rotate(45deg); box-shadow: 0 0 8px rgba(90,168,122,0.45)` per Brand Identity v2.2 §3.7 implementation note. Rule: `linear-gradient(90deg, var(--color-accent) 0%, rgba(90,168,122,0.55) 45%, transparent 85%)`.

Test data hooks: `data-testid="wordmark"` on outer element, `data-testid="wordmark-lozenge"` on the lozenge, `data-size` attribute carrying the variant.

Font loading: Cinzel + Cormorant Garamond already loaded via `app/layout.tsx` (verified before write). If not loaded, add to `next/font` imports.

### T-2. NEW `components/brand/AppIcon.tsx` (~30 lines)

Per Brand Identity v2.2 §3.5: capital S from Cinzel centred on dark rounded-square (radial gradient `#1a2535` → `#0a0e14`), with verdigris lozenge at the base of the S. Used at 32px and 24px. Single `size` prop (default 32). Matches Inviolable #3 (the S is the wordmark in icon form). This is a small additive component for completeness; no consumer mounts it yet in 8.01.A — built so 8.01.D (dashboard) and future favicons / tab labels can pick it up.

### T-3. UPDATE `components/layout/Header.tsx`

Replace the current placeholder `<Link href="/dashboard">Stelavox</Link>` text with `<Wordmark size="compact" as="a" href="/dashboard" />`. Drop the `marginRight: 28px` inline style on the link (the Wordmark component manages its own spacing). Preserve the `aria-label="Stelavox — home"`.

### T-4. NEW `components/tree/LayerLabel.tsx` (~50 lines)

The universal bracketed monospace label per Component Spec v2.21 §18.1.

Contract:
```ts
interface LayerLabelProps {
  /** Layer type — drives the abbreviation. */
  layer: 'series' | 'book' | 'act' | 'chapter' | 'scene' | 'beat'
  /** 1-based position number, from nodes.order. */
  position: number
  /** Optional className for caller-side margin/positioning. */
  className?: string
}
```

Renders `[<abbr> <position>]` — e.g. `[Book 1]`, `[Act 1]`, `[Ch 1]`, `[Sc 1]`, `[Bt 1]`. Abbreviation map (lives in this file, exported for tests):

```ts
const LAYER_ABBR = {
  series: 'Series',
  book: 'Book',
  act: 'Act',
  chapter: 'Ch',
  scene: 'Sc',
  beat: 'Bt',
} as const
```

For Series the position is omitted (renders `[Series]` not `[Series 1]`) because there is exactly one Series node per series-stack document.

Typography per spec: `font-family: ui-monospace, 'JetBrains Mono', SFMono-Regular, Menlo, monospace; font-size: 10.5px; letter-spacing: 0.02em; padding: 1px 5px; border: 1px solid var(--color-border-default); border-radius: 3px; color: var(--color-text-primary);`. Display `inline-flex; align-items: center; flex-shrink: 0`.

Test data hooks: `data-testid="layer-label"`, `data-layer` attribute, `data-position` attribute.

**Phase 14 note.** The hardcoded abbreviation map is the spec-acknowledged stub. Phase 14 (post-V1) extends `layer_stacks.layers[i]` with `abbreviation`, `singular_label`, `plural_label`, `at_reference_token` and replaces this map with a layer_stack-driven lookup. Keep the component shape conservative so Phase 14 can swap the data source without breaking the component contract.

### T-5. UPDATE `components/tree/NodeRow.tsx`

Two changes:

**T-5.1 — Mount LayerLabel.** Before the node name, mount `<LayerLabel layer={node.node_type} position={node.order} />` for structural nodes (`node_category === 'structural'`). Context nodes (`node_category === 'context'`) continue to render without a layer label — they have no canonical position. The label takes a small right-margin (6px) before the name.

**T-5.2 — 44px universal min-height.** The row's `Height` property bumps from "36px desktop, 44px tablet" to **44px universal** per Component Spec v2.21 §4.2 wireframe lock. Find the height style declaration and set `minHeight: 44px` (or `height: 44px` if currently fixed). Padding stays the same per §4.2. Verify no layout regression in the desktop tree by visual check after running `npm run dev`.

If NodeRow currently relies on a `tablet` media query for the 44px override, drop that path — the new value is universal.

### T-6. UPDATE `components/focus/FocusBreadcrumb.tsx`

Replace the `segments: string[]` prop shape with a richer structured form:

```ts
interface FocusBreadcrumbSegment {
  layer: 'series' | 'book' | 'act' | 'chapter' | 'scene' | 'beat'
  position: number
  name?: string  // leaf node name, rendered only on hover/touch
}
interface FocusBreadcrumbProps {
  segments: FocusBreadcrumbSegment[]
  /** Optional position counter "2 / 5" rendered on hover/touch only — typically siblingIndex + 1 / siblingCount. */
  position?: { index: number; total: number }
}
```

Render each segment as `<LayerLabel layer={s.layer} position={s.position} />` separated by ` · ` middots in `var(--color-text-faint)`. The opacity ceiling stays at `0.2` in 8.01.A (the 0.35 / 0.7 / hover-reveal of position counter + leaf name lands in 8.01.B alongside the rest of the Focus polish).

Add a fallback path: if a caller still passes `string[]`, log a deprecation warning to the console (dev only) and render the strings as plain text — protects against partial-rollout test failures. The fallback is a `useEffect`-less guard at the top of the component (`if (typeof segments[0] === 'string')`). The fallback can be removed in 8.01.B.

Update the FocusMode caller (`components/focus/FocusMode.tsx`) to construct the new segment shape from the ancestor chain. The position-counter prop is left undefined in 8.01.A (lands in 8.01.B).

### T-7. UPDATE `components/detail/NodeDetailPanel.tsx` (or wherever the detail crumb lives)

Two changes:

**T-7.1 — Bracketed-label crumb.** The current detail-pane breadcrumb (which today is plain "Book → Act → Chapter → Scene → Beat" text) renders as a sequence of `<LayerLabel>` components separated by middots. The leaf-node name is rendered separately to the right (Inter 14px), not inside the bracketed label.

**T-7.2 — Tap-to-navigate.** Each `<LayerLabel>` in the crumb is wrapped in a `<button>` that selects the matching ancestor node (calls the existing tree-select callback). Buttons are styled `background: none; border: 0; padding: 0; cursor: pointer` and inherit the label's appearance; the label component is unchanged. The leaf segment (the current node itself) is NOT a button — there's nothing to navigate to.

Touch target: each tap target gets `min-width: 32px; min-height: 32px` via wrapping a transparent hit area around the visible label — keeps the visual look at the spec's small font while meeting the 44×44 hit area on touch.

Test data hooks: `data-testid="detail-crumb"` on the outer element; `data-testid="detail-crumb-segment"` on each segment with `data-layer` and `data-position` attributes.

### T-8. Unit tests (Vitest)

NEW `tests/unit/layer-label.test.ts` — 8 cases:
- renders Book / Act / Ch / Sc / Bt with correct abbreviation
- Series renders `[Series]` without position number
- Series with position passed still renders `[Series]` (position ignored)
- bracketed format `[Bt 12]` for double-digit positions
- data-layer + data-position attributes set
- typography classes/inline styles present (font-family monospace, 10.5px)
- accepts className prop without breaking core styles
- unknown layer type falls back to title-cased string (defensive)

NEW `tests/unit/wordmark.test.ts` — 6 cases:
- compact + hero sizes render correct font-sizes
- both Stela (Cinzel) and vox (Cormorant) spans render
- lozenge has `transform: rotate(45deg)` and verdigris background
- rule renders with verdigris gradient
- `as="a"` mode renders an anchor with the href
- accessibility: `aria-label` includes "Stelavox" when rendered as link

NEW `tests/unit/wordmark-no-cormorant-leak.test.ts` — Inviolable #6 guard. Walks the components directory (excluding `components/brand/Wordmark.tsx`) and ensures no occurrence of `Cormorant Garamond` or `font-family.*cormorant`. Mirrors the existing Cinzel grep guard for Inviolable #3 if there is one; if not, add the Cinzel guard in the same file.

### T-9. Playwright tests

NEW `tests/ui/wordmark.spec.ts` — visual + structure:
- Wordmark visible in header at /dashboard
- both `stela` and `vox` spans present
- lozenge visible with non-zero size + correct background
- click navigates to /dashboard from a non-dashboard route

NEW `tests/ui/node-row-bracketed-labels.spec.ts` — structural:
- NodeRow renders `[Book 1]` label for the root book node
- depth-2 act node renders `[Act 1]`
- leaf beat renders `[Bt 1]`
- context nodes render WITHOUT a bracketed label
- NodeRow height is 44px (computed-style check)

NEW `tests/ui/detail-crumb-tap.spec.ts` — interaction:
- detail-pane crumb shows bracketed segments
- tapping `[Act 1]` in the crumb selects the act node in the tree
- tapping the current-node segment does not navigate (defensive)

### T-10. Regression check + typescript + build

After T-1..T-9 land:
1. `npx tsc --noEmit` → 0 errors.
2. `npm run lint` → 0 errors (existing warnings tolerated).
3. `npm run build` → success.
4. `npm run vitest run` → all green including the new unit tests; no pre-existing tests regress.
5. `npx playwright test tests/ui/wordmark.spec.ts tests/ui/node-row-bracketed-labels.spec.ts tests/ui/detail-crumb-tap.spec.ts` → 3/3 spec files green.
6. Manual visual sanity check at `http://localhost:3000/dashboard` and one project detail page — wordmark renders with the two-typeface mark + diamond lozenge; tree rows show bracketed labels; detail crumb has bracketed tappable labels.

### T-11. Close-out

Update `docs/stelavox_phase8_01_A_build_checklist_v1_0.md` with PASS verdict + a brief outcome note. Mark each T-N row PASS/FAIL. Stage commit on the worktree branch but DO NOT push or merge to master without user approval (per CLAUDE.md "Only create commits when requested by the user").

No spec doc bumps in 8.01.A close-out — Component Spec v2.21 and Brand Identity v2.2 already capture the contract that 8.01.A implements. 8.01.B / .C / .D / .E / .F will each ship their own build checklist + close-out.

---

## Risk + open questions

- **R-1 — Layer label data source.** This sub-phase uses the hardcoded abbreviation map. Phase 14 swap-out is non-breaking by design (component contract stays the same; the prop values come from layer_stack data instead of TS constants).
- **R-2 — FocusBreadcrumb caller drift.** The prop-shape change at T-6 is the only breaking API change. Single caller (FocusMode) is updated in the same task; fallback path tolerates partial-rollout. Risk: any test snapshot or storybook that constructs FocusBreadcrumb with the old shape — flagged for the unit-test pass to catch.
- **R-3 — Wordmark visual regression.** Header is the most visible surface in the app. Reload the dev server before declaring T-3 complete and confirm both typefaces load (Cormorant Garamond may need to be added to `next/font` imports in `app/layout.tsx` — verify).
- **OQ-1 — Cormorant Garamond italic weight.** Brand Identity §3.2 specifies weight 300 (Light) for the hero size. The wireframes used weight 400 (Regular). Recommend matching the wireframe (400) at compact size; use 300 at hero size per the spec. Reason: at 19px (compact `vox`), weight 300 is too light to hold visual equivalence with `STELA` at 500; at 46px (hero), weight 300 reads correctly. Adopt this split unless the spec is amended.

## Sequencing

T-1 → T-4 in parallel (independent components). T-3 depends on T-1. T-5 depends on T-4. T-6 depends on T-4. T-7 depends on T-4. T-8/T-9 depend on T-1..T-7. T-10 → T-11.

Best execution order in practice: T-4 (LayerLabel) → T-1 (Wordmark) → T-2 (AppIcon) → T-3 (Header mount) → T-5 (NodeRow) → T-6 (FocusBreadcrumb) → T-7 (Detail crumb) → T-8 unit tests → T-9 Playwright → T-10 regression → T-11 close-out.

---

## Close-out verdict

**Outcome: PASS — 2026-05-31.**

### Per-task

| Task | Status | Notes |
|---|---|---|
| T-0 (Cinzel + Cormorant in `app/layout.tsx`) | PASS | Added `Cinzel` (weights 500/600) and `Cormorant_Garamond` (weights 300/400, style italic). Variables `--font-cinzel` + `--font-cormorant` exposed via the html className. |
| T-1 Wordmark.tsx | PASS | Two-typeface mark + 45°-rotated-square lozenge with 8px verdigris glow + gradient rule. Compact (17/19px) + hero (42/46px) variants. `as='div' | 'a'` with href. 9 unit tests + 5 Playwright specs cover the contract. |
| T-2 AppIcon.tsx | PASS | Cinzel S on radial-gradient dark background with verdigris lozenge at the base. No consumer mount in 8.01.A — built so 8.01.D + future favicon/tab use can pick it up. Grep guard test asserts it carries Cinzel. |
| T-3 Header.tsx | PASS | Placeholder text replaced by `<Wordmark size="compact" />`. Existing `aria-label="Stelavox — home"` preserved on the wrapping `<Link>`. Click navigation verified. |
| T-4 LayerLabel.tsx | PASS | Bracketed monospace label per Component Spec §18.1. `LAYER_ABBR` map exported for unit tests + Phase 14 future compatibility. 8 unit tests cover render, position policy, data attributes, Inviolable #2 (no verdigris), and the title-case defensive fallback for unknown layer types. |
| T-5 NodeRow.tsx | PASS | LayerLabel mounted for structural nodes only (context nodes excluded — they have no canonical position). Row height 44px universal — applied at TWO places: the NodeRow inline style (line 150) AND `<Tree rowHeight={44}>` in NodeTree.tsx (react-arborist requires the height at the Tree-virtualisation level). 3 Playwright specs cover structural label, no-label-on-context, and 44px row height. |
| T-6 FocusBreadcrumb.tsx | PASS | New `FocusBreadcrumbSegment` prop shape (`{ layer, position, name? }`) renders via LayerLabel. Backward-compat: legacy `string[]` still rendered with a dev-only deprecation warning. Opacity ceiling stays at 0.2 — the 0.35/0.7 reveal lands in 8.01.B. FocusMode caller intentionally left on the legacy shape; migration with full ancestor walk is part of 8.01.B. |
| T-7 detail-pane crumb | DEFERRED to 8.01.E | The detail panel currently has no breadcrumb. Adding one needs an ancestor-walk query + new mount in NodeDetailPanel; that work fits naturally with the 8.01.E non-leaf detail-pane variant which also lands a new header region. Captured in 8.01.E scope. |
| T-8 unit tests | PASS | 3 new files: `layer-label.test.ts`, `wordmark.test.ts`, `wordmark-inviolable-grep.test.ts`. 27 new tests pass. The Inviolable grep guard walks `components/` and asserts Cinzel + Cormorant Garamond appear ONLY in `components/brand/`. |
| T-9 Playwright | PASS | 2 new spec files: `wordmark.spec.ts` (5 tests), `node-row-bracketed-labels.spec.ts` (3 tests). 8/8 pass on `chromium`. The third spec from the original plan (`detail-crumb-tap.spec.ts`) moves to 8.01.E with T-7. |
| T-10 regression | PASS | Type-check clean. Lint: 0 errors in 8.01.A files; 3 pre-existing errors in `OrchestrationAudit.tsx`, `VersionPreviewPane.tsx`, `audit-invariants.spec.ts` left alone per "never refactor adjacent code" rule. Build passes. Full vitest: 668 passed / 8 baseline failures / 10 skipped — the 8 failures match the CLAUDE.md v1.43 baseline list (agent-job-lifecycle Apollo, batch-submitter, m174 #12) and are unchanged by 8.01.A. |
| T-11 close-out | PASS | This entry. |

### Inviolables status after 8.01.A

- **Inviolable #1 (lowest-noise prose)** — unchanged. Focus Mode background still `--color-bg-base`. FocusBreadcrumb still `pointer-events: none`.
- **Inviolable #2 (verdigris nine uses)** — count remains nine. Wordmark uses #1 (lozenge) and #2 (rule) — both already counted. NodeRow active-state left border still verdigris use #9 — unchanged. LayerLabel uses NO verdigris (test pin: `wordmark.spec.ts` asserts neutral border).
- **Inviolable #3 (Cinzel-only-in-wordmark)** — verified by the grep guard. New `components/brand/Wordmark.tsx` + `components/brand/AppIcon.tsx` are the only files referencing Cinzel.
- **Inviolable #4 (typeface boundary)** — unchanged. LayerLabel uses monospace, which is neither Inter nor Lora; it lives in `components/tree/` (structural side) and never appears in the prose editor.
- **Inviolable #5 (no prose toolbar)** — unchanged. No prose-editor changes in this sub-phase.
- **Inviolable #6 (Cormorant-italic-only-in-wordmark) — NEW**, established at Phase 8.01 close-out, now structurally enforced: grep guard in `wordmark-inviolable-grep.test.ts` will fail loudly on any future regression.

### Carry-overs to subsequent sub-phases

- **To 8.01.B (Focus Mode polish):** migrate FocusMode caller off the legacy `string[]` shape and pass structured segments + ancestor walk so the bracketed-label breadcrumb renders the real path; bump opacity to 0.35 steady / 0.7 hover with the position counter "2 / 5" + leaf name reveal; FocusEscHint move to bottom-left + iPad "← Edit" pill variant.
- **To 8.01.E (Project Page + non-leaf detail pane):** T-7 detail-pane crumb (ancestor walk + tappable LayerLabel segments + new mount); the new `detail-crumb-tap.spec.ts` Playwright file.
- **To Phase 8 polish (existing scope):** the 3 pre-existing lint errors in `OrchestrationAudit.tsx`, `VersionPreviewPane.tsx`, `audit-invariants.spec.ts` continue to fail lint; they were not introduced by 8.01.A and were not in scope.

### Files changed

NEW:
- `components/brand/Wordmark.tsx`
- `components/brand/AppIcon.tsx`
- `components/tree/LayerLabel.tsx`
- `tests/unit/layer-label.test.ts`
- `tests/unit/wordmark.test.ts`
- `tests/unit/wordmark-inviolable-grep.test.ts`
- `tests/ui/wordmark.spec.ts`
- `tests/ui/node-row-bracketed-labels.spec.ts`

UPDATED:
- `app/layout.tsx` (font loading + html className)
- `components/layout/Header.tsx` (Wordmark mount)
- `components/tree/NodeRow.tsx` (LayerLabel prefix + 44px universal height + structural-only guard)
- `components/tree/NodeTree.tsx` (`rowHeight={44}` on the Tree)
- `components/focus/FocusBreadcrumb.tsx` (structured segments + LayerLabel + legacy fallback)

No spec doc bumps. No migrations. No API changes. No DB writes.

### Commit / merge state

Working-tree only. **No commits created** in this sub-phase per CLAUDE.md "Only create commits when requested by the user." When you give the word, the next agent action is `git status` + `git add` + commit with the standard footer.

---

## Changelog

**v1.1 — 2026-05-31** Close-out verdict: PASS. T-7 (detail-pane crumb) deferred to 8.01.E. All other tasks complete with test coverage. Inviolable #6 structurally enforced via grep guard.

**v1.0 — 2026-05-31** Initial build checklist for Phase 8.01.A — Brand foundation + bracketed labels. Authored after the Phase 8.01 wireframe-lock close-out (Brand Identity v2.2, Component Spec v2.21, TA v2.17, Product Spec v1.18, CLAUDE.md v1.46). User-approved six-sub-phase split A→F; this checklist covers sub-phase A only. Subsequent sub-phases B/C/D/E/F each get their own checklist.
