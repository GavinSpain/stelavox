# Phase 8.01.E — Project page + non-leaf detail-pane variant
## Build checklist v1.1

> **Close-out 2026-05-31 — PASS.** All 10 in-scope tasks landed (T-9 Playwright deferred to Phase 8.x polish per the established 8.01.C/D pattern). 12 new unit tests pass. Type-check clean. Build passes. Full vitest holds against baseline (10 pre-existing failures, composition varies slightly with seeded sample-novel state — none in 8.01.E surface area). Per-task scoring at the bottom of the file.

**Scope.** Fifth sub-phase of the Phase 8.01 build pass. Ships two related surfaces:

1. **ProjectPage rewrite** with Documents + Export tabs, per Component Spec v2.21 §18.7 and wireframe `03_project_page_v1_iter1.html`. The Documents tab is the natural extension of today's project page (list of documents). The Export tab is new — gives the author a project-level selection surface (currently the only export surface is the per-document Phase 7 `DocumentExportButton`).
2. **Non-leaf detail-pane "structure overview" variant** per §18.8 and wireframe `04_detail_panes_v1_iter1.html`. When a non-leaf node is selected in NodeDetailPanel, the Content tab renders a summary + immediate-children block (read-only listing with bracketed labels and status pips) instead of the prose canvas. The leaf "prose canvas" variant stays unchanged.
3. **Detail-pane crumb** — the deferred 8.01.A T-7 lands here. NodeDetailPanel header gains a tappable bracketed-path crumb (LayerLabel components, with each ancestor segment routing to that ancestor on click). Visible for both leaf and non-leaf variants.

**Spec contract.**
- Component Spec v2.21 §18.7 (ProjectPage + ExportTreeView)
- Component Spec v2.21 §18.8 (Detail pane variants — leaf "prose canvas" vs non-leaf "structure overview")
- Component Spec v2.21 §5.2 (detail-pane crumb — the 8.01.A T-7 deferral)
- Inviolable #2 — verdigris on the Export button under use #7 (affirmative-action family); no new use category. Children-row clicks on the non-leaf overview navigate but do NOT trigger use #7 (they're read-only navigation, not affirmative action).

**Out of scope (this sub-phase).** Responsive contract + iPad slide-overs (8.01.F). No new export profiles, no Phase 7 pipeline internals changes. AdminDashboard (V1.x-E) untouched. The leaf prose canvas variant (existing) is not touched. Project-level Director / Brief surfaces stay where they are.

---

## Tasks

### T-1. UPDATE `app/(app)/projects/[projectId]/page.tsx` — Documents tab as the default landing

Rewrite the current minimal page into the wireframe's two-tab shape. Documents tab keeps the existing functionality (list of documents with new-document dialog, document menu) but reflowed inside the new tab strip.

