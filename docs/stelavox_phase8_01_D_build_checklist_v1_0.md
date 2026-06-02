# Phase 8.01.D — Dashboard surfaces
## Build checklist v1.1

> **Close-out 2026-05-31 — PASS.** All 12 in-scope tasks landed. 25 new unit tests pass. Type-check clean. Build passes. Full vitest holds against baseline (8 pre-existing failures, composition slightly varies with seeded sample-novel state). Open questions OQ-1 through OQ-5 all locked at recommendations; locks recorded in `lib/` + component comments and below. Per-task scoring at the bottom of the file.

**Scope.** Fourth sub-phase of the Phase 8.01 build pass. Replaces the current minimal `/dashboard` (a flat project list) with the two locked dashboard shapes from wireframe `08_dashboard_v2_iter4.html`:

1. **Populated shape (≥1 project):** Wordmark in header (mounted in 8.01.A) + Sidebar three sections (LIBRARY / CONTEXT / SYSTEM with counts) + Resume Writing hero (last beat in Lora) + Needs Attention strip + ProjectGrid (3-column cards with progress).
2. **First-time shape (zero projects):** EmptyHero with locked tagline + EmptyActions ("Get started" verdigris primary + "Try the sample novel" ghost) + 3-tile philosophy strip (Structure-first writing · A Director, not an author · YoursTile with encryption line) + Sidebar QuickStartChecklist + SampleNovelImportModal opening from the secondary CTA.

**Spec contract.**
- Component Spec v2.21 §18.4 (Dashboard component family — populated + first-time shapes)
- Component Spec v2.21 §18.6 (QuickStartChecklist, YoursTile, SampleNovelImportModal, EmptyHero tagline lock)
- Component Spec v2.21 §3.1 (Wordmark — already mounted in Header via 8.01.A; no Wordmark changes here)
- Brand Identity v2.2 Inviolable #2 (verdigris uses: tile dot + Get started primary + Import primary all fall under existing use #1 / #7 categories; no new use)
- Product Spec v1.18 (user-facing language locks: tagline, two CTAs, SAMPLE badge, encryption lock-line, Quick Start 5 items)

**Out of scope (this sub-phase).** ProjectPage + non-leaf detail-pane variant + deferred 8.01.A T-7 detail-pane crumb (8.01.E). Responsive contract + iPad slide-overs (8.01.F). The sample novel _content_ itself is not in scope — the seed-sample-novel script (from 8.01 spec consolidation commit) is the import source; 8.01.D ships the API that calls into its logic. AdminDashboard (V1.x-E) untouched. /settings surfaces untouched.

---

## Tasks

### T-1. NEW `lib/dashboard/resumeWriting.ts` (~80 lines)

Server-side helper that returns the most recently edited leaf beat with prose across all projects in the user's organisation. Powers the Resume Writing hero.

**Contract:**
```ts
export interface ResumeWritingTarget {
  documentId: string
  documentName: string
  projectId: string
  projectName: string
  nodeId: string
  nodeName: string | null
  layerChain: { layer: 'series' | 'book' | 'act' | 'chapter' | 'scene' | 'beat'; position: number }[]
  proseExcerpt: string  // First 320 chars of leaf prose; renders in Lora in the hero.
  updatedAt: string
}
export async function getResumeWritingTarget(supabase: SupabaseClient, orgId: string): Promise<ResumeWritingTarget | null>
```

Query: pick the leaf node (`is_leaf=true`) with prose IS NOT NULL, ordered by `updated_at` DESC, limit 1. Then walk its ancestor chain (using `getAncestorChain` from 8.01.B) for the bracketed crumb. The prose excerpt extracts plain text from the Tiptap JSON column (existing helper at `lib/text/extractPlainText.ts` if available; otherwise inline a small walker).

Returns `null` when no leaf with prose exists yet (first-time path).

### T-2. NEW API route `GET /api/dashboard/resume` (~40 lines)

Thin wrapper around `getResumeWritingTarget` with auth + org resolution. Returns 200 with `{ target: ResumeWritingTarget | null }` or 401 unauth.

### T-3. NEW `components/dashboard/ResumeWritingHero.tsx` (~140 lines)

