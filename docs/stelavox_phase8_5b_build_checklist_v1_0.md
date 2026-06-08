# Phase 8.5b — Document Load Architecture Build Checklist
## Version 1.1
**Date:** 2026-06-08
**Status:** Draft v1.1 — for user review before any code lands
**References:** `docs/stelavox_document_load_architecture_v1_0.md` (Tier-A spec v1.1), `docs/stelavox_phase8_5b_test_plan_v1_0.md` (test plan v1.1)

> **v1.1 audit pass.** Incorporates the C1–C10 + I-tier audit findings from 2026-06-08. New material: §0.2 enumerated code surfaces with file/line references (cross-link to Tier-A §0.2); §0.3 v1.1 decisions; per-sub-phase **estimated session count** (I7); B.2 consumer-migration order spelled out (I5); B.5 substrate work explicitly absorbs the existing `realtime-auth.ts` helper and the existing per-table hooks (C2, I6); per-sub-phase Vercel smoke step (M5); resumption protocol after 8.5b close-out (M7); rollback granularity within B.5 (I6).

---

## 0. Phase context

**Pre-flight state.** Master HEAD `d9752b1` after the Phase 8.4/8.1/8.2/8.3 cluster shipped. The Phase 8.5 measurement baseline shipped to `docs/stelavox_phase8_5_perf_baseline_v1_0.md`; no code from that phase modified the running app. Phases 8.6 (E2E suite), 8.7 (deploy hardening), 8.12 (deferred Phase 3 tests) are deferred until after Phase 8.5b closes — resumption protocol in §9.

**Sub-phase model.** Six sub-phases B.1 through B.6. Each:
- Branches from latest master
- Has its own Test Report at close-out
- Merges to master via `--no-ff` per the established Phase 8 pattern
- Must show green Vitest + Playwright suite before merge
- Includes a post-merge Vercel smoke per §8

**No big-bang.** Within sub-phases, individual commits should also be atomic and reversible where possible. The two-step B.2 (back-compat then flip) is the model for any sub-phase where a default behaviour change is needed.

**Inviolable guards.** None of the sub-phases change UI tokens, typefaces, verdigris uses, prose-surface contracts, or any of the Six Inviolables. The architecture changes are below the UI layer. Tests assert no UI regression.

**Total scope: 10 sessions of implementation work** (per Tier-A §10 phasing table) plus this prep work and the v1.1 documentation revision.

### 0.2 Pre-flight code inventory (cross-link)

Tier-A spec §0.2 enumerates the eight production consumers of `/api/documents/[id]/nodes` and the eleven Realtime subscribers. **Re-grep at each sub-phase kickoff** to confirm the inventory is current — code may have shifted between v1.1 authoring and sub-phase B.X start.

Inventory grep commands (canonical for re-runs):

```bash
# /api/documents/[id]/nodes consumers — exclude tests and scripts
rg -n '/api/documents/[^/]+/nodes' --type ts --type tsx \
  | grep -v -E '(tests/|scripts/)'

# Realtime subscribers — production code only
rg -n 'supabase\.channel\(|postgres_changes' --type ts --type tsx \
  | grep -v -E '(tests/|scripts/)'
```

### 0.3 Decisions locked at v1.1