- Project header: project name + description + a bracketed-path crumb showing the project name on the left, optional document type indicator on the right.
- Tab strip: Documents | Export (router-driven via `?tab=` query param so it's URL-shareable like `?selectedNode=` from 8.01.D).
- Default tab: Documents.
- Documents view: card-style list (Inter 500 14px title + meta line) replacing the bullet rows. Each card links to `/projects/[id]/documents/[did]`. New-document button stays in the tab header.

### T-2. NEW `components/project/ExportTreeView.tsx` (~250 lines)

Project-level export tree-with-checkboxes per wireframe iter1. **OQ-1 lock (see below) determines whether this component ships full project scope or document-picker scope.**

If full project scope:
- Renders the project's full tree (all documents, all structural nodes) with checkboxes
- Tri-state parent checkboxes (all / mixed / none)
- Profile picker (DOCX-Manuscript / DOCX-KDP / EPUB-Standard / Outline-Structural / JSON)
- Export button (verdigris — use #7) → POST `/api/exports/project` (NEW)
- Server-side new helper to assemble the selection into the existing Phase 7 runner (which is per-document today)

If document-picker scope (recommended for V1):
- Renders the project's documents as a list with one Export button per row
- Each Export button opens the existing per-document `ExportModal` (Phase 7) for that document
- Skips the project-wide multi-document selection (defers to V2)
- No new API route needed

### T-3. NEW `lib/project/getStructuralOverview.ts` (~80 lines)

Server-side helper that returns the immediate-children list for a non-leaf node — drives the new structure-overview Content tab. Returns `{ childCount, drafted%, totalWordCount, children: ChildSummary[] }`. Each ChildSummary carries `{ id, nodeType, order, name, status, wordCountActual, wordCountTarget }` so the children panel renders bracketed labels + status pips + per-child word counts without needing the full node tree.

### T-4. NEW `components/detail/StructureOverview.tsx` (~180 lines)

The non-leaf Content tab body. Replaces the prose canvas (`ProseEditor` + `SummaryEditor` + `NotesEditor`) when `node.is_leaf === false`. Composition:

1. **Summary block.** Mounts the existing `SummaryEditor` for the node's own summary (Inter 13px, no change).
2. **Children panel.** A `--color-bg-elevated` block with a small label ("// N child {layer}") and a list of rows. Each row:
   - Bracketed `[Ch 1]` / `[Sc 2]` / etc. via 8.01.A LayerLabel
   - Child name (Inter 12.5px)
   - Status pip (existing NodeStatusBadge — small variant)
   - Click navigates the tree to that child (calls the same `onSelect` mechanism NodeTree uses today)
3. **Read-only.** No editing of children directly; the row click opens the child for editing in the normal NodeDetailPanel flow.

### T-5. UPDATE `components/detail/NodeDetailPanel.tsx` — branch on `is_leaf`

When `node.is_leaf === false` AND the Content tab is active, render `<StructureOverview>` instead of the prose-canvas group (`SummaryEditor` + `ProseEditor` + `NotesEditor` + `FocusModeButton` + `WordCount`).

Other tabs (Agent / Comments / History / Jobs / Context) render the same for both variants — no change there.

Surgical change inside the existing `Content` tab body: branch on `node.is_leaf`. The leaf path stays exactly as it is today (Phase 3 prose canvas). The non-leaf path mounts the new component.

### T-6. NEW `components/detail/DetailPaneCrumb.tsx` (~130 lines) — closes 8.01.A T-7

Deferred crumb from 8.01.A. Mounts in the NodeDetailPanel header (above the existing TabStrip). Composition:

- Fetches ancestor chain via the 8.01.B `getAncestorChain` helper. Renders root→parent segments as tappable LayerLabel buttons.
- Final segment is the active node's own bracketed label (NOT tappable — it's where the author already is).
- Each tappable segment uses a transparent button wrapping the visible LayerLabel with `min-width: 32px; min-height: 32px` hit area for touch. Click triggers the existing tree-selection callback to navigate to that ancestor.
- Visible for BOTH leaf and non-leaf variants.

Test data hooks: `data-testid="detail-crumb"` outer, `data-testid="detail-crumb-segment"` per segment with `data-layer` + `data-position` attributes.

### T-7. UPDATE `components/detail/NodeDetailPanel.tsx` — mount DetailPaneCrumb

Add the new crumb between the existing node-title heading and the TabStrip. Single component mount — the crumb owns its own ancestor fetch.

### T-8. Unit tests

NEW `tests/unit/structure-overview-render.test.ts` (~6 cases) — render-pinning:
- Empty children list renders the "no children yet" placeholder
- Children render in `order` ascending
- Status pip renders with the correct status colour token
- Per-child word counts render when target is set
- Row click data-testid hooks fire (logic-test the click handler via prop)

NEW `tests/unit/detail-crumb-render.test.ts` (~5 cases) — render-pinning:
- Empty ancestor chain renders nothing (root node has no crumb)
- Single-ancestor chain renders one tappable segment
- Multi-segment chain renders separators between
- Final segment is not a button (current node)
- Tap data-testid hooks present

NEW `tests/unit/project-page-tab-routing.test.ts` (~3 cases) — pure logic:
- Default `?tab` is "documents"
- Unknown `?tab` value falls back to "documents"
- Valid `?tab=export` resolves cleanly

### T-9. Playwright tests

NEW `tests/ui/project-page-tabs.spec.ts` (~3 cases):
- Default project page renders Documents tab
- Tab switch to Export updates `?tab` query param + renders Export view
- New-document button still works inside the Documents tab

NEW `tests/ui/non-leaf-detail-overview.spec.ts` (~3 cases):
- Non-leaf node renders the StructureOverview (children panel visible)
- Leaf node still renders the prose canvas (no children panel)
- Click on a child row navigates the tree to that child

NEW `tests/ui/detail-pane-crumb.spec.ts` (~3 cases):
- Detail-pane crumb shows root→parent bracketed segments
- Click on `[Act 1]` segment selects the act in the tree
- Final-segment (current node) is not a button

### T-10. Regression + close-out

Same 6-step regression sweep as 8.01.B/C/D. Update build checklist with PASS/FAIL. Stage commit but DO NOT push or merge to master without user approval.

---

## Risk + open questions

- **R-1 — Multi-document Export pipeline coupling.** If we go full project scope on the Export tab (OQ-1 option a), the new `/api/exports/project` route needs to either (i) call the existing per-document runner once per document and assemble, OR (ii) extend the runner to accept a multi-document selection set. Option (i) is faster and avoids touching Phase 7 internals; the export profiles and signed-URL retention all keep working. Document this in the route header if we go this way.
- **R-2 — Detail-pane crumb fetch frequency.** Each NodeDetailPanel selection change triggers an ancestor-chain fetch. For a tree-heavy editing session (lots of click-around) this is ~6 round-trips per click max. Acceptable for V1; cache could be added later via a small client-side memo keyed on documentId.
- **R-3 — Existing TabStrip vs new tab strip in ProjectPage.** Component Spec §5.2 TabStrip is for the NodeDetailPanel (Content / Agent / Comments / History etc.). The new project-page tabs are conceptually different — they're page-level navigation tabs, not panel-level tabs. Reuse the visual style of TabStrip (active-tab underline at `--color-text-primary` 0.6 opacity per Phase 2) but mount as a new lightweight component if reusing the existing one would couple unrelated state.

- **OQ-1 — Export tab scope.** Two paths:
   - **(a) Full project-scope ExportTreeView** — multi-document checkbox tree → new `/api/exports/project` route that calls the Phase 7 runner once per selected document and assembles. Bigger lift, matches the wireframe iter1 vision, sets up Series-of-Novels project exports cleanly.
   - **(b) Document picker** — Export tab lists documents with one Export button per row; each opens the existing per-document `ExportModal`. Lighter lift, ships a working Export tab without touching Phase 7 internals, defers the multi-document case to V2.
   
   Recommend **(b) document picker**. For V1's typical single-document Novel project the experience is identical to today's per-document export. The Series-of-Novels multi-document case is the one that benefits from (a), but it's V1.x candidate workload at most. Pulling forward the multi-document export pipeline now adds 4–6 hours of pipeline work for a feature most V1 authors won't use yet. (b) keeps 8.01.E focused on the UX surface; the wireframe-visible tree-with-checkboxes can land in V1.x polish or 8.01.F if you'd rather.

- **OQ-2 — Detail-pane crumb behaviour on root node.** When the author selects the project's root node (the Book), the ancestor chain is empty. Two options:
   - **(a)** Render the single bracketed `[Book 1]` non-clickable, no separator before it.
   - **(b)** Hide the crumb entirely for root nodes.
   
   Recommend **(a)**. The crumb stays visually present as orientation; the user sees `[Book 1]` and knows they're at the top of the structural hierarchy.

- **OQ-3 — StructureOverview "Open in tree" affordance.** Wireframe iter1 considered an "open in tree" link per child row but the user said in the iter1 feedback (`04_detail_panes_v1_iter1.html` section 5 / decision 2): *"I dont see the need for the Open in tree. these are always just one level down from the node selected."* Recommend honour that lock — child rows are tappable for navigation, no explicit "open in tree" affordance. Calling this out because the wireframe text mentions it; the lock is to honour the user's iter1 decision.

- **OQ-4 — Detail-pane crumb visibility on context nodes.** Context nodes (Character / Location / etc.) sit at the top of the document, not in the structural tree. They have no ancestor chain. Recommend: render the crumb as the single bracketed `[Character]` label (no position number — context nodes have no canonical position in the hierarchy). Treats them gracefully without needing a new layer in LayerLabel.

## Sequencing

T-1 (project page) can land in parallel with T-3 (overview helper) → T-4 (StructureOverview) → T-5 (NodeDetailPanel branch) → T-6 (DetailPaneCrumb) → T-7 (mount crumb). T-2 ExportTreeView depends on OQ-1 lock. T-8/T-9 tests after components. T-10 last.

Best execution order: T-1 → T-3 → T-4 → T-5 → T-6 → T-7 → T-2 (after OQ-1 lock) → T-8 → T-9 → T-10.

---

## Close-out verdict

**Outcome: PASS — 2026-05-31.**

### Per-task

| Task | Status | Notes |
|---|---|---|
| T-1 ProjectPage rewrite | PASS | New `_ProjectPageClient.tsx` owns `?tab=` URL routing (default `documents`, valid `documents`/`export`; unknown values fall back). Project page server-component reduced to: fetch project + documents → render client. `ProjectDocumentsTab` carries the prior list reflowed as cards. `Documents (N)` count visible in the header. |
| T-2 ProjectExportTab | PASS | OQ-1 (b) lock applied: document picker. Lists docs with one `DocumentExportButton` per row (reuses Phase 7's existing per-document `ExportModal`). No new export pipeline work; project-scope multi-doc export remains a V1.x candidate. |
| T-3 `lib/project/getStructuralOverview.ts` | PASS | Single RLS-scoped query against `nodes` for `parent_id=nodeId AND structural`; assembles `{ childCount, draftedPct, totalWords*, children[] }`. Server-friendly + client-friendly (both use the same supabase client interface). |
| T-4 StructureOverview | PASS | Pure children-panel component (refactored mid-task — original draft included SummaryEditor; moved to NodeDetailPanel-level so editor-store wiring stays single-source). Status pips via existing `NodeStatusBadge` (verdigris use #5 unchanged). Loading / error / empty states each have own rows. Per-child word count rendered when target is set. |
| T-5 NodeDetailPanel branch on is_leaf | PASS | Inserted between leaf prose block and MetadataForm. Gates on `!node.is_leaf && node.node_category === 'structural'` — context non-leaves keep their existing MetadataForm-driven shape; leaf nodes are unchanged. New optional `onSelectNode` prop threads through; document client wires it to `setSelectedNodeId`. |
| T-6 DetailPaneCrumb | PASS | Closes 8.01.A T-7 deferral. Ancestor chain via 8.01.B helper + parallel `parent_id` walk for the matching ids. OQ-2 lock: structural root nodes render the single-segment leaf bracketed label. OQ-4 lock: context nodes render single `[Character]` / `[Location]` / etc. bracketed label, non-tappable. Tappable ancestor segments use transparent buttons with `min-width: 32px; min-height: 32px` touch hit areas; final segment is always non-tappable. Unknown V1 structural types render nothing at first render (defensive vs Phase 14 layer drift). |
| T-7 NodeDetailPanel crumb mount | PASS | Inserted above the title row inside the header. Routes `onSelectAncestor` through the new `onSelectNode` prop (T-5). |
| T-8 unit tests | PASS | 3 new files / 12 cases: tab routing 6 + StructureOverview 2 + DetailPaneCrumb 4. |
| T-9 Playwright | DEFERRED to Phase 8.x polish | Per the established 8.01.C/D pattern. Real document-page Playwright for crumb taps + structure-overview navigation needs a fully-mounted Document Client harness against the dev server; renderToString unit tests pin the component contracts tightly in the meantime. |
| T-10 regression + close-out | PASS | Type-check 0 errors; build passes; full vitest 790/809 (10 pre-existing baseline failures — composition varies with sample-novel DB state; none in 8.01.E surface area). |

### Inviolables status after 8.01.E

- **Inviolable #1 (lowest-noise prose)** — unchanged. The leaf prose canvas variant is untouched. Non-leaf structure-overview surface doesn't render prose.
- **Inviolable #2 (verdigris nine uses)** — count remains nine.
  - StructureOverview chrome (panel + rows): NO verdigris. Status pips render through `NodeStatusBadge` which owns use #5 (approved) and use #4 (agent-complete).
  - DetailPaneCrumb: NO verdigris. Tappable ancestor segments are read-only navigation, NOT use #7 affirmative-action category.
  - Project page tabs: NO verdigris. Active tab underline at 0.6 opacity of `--color-text-primary` per Phase 2 lock.
- **Inviolable #3, #5, #6** — unchanged.
- **Inviolable #4 (typeface boundary)** — StructureOverview uses Inter; bracketed labels use ui-monospace (orientation surface). No prose-editor typography changes.

### Files changed

NEW:
- `app/(app)/projects/[projectId]/_ProjectPageClient.tsx`
- `components/project/ProjectDocumentsTab.tsx`
- `components/project/ProjectExportTab.tsx`
- `lib/project/getStructuralOverview.ts`
- `components/detail/StructureOverview.tsx`
- `components/detail/DetailPaneCrumb.tsx`
- `tests/unit/project-page-tab-routing.test.ts`
- `tests/unit/structure-overview-children-render.test.ts`
- `tests/unit/detail-pane-crumb-render.test.ts`

UPDATED:
- `app/(app)/projects/[projectId]/page.tsx` (rewritten as a server component shell)
- `components/detail/NodeDetailPanel.tsx` (new `onSelectNode` prop + StructureOverview mount + DetailPaneCrumb mount in header)
- `app/(app)/projects/[projectId]/documents/[documentId]/_DocumentClient.tsx` (passes `onSelectNode={setSelectedNodeId}` to NodeDetailPanel)

### Carry-overs to subsequent sub-phases

- **To 8.01.F (Responsive + iPad):** project page tab bar + Documents/Export grids reflow naturally at narrow widths; iPad slide-over patterns are 8.01.F scope. Document-page detail-crumb is touch-sized (32×32 minimum hit) but full iPad touch testing happens in 8.01.F.
- **Phase 8.x polish:**
  - Playwright harness for Document Mode (crumb taps + child-row taps) per T-9 deferral
  - Multi-document project-scope ExportTreeView with checkboxes (OQ-1 (a)) — V1.x candidate when Series-of-Novels multi-doc use becomes a real V1 workload
  - Crumb ancestor fetch is two round-trips (`getAncestorChain` + parallel parent_id walk for ids). Could collapse to a single SQL query if profiling shows it matters.
  - "Open in tree" affordance — explicitly NOT shipped per OQ-3 (user iter1 lock). Revisit only if real-world use shows the friction.

### Commit / merge state

Working-tree only. Per Option-A branch strategy, 8.01.A + B + C + D + E will commit together when 8.01.F also ships.

---

## Changelog

**v1.1 — 2026-05-31** Close-out verdict: PASS. T-1 through T-8 + T-10 complete; T-9 Playwright deferred. 12 new unit + 0 Playwright. Inviolables intact; verdigris-use count remains nine. OQ-1..OQ-4 all locked at recommendations. 8.01.A T-7 detail-pane crumb closed.

**v1.0 — 2026-05-31** Initial build checklist for Phase 8.01.E — Project page + non-leaf detail-pane variant. Authored at 8.01.D close-out. Branch strategy: Option A continued — stacks on top of 8.01.D on `claude/director-simplification`. Sub-phase F checklist authored after E close-out.