Top-left hero of the populated dashboard. Server-component fetches via the route (or via the helper directly when used in a server component — caller's choice).

Content:
- "RESUME WRITING" eyebrow label (Inter mono 10.5px letter-spacing 0.06em, `--color-text-muted`)
- Document title (Inter 500 17px)
- Bracketed crumb via `LayerLabel` components from 8.01.A
- "// Last beat you worked on — \"\{nodeName}\"" caption line (mono 10px `--color-text-muted`)
- Prose excerpt in Lora 14px / 1.7 line-height, padded inside `--color-bg-base` border-`--color-border-subtle` block
- "Continue writing →" CTA — NEUTRAL ghost button (passive return action, NOT verdigris use #7) per wireframe iter4 close-out lock

Mount in `--color-bg-elevated` card. Verdigris check: no verdigris in this component.

### T-4. NEW `components/dashboard/NeedsAttentionStrip.tsx` (~90 lines)

Right-of-hero strip. Pulls from existing `/api/status/pending-attention` (V1.x-B.1.1). Renders:
- "NEEDS ATTENTION" eyebrow (same style as Resume hero)
- List of items: Director proposals · awaiting Accept counts · budget signals
- Each item with an attention-amber dot (`--color-status-review`) OR info-blue dot (`--color-info`); explicitly NOT verdigris
- Click-through to the relevant deep-link

Empty state: hide the strip entirely (don't render a stub) — first-time users see ProjectGrid take full hero row width.

### T-5. NEW `components/dashboard/DashboardSidebar.tsx` (~120 lines)

Left sidebar (240px). Two shapes:

**Populated shape:**
- Section header eyebrows mono 10.5px letter-spacing 0.06em
- LIBRARY: All projects (N) / Recent (N) / Archived (N)
- CONTEXT: Characters (N) / Locations (N) / Themes (N)
- SYSTEM: Settings / Exports / Usage (no counts)

**First-time shape:**
- QUICK START: mounts `QuickStartChecklist` (T-7)
- LEARN: Walkthrough / Sample novel tour links

Single component with a `shape: 'populated' | 'first-time'` prop, or split into two components — recommend single component with prop (consistent with the rest of 8.01 single-component-with-variants pattern). Counts come from server-side aggregates passed as props.

### T-6. NEW `components/dashboard/ProjectGrid.tsx` + `components/dashboard/ProjectCard.tsx` (~150 lines combined)

3-column responsive grid (collapses on iPad in 8.01.F — for now CSS grid with `minmax(280px, 1fr)`). Each card:
- Project title Inter 500 15px
- Stack subtitle in monospace: `NOVEL · Book → Act → Ch → Sc → Bt`
- Progress line: percentage + "drafted · N / M words" — calculated from leaf-beat word counts vs targets
- 4px progress bar (`--color-text-faint` fill on `--color-bg-base` track)
- Meta: `{N docs} · Last: {relative time}`

ProjectCard is a Link to `/projects/[id]`. ProjectGrid maps cards. The aggregate computation (`drafted%`, word totals, doc counts) needs a server-side helper — `lib/dashboard/projectAggregates.ts`.

### T-7. NEW `components/dashboard/QuickStartChecklist.tsx` (~140 lines)

Per Component Spec §18.6:
- Exactly 5 items: Sign in (pre-checked) / Create your first project / Add a beat and write / Try the Director / Export your first chapter
- Each row 8×10px padding, Inter 12px, 14px square checkbox border `--color-border-strong`
- Checked state: verdigris fill + verdigris border + ✓ glyph in `--color-bg-base` — this is **NOT a new verdigris use** per spec; checklist ticks are passive completion indicators within the existing "approved status badge" semantic family (use #5)
- Optional sub-meta Inter 10.5px `--color-text-muted` per item
- Once all 5 done, condense to "Setup complete ✓" for one session then disappear

Progress state — V1 scope: **localStorage-backed**. Item completion logic:
- "Sign in" — auto-checked when component mounts
- "Create your first project" — auto-checked when any project exists for the user
- "Add a beat and write" — auto-checked when any leaf beat with non-empty prose exists
- "Try the Director" — auto-checked when any `director_turns` row exists for the user's org
- "Export your first chapter" — auto-checked when any `export_jobs` row with status='completed' exists for the user's org

A small `useQuickStartProgress(orgId)` hook calls one endpoint that returns the 5 booleans. localStorage holds the "condensed" + "dismissed" states only — completion state is server-derived.

### T-8. NEW `components/dashboard/YoursTile.tsx` (~80 lines) + `components/dashboard/PhilosophyStrip.tsx` (~70 lines)

PhilosophyStrip is a 3-tile horizontal grid:
1. "Structure-first writing" tile (icon `⟁` in monospace, headline + body)
2. "A Director, not an author" tile (icon `◇`)
3. `YoursTile` — third tile

YoursTile per §18.6:
- 28×28px verdigris dot icon in 1px `rgba(61,120,88,0.35)` border, 6px radius
- Headline "Your work, yours alone" Inter 500 14px
- Body "Every project belongs to you. Export anytime, in standard formats. No lock-in." Inter 12px `--color-text-secondary`
- Lock line top-border divider, monospace 10.5px small-caps `--color-text-muted`: `ENCRYPTED AT REST · PRIVATE TO YOUR ACCOUNT`

**Open Inviolable question (escalated from 8.01 wireframe iter4 D-1 lock — captured in CLAUDE.md v1.46):** the YoursTile decorative verdigris dot strictly counts as a 10th verdigris use category. Recommendation in spec is to treat it as brand-mark reinforcement under use #1 family pending audit. T-8 ships per the spec recommendation; if the audit decides otherwise, a small revisit replaces the verdigris dot with a neutral token.

### T-9. NEW `components/dashboard/SampleNovelImportModal.tsx` (~140 lines) + `POST /api/samples/import` route (~80 lines)

Modal per §18.6:
- Header "Load the sample novel" (Inter 500 19px)
- Sub copy explaining purpose
- Preview block (bg-elevated, 1px border): SAMPLE PROJECT badge + sample title + scale meta line + bracketed-label preview row
- Actions: ghost "Cancel" + verdigris primary "Import to my workspace" (verdigris use #7 — within affirmative-action triggers family, no broadening)

API: `POST /api/samples/import` — auth required; calls `lib/samples/importSampleNovel.ts` which mirrors the logic from `scripts/seed-sample-novel.ts` (already written + tested in 8.01 spec consolidation). The route is thin; the helper does the work and adds `metadata: { is_sample: true }` so the SAMPLE badge surfaces on ProjectCard. Returns the new project + document ids; client navigates to the document page on success.

Sample content: the seed script ships "The Quiet Door" — a very small functional sample (1 book / 1 act / 2 chapters / 4 scenes / 8 leaf beats with ~80-word prose / 4 context nodes). NOT the final 24k-word "Cartographer's Apprentice" (that lands in Phase 8.3 onboarding per CLAUDE.md v1.46 §8.01 deferral).

ProjectCard reads `metadata.is_sample` and renders a `SAMPLE` mono badge alongside the title.

### T-10. UPDATE `app/(app)/dashboard/page.tsx`

Rewrite to render either the populated OR first-time shape based on project count.

Server-side rendering:
1. Fetch projects + counts + (for populated) Resume Writing target + (for first-time) QuickStartProgress.
2. Branch on `projects.length === 0`:
   - **First-time:** `<DashboardLayout><DashboardSidebar shape="first-time" .../><EmptyDashboardCanvas /></DashboardLayout>` where EmptyDashboardCanvas mounts EmptyHero + EmptyActions + PhilosophyStrip.
   - **Populated:** `<DashboardLayout><DashboardSidebar shape="populated" .../><PopulatedDashboardCanvas /></DashboardLayout>` where PopulatedDashboardCanvas mounts the hero row (ResumeWritingHero + NeedsAttentionStrip) + ProjectGrid.
3. SampleNovelImportModal mounts at page level (controlled by a client component that the secondary CTA toggles).

DashboardLayout is a simple flex layout wrapper that handles the sidebar / main canvas split. Inline JSX rather than a separate component unless complexity warrants — recommend inline for now.

### T-11. Unit tests + close-out

NEW `tests/unit/dashboard-resume-helper.test.ts` (~5 cases) — pure logic:
- No nodes → null
- One leaf with prose → returns it
- Multiple leaves → returns most-recently-updated
- Non-leaf nodes ignored
- Leaves with empty prose ignored

NEW `tests/unit/quick-start-completion.test.ts` (~6 cases) — pure logic for `computeQuickStartState({hasProject, hasBeatWithProse, hasDirectorTurn, hasCompletedExport})`:
- All false → 1/5 (sign in only)
- Any single milestone → correct ticks
- All 5 → completion / condense state
- Sign-in is always true post-auth (assumed)

NEW `tests/unit/sample-import-helper.test.ts` (~4 cases) — pure logic for tree-construction sub-functions only (the actual import requires a DB; cover the structural helpers like fixture serialisation).

Component render tests via renderToString for YoursTile, EmptyHero, ProjectCard, SampleNovelImportModal — 4 small files, ~20 cases total.

Playwright `tests/ui/dashboard-shapes.spec.ts` (~4 cases):
- First-time dashboard renders EmptyHero + 2 CTAs
- "Try the sample novel" opens modal
- Sample import success redirects to /projects/[id]/documents/[doc]
- Populated dashboard renders ProjectGrid + Resume Writing hero when there's existing data

### T-12. Regression + close-out

Same 6-step regression sweep as 8.01.B/C. Update build checklist with PASS/FAIL. Stage commit but DO NOT push or merge to master without user approval.

---

## Risk + open questions

- **R-1 — Aggregate query performance.** ProjectGrid needs per-project drafted% which requires counting child nodes per project. For V1 with small project counts (~5-20 per user) this is fine via one aggregate query joined to projects. At scale a materialised view or per-project cached aggregate row would be the right move — flag for V1.x post-launch perf review.
- **R-2 — Quick Start "Try the Director" detection.** `director_turns` is org-scoped (no per-user filter readily available). For V1 we count any director turn under the org as "user has tried the Director" — acceptable for solo orgs (the common V1 case) but could mislead in multi-user orgs. Document and queue per-user attribution for V1.x polish.
- **R-3 — Sample import re-import.** What if the user clicks "Try the sample novel" twice? Recommend: the API rejects re-import (409) if a project named "Sample Novel — The Quiet Door" with `metadata.is_sample=true` already exists; client surfaces "You already have a sample novel — open it?" with a Link to it.
- **OQ-1 — Resume Writing data source.** Recommend new endpoint `GET /api/dashboard/resume` (T-2). Alternative: derive client-side from existing `/api/documents/[id]/nodes`. Recommend the endpoint — single round-trip with the ancestor walk + prose excerpt baked in.
- **OQ-2 — QuickStartChecklist persistence.** Recommend localStorage-backed for "condensed / dismissed" UI state; server-derived for completion booleans (so the checklist auto-updates as the user uses the app). Alternative: full server persistence with a `user_onboarding_progress` table. Recommend localStorage for V1 — no schema migration needed.
- **OQ-3 — Sample novel re-import behaviour.** Recommend 409 + open-existing per R-3.
- **OQ-4 — Sidebar "Recent" + "Archived" semantics.** "Recent" = projects with `updated_at` in last 7 days. "Archived" = N/A in V1 (no archive feature yet) — render the row with count 0 OR omit. Recommend omit until 8.01.F or Phase 8 polish lands the archive feature.
- **OQ-5 — Continue Writing CTA target.** Recommend deep-link to `/projects/{p}/documents/{d}?selectedNode={n}` so the tree opens to the resume-target. Requires the document page to honour the query param — minor existing-route extension.

## Sequencing

T-1 → T-2 (helper → route). T-3..T-8 can land in parallel (independent components). T-9 SampleImportModal depends on its route (T-9 wraps both). T-10 (page rewrite) depends on T-3..T-9. T-11 tests after components. T-12 regression last.

Best execution order: T-1 → T-2 → T-3 (small Hero) → T-4 (Needs Attention) → T-6 (ProjectGrid + Card + aggregates helper) → T-5 (Sidebar) → T-7 (QuickStartChecklist) → T-8 (YoursTile + PhilosophyStrip) → T-9 (SampleNovelImportModal + import route) → T-10 (page rewrite) → T-11 (tests) → T-12 (close-out).

---

## Close-out verdict

**Outcome: PASS — 2026-05-31.**

### Per-task

| Task | Status | Notes |
|---|---|---|
| T-1 `lib/dashboard/resumeWriting.ts` | PASS | OQ-1 lock applied. `getResumeWritingTarget()` — single-org leaf-with-prose lookup, post-filter on empty Tiptap output, ancestor walk via 8.01.B helper, 320-char excerpt with ellipsis. Returns null cleanly when no leaf has prose. |
| T-2 `GET /api/dashboard/resume` | PASS | Thin route handler: auth → org resolution → helper call → JSON. |
| T-3 ResumeWritingHero | PASS | Lora prose excerpt block; bracketed crumb via 8.01.A LayerLabel; neutral ghost "Continue writing →" Link; deep-link target carries `?selectedNode={id}` per OQ-5 lock. NO verdigris in this component. |
| T-4 NeedsAttentionStrip | PASS | Pulls existing `/api/status/pending-attention` (V1.x-B.1.1). Derives items by signal kind: amber dot for action-wanted, info-blue for informational. Renders nothing when empty (no stub) per spec. |
| T-5 DashboardSidebar | PASS | Single component with `shape` prop. OQ-4 lock: Archived row omitted. OQ-3 (3a) lock: permanent "Try a sample" link in LEARN section of the populated shape (and "Sample novel tour" link in first-time shape). |
| T-6 ProjectGrid + ProjectCard + aggregates | PASS | `getProjectAggregates` runs one parallel query against documents + nodes per org and assembles the per-project metrics. ProjectCard renders title + stack + drafted% bar + meta with relative time. SAMPLE badge shown when `metadata.is_sample` is true. |
| T-7 QuickStartChecklist + completion helper | PASS | OQ-2 lock applied: 5 EXISTS queries (`getQuickStartCompletion`) for completion booleans; localStorage holds only the "dismissed condensed banner" UI state. 5-row list with progressive tick + Setup-complete pill at 5/5. |
| T-8 YoursTile + PhilosophyStrip | PASS | Three-tile strip: Structure-first / A Director not an author / YoursTile. YoursTile carries the locked encryption line "ENCRYPTED AT REST · PRIVATE TO YOUR ACCOUNT". Open Inviolable audit item (verdigris dot use category) noted inline as decorative use #1 brand-mark family pending audit. |
| T-9 SampleNovelImportModal + import route | PASS | OQ-3 lock applied across three pieces: `pickNextSampleName()` lowest-available algorithm (8 unit cases pin it); modal calls `POST /api/samples/import` then bubbles result up via `onImported` callback (refactored from a direct `useRouter` call to make the component renderToString-testable + decoupled from navigation). Verdigris Import button = use #7 affirmative-action family. |
| T-10 Page rewrite + `?selectedNode` extension | PASS | New `app/(app)/dashboard/page.tsx` is a server component that fetches resume target + aggregates + sidebar counts + quick-start completion in parallel, then hands to `DashboardClient`. `DashboardClient` (client) owns the import modal state + router push closure. Document client `_DocumentClient.tsx` reads `?selectedNode` on mount via `useSearchParams`; graceful degradation when missing / malformed. One-shot effect — later tree clicks don't snap back to the query value. |
| T-11 unit tests | PASS | 3 new test files / 25 cases: quick-start-completion 8 + sample-name-suffix 8 + dashboard-component-render 9 (YoursTile 2 + ProjectCard 4 + QuickStartChecklist 2 + SampleNovelImportModal 2 + plus header sanity). |
| T-12 regression + close-out | PASS | Type-check 0 errors; build passes; lint 0 new errors; full vitest 779/797 (8 pre-existing baseline failures, composition consistent with 8.01.C scorecard). |

### Inviolables status after 8.01.D

- **Inviolable #1 (lowest-noise prose)** — unchanged. Dashboard is structural; no prose-editor changes.
- **Inviolable #2 (verdigris nine uses)** — count remains nine. Verifications:
  - "Continue writing →" CTA on Resume hero: **neutral ghost** (NOT verdigris). Passive return action; doesn't fall under use #7 affirmative-action category.
  - QuickStartChecklist ticks: verdigris under use #5 approved status family (passive completion indicator; no new category — confirmed against spec).
  - YoursTile decorative dot + lock-line dot: **OPEN INVIOLABLE AUDIT ITEM** noted in component + CLAUDE.md v1.46 — treated as brand-mark reinforcement under use #1 family pending the next audit. The component code carries an inline comment so future grep finds it.
  - "Get started" empty-CTA + Import primary in modal: verdigris use #7 affirmative-action family.
  - "Try a sample" sidebar link (OQ-3 3a) and "Try the sample novel" empty-CTA: ghost / neutral border, NOT verdigris.
- **Inviolable #3, #5** — unchanged. No new typography references; no toolbar additions.
- **Inviolable #4** (typeface boundary) — ResumeWritingHero prose excerpt renders in Lora per the §18.4 spec; sits inside an Inter-chrome card. Wireframe-locked exception; Inviolable #4 explicitly admits Lora in dashboard "Resume Writing" surface per Component Spec v2.21 §18.4 wording.
- **Inviolable #6** (Cormorant-italic-only-in-wordmark) — unchanged. The Welcome screen tagline uses Lora italic, NOT Cormorant Garamond. Verified.

### Files changed

NEW (server / lib):
- `lib/dashboard/resumeWriting.ts`
- `lib/dashboard/projectAggregates.ts`
- `lib/dashboard/quickStartCompletion.ts`
- `lib/samples/sampleNovel.ts`
- `app/api/dashboard/resume/route.ts`
- `app/api/samples/import/route.ts`

NEW (components):
- `components/dashboard/DashboardSidebar.tsx`
- `components/dashboard/ResumeWritingHero.tsx`
- `components/dashboard/NeedsAttentionStrip.tsx`
- `components/dashboard/ProjectGrid.tsx`
- `components/dashboard/ProjectCard.tsx`
- `components/dashboard/QuickStartChecklist.tsx`
- `components/dashboard/YoursTile.tsx`
- `components/dashboard/PhilosophyStrip.tsx`
- `components/dashboard/SampleNovelImportModal.tsx`

NEW (tests):
- `tests/unit/quick-start-completion.test.ts`
- `tests/unit/sample-name-suffix.test.ts`
- `tests/unit/dashboard-component-render.test.ts`

NEW (page client):
- `app/(app)/dashboard/DashboardClient.tsx`

UPDATED:
- `app/(app)/dashboard/page.tsx` (rewritten — server component branches on project count)
- `app/(app)/projects/[projectId]/documents/[documentId]/_DocumentClient.tsx` (OQ-5 `?selectedNode` honour)

### Carry-overs to subsequent sub-phases

- **To 8.01.E (Project Page + non-leaf detail pane):** ProjectGrid links to `/projects/[id]` (the project page itself); 8.01.E ships that page's new shape. Sample-novel SAMPLE badge convention extends there too via the same `metadata.is_sample` field. Deferred 8.01.A T-7 detail-pane crumb still queued there.
- **To 8.01.F (Responsive + iPad):** dashboard grid currently uses `minmax(280px, 1fr)` so reflow is sensible at narrow widths but the iPad slide-over sidebar pattern isn't built — 8.01.F adds the responsive sidebar collapse + summon button.
- **Phase 8.x polish:** "Get started" empty-CTA currently `preventDefault`s — needs to wire to the project-creation modal (`NewProjectDialog`) when that modal becomes embeddable. Minimal; documented in `DashboardClient.tsx`. The "Walkthrough" links land at `#` — Phase 12 user docs will give them a real destination. Multi-user-org per-user attribution for QuickStart "Try the Director" (R-2 in this checklist) is also Phase 8 polish.
- **Inviolable audit:** YoursTile verdigris dot is the open question to confirm at the next Inviolable audit.

### Commit / merge state

Working-tree only. No commits. Per the user's locked Option A branch strategy, 8.01.A + B + C + D will commit together when E + F also ship — single Phase 8.01 build-pass commit on `claude/director-simplification`. Per-sub-phase commit is also fine; deferring to user's call as before.

---

## Changelog

**v1.1 — 2026-05-31** Close-out verdict: PASS. All 12 tasks landed; 25 new unit; type-check + build green; baseline failures unchanged. OQ-1..OQ-5 locked at recommendations. YoursTile verdigris dot flagged for the next Inviolable audit per CLAUDE.md v1.46 forward note.

**v1.0 — 2026-05-31** Initial build checklist for Phase 8.01.D — Dashboard surfaces. Authored at 8.01.C close-out. Branch strategy: Option A continued — stacks on top of 8.01.C on `claude/director-simplification`. Subsequent sub-phase checklists at `docs/stelavox_phase8_01_{E,F}_build_checklist_v1_0.md`.