(Mirrors Tier-A §0.3; restated here so implementer doesn't need to cross-reference for the decision context.)

| Decision | Choice |
|---|---|
| Client cache library | TanStack Query v5+ |
| Rollup architecture | On-demand Postgres RPC |
| Realtime topology | Channel-per-browser-tab, with demuxer |
| Bundle CI | Husky pre-push hook |
| SSR data source | `lib/data/nodes.ts:listNodes()` (NOT internal fetch of own API) |
| Empty-state error handling | Skeleton during fetch; error card on persistent failure; toast on mutation failure |

---

## 1. Sub-phase B.1 — Rollup correctness

### B.1 — Estimated effort
**1 session.**

### B.1 — Goal
Fix the silent under-counting of `wordsDrafted` on the dashboard ProjectCard and document header. Replace TypeScript-side row-sum reads with Postgres RPC aggregates.

### B.1 — Scope IN
- One migration: `M-XXX_document_and_project_rollup_rpcs.sql`
- `lib/types/api.ts` NEW — TypeScript type contracts (per Tier-A §2.5)
- Add `lib/queries/rollups.ts` exporting `getDocumentRollup`, `getProjectRollup` (thin RPC wrappers — no TanStack yet)
- Rewrite `lib/dashboard/projectAggregates.ts` to use the new project rollup; old TS-sum code path deleted
- Audit `lib/project/getStructuralOverview.ts` for the same 1000-row pattern; fix or document why not applicable
- New API routes: `GET /api/documents/[id]/rollup`, `GET /api/projects/[id]/rollup`
- New Vitest unit cases: rollup RPCs return correct counts at small (16-node Sample Novel), medium (135-node Shadow Protocol), and large (1556-node Mega Manuscript) scale
- New Playwright case: dashboard ProjectCard for the mega-doc shows ≥ 500k words (not 187k)
- Regression: every existing Phase 8.01.D dashboard test must still pass

### B.1 — Scope OUT
- TanStack Query — lands in B.3, not here
- Endpoint projection — lands in B.2
- Materialised rollup tables — V2 candidate, not in V1
- Document-header word-count UI changes — visual unchanged; the *number* it shows just becomes correct
- Caching of rollup responses — comes naturally with B.3

### B.1 — Work items
1. Create `lib/types/api.ts` (NEW) with `DocumentRollup`, `ProjectRollup`, `NodeStatus`, `StructuralNodeRow`, `FullNodeRow`, `STRUCTURAL_COLUMNS` const per Tier-A §2.5
2. Author SQL bodies for the two RPCs:
   - `get_document_rollup(p_document_id UUID) RETURNS TABLE(...)`
   - `get_project_rollup(p_project_id UUID) RETURNS TABLE(...)`
   Both `STABLE`, `SECURITY DEFINER`, `SET search_path = public` per H-13.
3. Author index audit migration step: `CREATE INDEX IF NOT EXISTS nodes_doc_layer_idx ON nodes(document_id, layer_index)` and similar if not present
4. Apply migration locally, run Vitest unit tests asserting RPC results (TC-8.5b-B1-01..10 from test plan)
5. Regenerate `lib/types/database.ts` via `supabase gen types`
6. Write `lib/queries/rollups.ts` wrappers
7. Author new API routes:
   - `app/api/documents/[documentId]/rollup/route.ts` (NEW)
   - `app/api/projects/[projectId]/rollup/route.ts` (NEW)
8. Rewrite `lib/dashboard/projectAggregates.ts` — internal rewrite, public function signature `getProjectAggregates(supabase, orgId)` unchanged so callers don't move
9. Audit `lib/project/getStructuralOverview.ts`:
   - If the 1000-row pattern exists, refactor to use the document rollup RPC for the leaf sums
   - If the function fetches per-row data (not just aggregates) for non-aggregate reasons, leave it but note in comments why
10. Run full Vitest suite — confirm green
11. Run full Playwright suite — confirm green
12. Add the new tests from B.1 — Tests section in the test plan
13. Manual verification per checklist (test plan §1)
14. Author Test Report → Test Report PASS → merge to master via `--no-ff`
15. Post-merge: Vercel smoke per §8

### B.1 — Files touched
- `supabase/migrations/<timestamp>_document_and_project_rollup_rpcs.sql` (NEW)
- `lib/types/database.ts` (regenerated)
- `lib/types/api.ts` (NEW)
- `lib/queries/rollups.ts` (NEW)
- `app/api/documents/[documentId]/rollup/route.ts` (NEW)
- `app/api/projects/[projectId]/rollup/route.ts` (NEW)
- `lib/dashboard/projectAggregates.ts` (rewritten body, same exports)
- `lib/project/getStructuralOverview.ts` (potentially modified — depends on audit)
- `tests/unit/rollup-rpcs.test.ts` (NEW)
- `tests/v1x-phase8-5b/dashboard-mega-doc.spec.ts` (NEW)

### B.1 — Acceptance criteria
- [ ] RPC unit tests pass at three doc-size scales
- [ ] Dashboard Playwright test asserts mega-doc shows ≥ 500k words
- [ ] Full Vitest suite green (no regressions)
- [ ] Full Playwright regression suite green
- [ ] Manual: load dashboard in dev, confirm Mega Manuscript card shows real number (not 187k)
- [ ] Manual: load Sample Novel dashboard card — confirm small-doc still works correctly
- [ ] Vercel smoke per §8 complete
- [ ] Test Report PASS verdict

### B.1 — Blast radius
Two server-side functions, one new migration, two TS files rewritten, two new API routes, no UI changes, no Realtime changes.

---

## 2. Sub-phase B.2 — Endpoint projection

### B.2 — Estimated effort
**2 sessions** (B.2a = ~1 session; B.2b = ~1 session)

### B.2 — Goal
`/api/documents/[id]/nodes` returns projected payload by default. Mega-doc response drops from 2.7 MB to ~80 KB gzipped.

### B.2 — Scope IN
- `/api/documents/[id]/nodes` route handler accepts `?include=` query param
- Server-side `SELECT` projection (not TypeScript `map`)
- Allow-list validation: only `summary`, `prose`, `metadata`, `notes` recognised; unknown values produce 400
- All 8 callers (per Tier-A §0.2.1) audited and migrated
- Switch the default behaviour to projected (the breaking change)
- `lib/data/nodes.ts:listNodes()` extended with `projection` parameter
- New Vitest unit cases: projection enforcement, allow-list validation
- New Playwright cases: mega-doc default response ≤ 100 KB gzipped; tree renders correctly with default; detail panel opens correctly (which fetches `/api/nodes/[id]` for the full row); Director still works; export still works
- Regression: every existing tree/detail/Director/export test must still pass

### B.2 — Scope OUT
- TanStack Query — B.3
- RSC seed — B.4
- Realtime topology changes — B.5
- Removing fields from `/api/nodes/[id]` — that endpoint is the per-node hydration surface and stays full
- Adding new `?include=` options beyond the four listed — extensible later if a use case justifies

### B.2 — Two-commit pattern (mandatory)

**B.2a — Add opt-in, default unchanged.**
1. Route handler parses `?include=`, computes `SELECT` projection
2. When `?include=` is absent OR `?include=*` is present, route returns the *current* payload (all columns). No behaviour change for existing callers.
3. When `?include=summary` (or similar) is present, route returns only the structural columns plus the requested fields
4. Unit tests cover all combinations
5. Ship B.2a to master. **Zero user-visible change.** Zero risk.

**B.2b — Migrate consumers and flip default.**
6. Migrate consumers in the **prescribed order** (below), each as its own commit
7. After all migrations: flip the default in the route handler
8. Add the Playwright perf-budget assertion (mega-doc ≤ 100 KB gzipped)

### B.2 — Consumer migration order (B.2b)

Per Tier-A §0.2.1 inventory. Order chosen for safety: easy verification first, infrastructure-dependent surfaces last.

| Order | Consumer | Decision |
|---|---|---|
| 1 | `lib/data/nodes.ts:listNodes()` | Add `projection?: 'structural' \| 'full' \| NodeIncludeField[]` parameter; default `'full'` for B.2a back-compat, flip to `'structural'` in B.2b |
| 2 | `components/director/NodePicker.tsx` line 86 | Migrate to `?include=` query — needs structural only (uses for `@`-mention selection); easiest to verify |
| 3 | `components/focus/FocusMode.tsx` line 177 | Migrate — needs structural only (scopes keyboard nav) |
| 4 | `app/api/projects/[projectId]/context-nodes/route.ts` | Audit usage; likely needs no content fields |
| 5 | `components/project/ProjectSettingsTab.tsx` | Audit — may be doc-comment only, verify by Read |
| 6 | `components/tree/NodeTree.tsx` lines 134, 217 | The biggest consumer; structural only; once migrated the tree no longer carries prose |
| 7 | `app/(app)/projects/[projectId]/documents/[documentId]/page.tsx` (server prefetch path) | Pass `projection: 'structural'` to `listNodes()` |
| 8 | Director context builder + export tree-walker (find via subsequent grep) | Pass `projection: ['summary', 'prose']` explicit-include |
| 9 | **Flip default** in route handler | Default becomes projected; `?include=*` preserved as escape hatch |

Each consumer migration is its own commit. **Each commit's tests must pass before moving to the next.** This is the regression bulwark — if step 6 breaks, we know it's the NodeTree change, not the route default flip.

### B.2 — Work items (B.2a)
1. Define `ALLOWED_INCLUDES = ['summary', 'prose', 'metadata', 'notes']` constant in `lib/types/api.ts` (already exists from B.1 — augment)
2. Parse `request.nextUrl.searchParams.get('include')`, split on comma, validate against allow-list
3. Build `SELECT` column list dynamically — base structural columns always; allowed columns conditionally; `*` returns everything
4. Extend `listNodes()` in `lib/data/nodes.ts` with `projection` parameter; default `'full'` for now
5. Pass projection from route handler to `listNodes()`
6. Update `tests/unit/nodes-route-projection.test.ts` — projection cases (NEW)
7. Update existing route tests if they assert specific payload shapes — most should pass unchanged because default is unchanged
8. Manual verification — open the doc in browser, confirm everything still works
9. Ship B.2a (commit + push to sub-phase branch; do NOT merge to master yet)

### B.2 — Work items (B.2b)
1. Migrate consumers per the prescribed order above:
   - Per consumer: change usage, ship its own commit on the sub-phase branch, verify in browser, regression-test
2. After consumer migrations, change the default behaviour in the route handler + `listNodes()`
3. Run the full suite
4. Add the Playwright payload-size assertion
5. Manual verification: open mega-doc, confirm tree renders, navigate, confirm detail panel + editor works, run an export, open Director
6. Author Test Report → Test Report PASS → merge B.2 (a+b combined) to master via `--no-ff`
7. Post-merge: Vercel smoke per §8

### B.2 — Files touched
- `app/api/documents/[documentId]/nodes/route.ts` (modified)
- `lib/data/nodes.ts` (modified — projection support in `listNodes`)
- `lib/types/api.ts` (modified — augment with `ALLOWED_INCLUDES`)
- `components/tree/NodeTree.tsx` (depends on how it gets the data; likely modifies the fetch URL)
- `components/director/NodePicker.tsx` (modified)
- `components/focus/FocusMode.tsx` (modified)
- `components/project/ProjectSettingsTab.tsx` (audit + potentially modified)
- `app/api/projects/[projectId]/context-nodes/route.ts` (audit + potentially modified)
- `app/(app)/projects/[projectId]/documents/[documentId]/page.tsx` (modified — server prefetch via listNodes with projection)
- Director context builder (location TBD via grep)
- Export tree-walker (`lib/export/tree-walker.ts`)
- `tests/unit/nodes-route-projection.test.ts` (NEW)
- `tests/v1x-phase8-5b/mega-doc-projection.spec.ts` (NEW Playwright)

### B.2 — Acceptance criteria
- [ ] `/api/documents/[id]/nodes` (default) on mega-doc returns ≤ 100 KB gzipped
- [ ] `/api/documents/[id]/nodes?include=prose` returns the old-shaped payload (~2.7 MB)
- [ ] `/api/documents/[id]/nodes?include=*` returns all columns
- [ ] Tree renders correctly at all three scales (small, medium, mega)
- [ ] Detail panel hydrates correctly
- [ ] Director conversation context still includes prose
- [ ] Export still produces correct DOCX/EPUB
- [ ] FocusMode navigation still works on tree-loaded surface
- [ ] NodePicker `@`-mention still works
- [ ] Full Vitest + Playwright suites green
- [ ] Vercel smoke per §8 complete
- [ ] Test Report PASS verdict

### B.2 — Blast radius
One endpoint + 8 production consumers. The two-step pattern (add opt-in, then flip default) keeps risk low. If anything is missed, the regression is "consumer was relying on a field we no longer return by default" and the symptom shows up immediately in tests.

---

## 3. Sub-phase B.3 — Client cache layer (TanStack Query)

### B.3 — Estimated effort
**2 sessions.**

### B.3 — Goal
TanStack Query mounted; document tree, document rollup, per-node, and project rollup queries wrapped in `useQuery` hooks. Realtime patches cache directly. Autosave PATCH uses optimistic updates. Error and loading UX defined per Tier-A §3.7 / §3.7.1.

### B.3 — Scope IN
- `@tanstack/react-query` and `@tanstack/react-query-devtools` added to dependencies
- `lib/queries/keys.ts` — typed query-key factories per Tier-A §3.3.1
- Provider mounted at `app/(app)/layout.tsx` with default options per Tier-A spec §3.2
- Hooks in `lib/queries/`:
  - `useDocumentNodes(documentId)` — wraps `/api/documents/[id]/nodes`
  - `useDocumentRollup(documentId)` — wraps `/api/documents/[id]/rollup`
  - `useNode(nodeId)` — wraps `/api/nodes/[id]`
  - `useProjectRollup(projectId)` — wraps `/api/projects/[id]/rollup`
- NodeTree migrated to use `useDocumentNodes`
- NodeDetailPanel migrated to use `useNode`
- `lib/queries/realtime-patcher.ts` — Realtime listener for `nodes` table patches cache via `setQueryData` / `invalidateQueries`
- Patcher includes ordering buffer for Realtime-before-fetch case per Tier-A §3.4.1
- Autosave PATCH adapted to optimistic-update pattern per Tier-A §3.5
- `components/feedback/QueryErrorFallback.tsx` (NEW) per Tier-A §3.7
- `components/feedback/skeletons/TreeSkeleton.tsx` and `DetailPanelSkeleton.tsx` (NEW) per Tier-A §3.7.1
- Observability stubs (console.debug for now; production POST to `/api/metrics/client` deferred — see §B.3 OUT)
- New Vitest cases for the hooks, the patcher, the ordering buffer
- New Playwright: open doc, click between beats, assert no second `/api/documents/[id]/nodes` fetch
- New Playwright (two-tab): change in tab A reflects in tab B without a spinner
- Regression: all existing tests pass

### B.3 — Scope OUT
- RSC seed — B.4
- Realtime channel multiplexing — B.5
- Dashboard ProjectCard migration to TanStack — push to B.3 polish session if time allows; else deferred to a Phase 8.5c
- Director / scheduler / brief Realtime patching — out of scope; B.5 covers
- Observability metrics endpoint `/api/metrics/client` — deferred to Phase 8.5c or V1.x-E

### B.3 — Work items
1. `npm install @tanstack/react-query @tanstack/react-query-devtools`
2. Author `lib/queries/keys.ts` typed factories
3. Author `app/(app)/QueryProvider.tsx` mounting the provider
4. Mount in `app/(app)/layout.tsx`
5. Author `lib/queries/useDocumentNodes.ts` and friends
6. Author `components/feedback/QueryErrorFallback.tsx`
7. Author `components/feedback/skeletons/TreeSkeleton.tsx` and `DetailPanelSkeleton.tsx`
8. Author tests for each hook
9. Migrate `components/tree/NodeTree.tsx` to use the hook + render skeleton during load + fallback on error
10. Migrate `components/detail/NodeDetailPanel.tsx` to use `useNode` + skeleton + fallback
11. Author `lib/queries/realtime-patcher.ts` Realtime listener with ordering buffer
12. Author Vitest cases for the patcher and the buffer (including Realtime-before-fetch scenario)
13. Adapt autosave PATCH (`lib/editor/autosave.ts` or wherever it lives) to optimistic pattern
14. Run the existing test suite — fix anything that broke
15. Manual verification: open mega-doc, click between beats, confirm fast feel; open two tabs, edit in one, confirm other updates
16. Test Report → PASS → merge
17. Post-merge: Vercel smoke per §8

### B.3 — Files touched
- `package.json` (deps)
- `lib/queries/keys.ts` (NEW)
- `app/(app)/QueryProvider.tsx` (NEW)
- `app/(app)/layout.tsx` (modified)
- `lib/queries/useDocumentNodes.ts` (NEW)
- `lib/queries/useDocumentRollup.ts` (NEW)
- `lib/queries/useNode.ts` (NEW)
- `lib/queries/useProjectRollup.ts` (NEW)
- `lib/queries/realtime-patcher.ts` (NEW — the cache-patching Realtime listener with ordering buffer)
- `components/feedback/QueryErrorFallback.tsx` (NEW)
- `components/feedback/skeletons/TreeSkeleton.tsx` (NEW)
- `components/feedback/skeletons/DetailPanelSkeleton.tsx` (NEW)
- `components/tree/NodeTree.tsx` (modified data-fetching path)
- `components/detail/NodeDetailPanel.tsx` (modified)
- `lib/editor/autosave.ts` (or current autosave location, modified)
- `tests/unit/queries-*.test.ts` (NEW)
- `tests/unit/realtime-patcher.test.ts` (NEW — includes ordering buffer tests)
- `tests/v1x-phase8-5b/no-refetch-on-navigation.spec.ts` (NEW)
- `tests/v1x-phase8-5b/two-tab-realtime-patch.spec.ts` (NEW)
- `tests/v1x-phase8-5b/optimistic-autosave.spec.ts` (NEW)

### B.3 — Acceptance criteria
- [ ] TanStack Query mounted; devtools accessible in dev
- [ ] Tree component fetches via `useDocumentNodes`; renders skeleton during load
- [ ] Detail panel fetches via `useNode`; renders skeleton during load
- [ ] Query errors render `<QueryErrorFallback>` with retry
- [ ] Navigating between beats in mega-doc triggers ZERO new `/api/documents/[id]/nodes` calls
- [ ] Edit in tab A reflects in tab B within 2 seconds without a spinner
- [ ] Autosave feels tighter (subjective; verify with manual timing)
- [ ] Realtime-before-fetch ordering: TC-8.5b-B3-21 passes
- [ ] Mutation failure: optimistic state reverts; FailureToast surfaces
- [ ] Full Vitest + Playwright suites green
- [ ] Vercel smoke per §8 complete
- [ ] Test Report PASS verdict

### B.3 — Blast radius
Document page only. Dashboard, settings, Director, scheduler all untouched in this sub-phase. The TanStack provider mounts globally but unused queries cost nothing.

---

## 4. Sub-phase B.4 — RSC initial seed

### B.4 — Estimated effort
**1 session.**

### B.4 — Goal
The document page server component prefetches the tree and dehydrates the cache. First paint of the tree has data already.

### B.4 — Scope IN
- `app/(app)/projects/[p]/documents/[d]/page.tsx` server component:
  - Creates per-request `QueryClient` (NOT a singleton — per Tier-A §3.6.1)
  - Prefetches `documentKeys.nodes(documentId)` via `listNodes()` direct call (NOT via internal fetch — per Tier-A §3.6.2)
  - Wraps the client tree in `<HydrationBoundary state={dehydrate(queryClient)}>`
- New Playwright: cold doc open issues ZERO client-side `/api/documents/[id]/nodes` fetch
- New Playwright timer: cold doc open total time below budget (< 2 s p50 in production-build mode)
- New Playwright: confirm no client refetch within staleTime (60 s) of SSR landing
- Regression suite passes

### B.4 — Scope OUT
- Other surfaces (dashboard, settings, scheduler) — they don't need RSC seed at this scale; can be added later if measurements justify
- Edge caching — separate concern; deferred
- Streaming SSR — deferred to V2; standard dehydrate/hydrate pattern only

### B.4 — Work items
1. Refactor `app/(app)/projects/[p]/documents/[d]/page.tsx` to RSC pattern with prefetch
2. Server component instantiates per-request `QueryClient` (with default options matching the client one)
3. Server prefetches via `listNodes({ documentId, projection: 'structural' })`
4. Verify the existing client wrapper continues to work; adjust prop shape if needed
5. Author the test asserting no client-side `/api/documents/[id]/nodes` fetch on cold open
6. Author the timer assertion (production-build mode)
7. Author the no-refetch-within-staleTime test
8. Manual verification: open doc cold (after `npm run build && npm run start`), check Network tab in DevTools
9. Test Report → PASS → merge
10. Post-merge: Vercel smoke per §8

### B.4 — Files touched
- `app/(app)/projects/[p]/documents/[d]/page.tsx` (refactored)
- Possibly a small new wrapper component
- `tests/v1x-phase8-5b/rsc-seed-cold-open.spec.ts` (NEW)

### B.4 — Acceptance criteria
- [ ] Cold doc open performs ZERO client-side `/api/documents/[id]/nodes` fetch
- [ ] Cold doc open total time under budget (< 2 s p50 in production-build mode)
- [ ] No refetch within 60 s of cold landing
- [ ] Full suite green
- [ ] Vercel smoke per §8 complete
- [ ] Test Report PASS

### B.4 — Blast radius
Document page server component only. Other server components in the app are not affected.

---

## 5. Sub-phase B.5 — Realtime multiplex

### B.5 — Estimated effort
**3 sessions** (substrate + consumer migrations + verification).

### B.5 — Goal
One Realtime channel per browser tab (per Tier-A §5.2 corrected — not "per user session"). All `postgres_changes` subscriptions multiplex through it via a client-side demuxer. Reduces concurrent channel count by ~5-10× per tab.

### B.5 — Scope IN
- `lib/realtime/useUserChannel.ts` — singleton-per-tab hook that opens `user:{userId}` channel
- `lib/realtime/demuxer.ts` — event-bus + topic-routing implementation
- `lib/realtime/useRealtimeTopic.ts` — replacement hook for components to subscribe to topics
- **Absorbs the existing `lib/supabase/realtime-auth.ts` `ensureRealtimeAuth()` helper** — substrate calls it on channel creation; consumers no longer call it directly (closes the "shared waitForAuthThenSubscribe helper across 4 hooks" follow-up from 2026-06-07)
- `<RealtimeBadge>` component for reconnect UX (NEW) per Tier-A §3.7 / §5.5
- Reconnect cascade per Tier-A §5.5
- Migrate consumers in the prescribed order (below)
- Delete the old per-channel subscription helpers once no consumer remains
- New Vitest cases for the demuxer
- New Playwright: open many UI surfaces, assert exactly 1 active Realtime channel via test instrumentation
- Regression suite passes
- Manual stress test: open ~10 browser tabs as the same user, check Supabase logs / dashboard for total channel count

### B.5 — Scope OUT
- Server-side Realtime infrastructure changes — staying on Supabase Realtime
- Cross-user channel sharing — channels are per-tab, not per-org
- Cross-tab coordination via BroadcastChannel API — V2 candidate; current spec accepts per-tab multiplication (H-34)
- Presence / awareness — out of scope; V2+

### B.5 — Consumer migration order

Per Tier-A §0.2.2 inventory. Order chosen for safety: smallest surface first, largest last.

| Order | Consumer | File | Topics | Rollback granularity |
|---|---|---|---|---|
| 1 | AppShellStatusIndicator | `components/layout/AppShellStatusIndicator.tsx` | agent_jobs, briefs | One commit; revert if breaks |
| 2 | ModeTabBar | `components/layout/ModeTabBar.tsx` | conversation_messages, briefs | One commit |
| 3 | CostMeterFull | `components/cost/CostMeterFull.tsx` | (1 table; verify) | One commit |
| 4 | ProjectProfileViewer | `components/director/ProjectProfileViewer.tsx` | project_profiles, profile_amendments | One commit |
| 5 | useExportJobs (3 channels collapse) | `lib/hooks/useExportJobs.ts` | export_jobs | One commit, three sub-hooks merge |
| 6 | useAgentJobsRealtime | `lib/hooks/useAgentJobsRealtime.ts` | agent_jobs | One commit |
| 7 | useDirectorConversation (2 channels collapse) | `lib/hooks/useDirectorConversation.ts` | director_turns, conversation_messages | One commit, two sub-hooks merge |
| 8 | useNodesRealtime / useNodeRealtime (absorbed into B.3 patcher) | `lib/hooks/useNodesRealtime.ts`, `useNodeRealtime.ts` | nodes | Already partially migrated via B.3 patcher; close out here |
| 9 | SchedulerPanel | `components/scheduler/SchedulerPanel.tsx` | briefs, brief_stages, agent_jobs | One commit (largest single-component migration) |
| 10 | Delete obsolete per-channel helpers | various | n/a | One cleanup commit; no functional change |

Each consumer migration is its own commit on the sub-phase branch. **Each commit's tests must pass before moving to the next.** If a consumer migration breaks, revert that single commit, fix, re-commit. Other migrated consumers stay migrated.

### B.5 — Work items
1. Author `lib/realtime/useUserChannel.ts` singleton hook (absorbs `ensureRealtimeAuth`)
2. Author `lib/realtime/demuxer.ts` event-bus
3. Author `lib/realtime/useRealtimeTopic.ts` subscriber hook
4. Author `<RealtimeBadge>` component for reconnect UX
5. Wire `useUserChannel` to mount at app root (`app/(app)/layout.tsx`) so it's tab-stable
6. Lock filter list per Tier-A §5.2 (9 distinct topics)
7. Author Vitest cases for the demuxer routing logic
8. Author Vitest cases for reconnect cascade
9. Migrate consumers in the prescribed order; each commit independently testable
10. Author the channel-count assertion test
11. Manual stress test: 10 browser tabs
12. Delete obsolete per-channel helpers (final commit)
13. Update memory `feedback_intermittent_problem_methodology.md` — note that the 4-hook follow-up is closed by B.5 substrate
14. Test Report → PASS → merge
15. Post-merge: Vercel smoke per §8

### B.5 — Files touched
- `lib/realtime/useUserChannel.ts` (NEW)
- `lib/realtime/demuxer.ts` (NEW)
- `lib/realtime/useRealtimeTopic.ts` (NEW)
- `components/feedback/RealtimeBadge.tsx` (NEW)
- `app/(app)/layout.tsx` (mount the channel + badge)
- Every Realtime-using component (modified per §B.5 consumer migration order)
- `lib/supabase/realtime-auth.ts` (no change — substrate calls it; consumers stop calling it)
- Old per-channel hooks (deleted in step 12)
- `tests/unit/realtime-demuxer.test.ts` (NEW)
- `tests/v1x-phase8-5b/single-channel-multiplex.spec.ts` (NEW)
- Memory: `feedback_intermittent_problem_methodology.md` (note closure of follow-up)

### B.5 — Acceptance criteria
- [ ] At most 1 active Realtime channel per browser tab (verifiable via test instrumentation)
- [ ] All Realtime-driven UI surfaces still update correctly
- [ ] Two-tab and four-tab Playwright tests still green
- [ ] Manual: open 10 browser tabs as same user; confirm channel count low
- [ ] RealtimeBadge surfaces during reconnect; clears on success
- [ ] Disconnect/reconnect cycle preserves data integrity (TanStack `refetchOnReconnect: 'always'` runs)
- [ ] Full suite green
- [ ] Vercel smoke per §8 complete
- [ ] Test Report PASS

### B.5 — Blast radius
**The most invasive sub-phase.** Touches every Realtime-using component (11 surfaces per §0.2.2). Held until B.1-B.4 have shipped so the existing wins are not blocked on this. Rollback granularity is per-consumer-commit, not per-sub-phase.

---

## 6. Sub-phase B.6 — Bundle slim + polish

### B.6 — Estimated effort
**1 session.**

### B.6 — Goal
Remove the `docx + epub` client leak. Confirm Tiptap chunk is only loaded on routes that need it. Audit lucide imports. Add Husky pre-push bundle-size budget check.

### B.6 — Scope IN
- Identify the import path that brings `docx + epub` into the client bundle; restructure
- Audit `next/dynamic` usage for Director panel, Focus Mode, Scheduler view, Export modal
- Audit lucide-react: confirm named imports throughout; fix any namespace imports
- Add `@next/bundle-analyzer` to devDependencies
- Add Husky pre-push hook (per Tier-A §7.1)
- Add `scripts/check-bundle-budget.ts` that runs `next build`, parses output, asserts against budget
- Hook into `.husky/pre-push` so it fires before push
- Regression: full suite passes

### B.6 — Scope OUT
- React Server Component conversions beyond what landed in B.4
- Webpack/Turbopack config rewriting
- New code-splitting strategies beyond `next/dynamic`
- GitHub Actions / cloud CI migration (V2)

### B.6 — Work items
1. Run `npx @next/bundle-analyzer` on the current build; identify the `docx + epub` import chain
2. Move the offender to a server-only module if it isn't already; verify `serverExternalPackages` config covers it
3. Re-build, confirm chunks no longer contain `docx`/`epub` strings
4. Audit each route's First Load JS via the analyzer; compare to budget; identify any other unexpected inclusions
5. Apply `next/dynamic { ssr: false }` to Director/Focus/Scheduler if not already
6. Lucide audit: Grep for `import * as.*from 'lucide-react'`; convert to named imports
7. `npm install --save-dev husky @next/bundle-analyzer`
8. `npx husky init`
9. Author `.husky/pre-push` that runs `npm run check-bundle-budget`
10. Author `scripts/check-bundle-budget.ts`:
   - Runs `next build`
   - Reads `.next/build-manifest.json`
   - Asserts each route's First Load JS against budget
   - Exits non-zero on regression
11. Verify the script flags the over-budget current state, then verify the fixes bring it under budget
12. Verify pre-push hook fires (test with a deliberately over-budget commit)
13. Test Report → PASS → merge
14. Post-merge: Vercel smoke per §8

### B.6 — Files touched
- `next.config.ts` (potentially modified — `serverExternalPackages` audit)
- Modules that imported `docx`/`epub` from a client-reachable path (restructured)
- Component files using `next/dynamic` (modified imports)
- Various files (modified to switch lucide imports to named form)
- `package.json` (devDeps + scripts)
- `.husky/pre-push` (NEW)
- `scripts/check-bundle-budget.ts` (NEW)

### B.6 — Acceptance criteria
- [ ] `docx` and `epub-gen-memory` not present in any client chunk
- [ ] Document page First Load JS ≤ 350 KB gzipped
- [ ] Dashboard First Load JS ≤ 200 KB gzipped
- [ ] Husky pre-push hook fires; rejects over-budget pushes
- [ ] Full suite green
- [ ] Vercel smoke per §8 complete
- [ ] Test Report PASS

### B.6 — Blast radius
Build config + a few import statements + new husky/script. Lowest-risk of the six.

---

## 7. Phase 8.5b close-out

Once B.6 ships:

1. Author consolidated `docs/stelavox_phase8_5b_test_report_v1_0.md` (Tier-C-equivalent close-out report) — per-sub-phase verdicts, deltas vs the perf baseline, any deferrals
2. Re-run the Phase 8.5 measurement harness (`scripts/measure-perf.ts`) against the mega-doc to compare before/after numbers; include in close-out
3. Update `docs/stelavox_technical_architecture_v*.md`:
   - §11 — Phase 8 row gains "8.5b — Document Load Architecture" with MET status
   - §5 — H-29..H-35 hazards documented in full
   - §3.6 / §3.7 — relevant subsections referencing the new patterns
4. Update `CLAUDE.md`:
   - Current phase tasks cell reset to Phase 8.6 (E2E suite)
   - Changelog entry documenting 8.5b ship
5. Memory updates:
   - Update `project_v1_launch_phase_plan.md` to show 8.5b shipped and 8.6/8.7/8.12 unblocked
   - Note `feedback_intermittent_problem_methodology.md` follow-up closure
6. **Phases 8.6 / 8.7 / 8.12 unblock and resume.** Resumption protocol in §9.

Detailed re-measurement runs against the mega-doc fixture seeded by `scripts/seed-mega-doc.ts`. The fixture stays in the local DB for ongoing regression checks; gitignore the JSON measurement artifacts under `docs/perf/` if not already.

---

## 8. Per-sub-phase Vercel smoke

After each sub-phase merge:

1. Vercel auto-deploys master on push
2. Within 30 minutes of merge, manually smoke against `stelavox.vercel.app`:
   - Sign in
   - Open a document (the cloud equivalent of mega-doc, or any large doc)
   - Verify the sub-phase's user-visible improvement is present (per acceptance criteria)
   - Verify no console errors in browser DevTools
   - Verify no failed network requests
3. If smoke fails:
   - Open an issue describing the failure
   - Decide: fix-forward (preferred) or revert
   - If revert: `git revert -m 1 <merge-commit>`; fix root cause; re-ship
4. Log the smoke result in the sub-phase's Test Report under "Vercel smoke"

Note: there's no cloud equivalent of the mega-doc by default. Either seed one (via the seed-mega-doc script targeted at cloud Supabase — requires service key swap) or accept that cloud smoke uses a smaller fixture.

---

## 9. Resumption protocol after 8.5b close-out

After §7 close-out completes:

1. `CLAUDE.md` current-phase cell updated to "Phase 8.6 — V1 launch E2E suite"
2. Phase 8.6 is the next coding work; uses the existing E2E test infrastructure
3. Phase 8.7 (deploy hardening) follows
4. Phase 8.12 (deferred Phase 3 tests) is the smallest; can slot opportunistically
5. Each retains its existing scope from TA §11

The Phase 8 sequence resumes where it paused before 8.5b. No re-planning needed.

---

## 10. Sub-phase merge cadence and rollback strategy

- Each sub-phase merges to master via `--no-ff` after its Test Report PASSes
- Vercel auto-deploys master push (see §8)
- Manual smoke against `stelavox.vercel.app` within 30 minutes of each merge
- If a regression surfaces post-merge that wasn't caught by tests:
  - Add a regression test reproducing it
  - Fix forward on a new branch
  - Merge the fix via `--no-ff` as a follow-up commit on master
  - Do NOT revert a previously-merged sub-phase unless the regression is severe enough that revert is faster than fix-forward

The deferred phases (8.6 E2E suite, 8.7 deploy hardening, 8.12 backfill tests) remain off-master until 8.5b closes.

### Within-sub-phase rollback granularity

| Sub-phase | Rollback unit |
|---|---|
| B.1 | Whole sub-phase (it's one logical change) |
| B.2 | Per consumer commit; can revert any individual consumer migration |
| B.3 | Per surface (tree, detail, autosave); each is independently revertable |
| B.4 | Whole sub-phase |
| B.5 | Per consumer commit (most granular — see §5 consumer migration order) |
| B.6 | Per fix; husky hook is independently revertable |

Sub-phase branches are not merged to master until the sub-phase is whole; intermediate commits stay on the sub-phase branch.

---

## Changelog

**v1.1 — 2026-06-08** Audit pass — absorbed C1, C2, C8, I5, I6, I7, M5, M7 findings from the 2026-06-08 critical review. Cross-references added to Tier-A §0.2 (inventory) and §0.3 (decisions). Per-sub-phase estimated session counts added (B.1 = 1, B.2 = 2, B.3 = 2, B.4 = 1, B.5 = 3, B.6 = 1; total = 10). B.2b prescribed consumer migration order added (9 ordered steps; each commit independently testable). B.5 substrate explicitly absorbs `lib/supabase/realtime-auth.ts` and the per-table hooks (`useNodesRealtime`, `useNodeRealtime`, etc.). B.5 prescribed consumer migration order added (10 ordered steps; per-consumer-commit rollback granularity). B.6 husky pre-push mechanism specified. §7 close-out details 8.6/8.7/8.12 unblock; §9 resumption protocol added. §8 per-sub-phase Vercel smoke step added with explicit cadence (within 30 min of merge). §10 within-sub-phase rollback granularity table added. B.3 scope clarified: error UX (`QueryErrorFallback`), loading skeletons (`TreeSkeleton`, `DetailPanelSkeleton`), ordering buffer for Realtime-before-fetch (per Tier-A §3.4.1). Observability metrics endpoint deferred from B.3 scope to Phase 8.5c or V1.x-E. v1.0 sub-phase content retained substantively.

**v1.0 — 2026-06-08** Initial draft. Authored as the Tier-B build checklist for Phase 8.5b — Document Load Architecture, with six sub-phases B.1 through B.6. Per sub-phase: scope-in, scope-out, work items, files touched, acceptance criteria, blast radius. Two-commit pattern mandated for B.2 (the only sub-phase with a default-behaviour change). Close-out items at §7 ensure Tier-A doc sync (TA + CLAUDE.md) and re-measurement against the Phase 8.5 baseline. Phases 8.6 / 8.7 / 8.12 explicitly deferred until 8.5b closes.
