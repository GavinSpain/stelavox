# Phase 8.5b — Document Load Architecture Test Plan
## Version 1.1
**Date:** 2026-06-08
**Status:** Draft v1.1 — for user review before any code lands
**References:** `docs/stelavox_document_load_architecture_v1_0.md` (Tier-A spec v1.1), `docs/stelavox_phase8_5b_build_checklist_v1_0.md` (build checklist v1.1)

> **v1.1 audit pass.** Incorporates the C5, C9, C10, M5 audit findings from 2026-06-08. **Every test case rewritten with explicit GIVEN / WHEN / THEN precision** so an implementer can author the test without ambiguity. New §10 — Edge case test matrix — covers empty doc, deleted-while-viewing, network drop mid-mutation, RLS revoked, deep tree, concurrent edits. New TC-8.5b-B3-21 for the Realtime-before-fetch ordering buffer (per Tier-A §3.4.1). Per-sub-phase Vercel smoke instructions added (§11). Test count grew from ~85 to ~110 cases.

---

## 0. Overview

This document defines the test discipline applied to every Phase 8.5b sub-phase. The shape per sub-phase:

1. **New test cases** — assertions added in the sub-phase, written as GIVEN / WHEN / THEN
2. **Regression set** — pre-existing tests that must still pass
3. **Manual verification checklist** — what to look at in the browser
4. **Perf-budget assertions** — measurable thresholds that fail the PR
5. **Vercel smoke step** — manual smoke against `stelavox.vercel.app` post-merge
6. **Sub-phase verdict** — explicit pass criteria for the Test Report

The goal is **no regression of working surfaces**. Every sub-phase preserves what shipped before. Pattern matches the existing Stelavox precedent of per-sub-phase Test Reports (V1.x-A.1 through V1.x-F, Phase 8 cluster).

**Test case naming convention.** New cases use the `TC-8.5b-<sub>-<n>` prefix:
- `TC-8.5b-B1-01` etc for B.1
- `TC-8.5b-B2-01` etc for B.2
- and so on

This keeps them distinct from the historical TC-A / TC-M / TC-U / TC-J families and easy to grep.

**Two test layers — Vitest and Playwright.** Vitest covers pure function and RPC contract testing. Playwright covers user-journey + UI + perf assertions. **All Playwright tests run against production build mode (`npm run build && npm run start`)** unless otherwise specified — dev mode timings are noise.

**Baseline before each sub-phase.** Before starting any sub-phase, run the full suite locally and record the pass count + screenshot the affected surfaces. This is the "before" reference. At sub-phase close-out the same checks must hold (count must not decrease; screenshots of unchanged surfaces must match).

### 0.1 Test case precision standard

Every test case in this plan follows this template:

> **TC-8.5b-XX-NN — Short title**
> **GIVEN** (initial state — fixtures, navigation, prior actions)
> **WHEN** (the single user-visible action or input being tested)
> **THEN** (the specific observable outcome — DOM state, network call, timing, no-action)

Tests not meeting this precision standard are NOT acceptable. If a case cannot be expressed precisely, it indicates a spec gap that must be resolved before the test is authored.

### 0.2 Fixture data

Three fixtures, used across all sub-phases:
- **Sample Novel** (16 nodes, 8 beats, ~640 words) — seeded by `scripts/seed-sample-novel.ts`
- **Shadow Protocol** (~135 nodes, ~50k words) — seeded by `scripts/seed-shadow-protocol.ts`
- **Mega Manuscript** (1556 nodes, 1250 beats, 500006 words) — seeded by `scripts/seed-mega-doc.ts`

Tests use the most-appropriate fixture per their needs. Mega is the scaling fixture; Shadow Protocol is the production-realistic; Sample Novel is the smoke fixture.

### 0.3 Test isolation

- Playwright tests run against a clean local Supabase + the seeded fixtures
- Each spec file gets its own browser context (test isolation)
- Cross-spec database writes are not allowed except for the seeded fixtures
- Cleanup after mutation tests via per-test teardown

---

## 1. Sub-phase B.1 — Rollup correctness

### B.1 — New test cases

**Vitest unit cases** (file: `tests/unit/rollup-rpcs.test.ts`)

**TC-8.5b-B1-01 — Document rollup on Sample Novel returns correct counts**
- GIVEN the Sample Novel fixture is seeded
- WHEN `supabase.rpc('get_document_rollup', { p_document_id: sampleDocId })` is called
- THEN response contains `words_drafted = sum-of-leaf-actuals`, `leaf_count = 8`, `node_count = 16`, `status_counts = {draft: 16}`

**TC-8.5b-B1-02 — Document rollup on Shadow Protocol matches documented baseline**
- GIVEN the Shadow Protocol fixture is seeded
- WHEN `get_document_rollup` is called with its document id
- THEN response matches the documented baseline (specific numbers from `seed-shadow-protocol.ts` output; record in fixture validation)

**TC-8.5b-B1-03 — Document rollup on Mega Manuscript returns exact mega-doc values**
- GIVEN the Mega Manuscript fixture is seeded
- WHEN `get_document_rollup` is called with the mega-doc id
- THEN `words_drafted = 500006`, `leaf_count = 1250`, `node_count = 1556`, `status_counts.draft = 1556`

**TC-8.5b-B1-04 — Project rollup sums all documents**
- GIVEN a project containing two documents A (10k words) and B (20k words)
- WHEN `get_project_rollup(projectId)` is called
- THEN `words_drafted = 30000`, `document_count = 2`, `node_count = A.nodes + B.nodes`

**TC-8.5b-B1-05 — Empty document returns zeros not NULL**
- GIVEN a freshly-created document with only the root node
- WHEN `get_document_rollup(docId)` is called
- THEN response contains `words_drafted: 0, words_target: 0, node_count: 1, leaf_count: 0, status_counts: {}`

**TC-8.5b-B1-06 — Anon-client cross-org call returns zero result**
- GIVEN two orgs A and B; user is signed in to A; document belongs to B
- WHEN `get_document_rollup(bDocumentId)` is called via the anon client (with user's JWT)
- THEN response is empty / zero (RLS filters the underlying nodes query)

**TC-8.5b-B1-07 — Service-role call bypasses RLS**
- GIVEN any document
- WHEN `get_document_rollup` is called using the service-role client
- THEN response contains the actual aggregates (no RLS filtering)

**TC-8.5b-B1-08 — Status counts JSONB is keyed by status value**
- GIVEN a document with 3 draft, 2 in_progress, 1 approved status leaf nodes
- WHEN `get_document_rollup(docId)` is called
- THEN `status_counts` equals `{"draft": 3, "in_progress": 2, "approved": 1}`

**TC-8.5b-B1-09 — RPC body declares `SET search_path = public`**
- GIVEN the migration file
- WHEN parsed for the `SECURITY DEFINER` function definition
- THEN it contains `SET search_path = public` per H-13

**TC-8.5b-B1-10 — `last_updated_at` equals max(updated_at)**
- GIVEN a document where one node has `updated_at = '2026-06-08T12:00:00Z'` (the most recent), others older
- WHEN `get_document_rollup(docId)` is called
- THEN `last_updated_at = '2026-06-08T12:00:00Z'`

**Playwright integration cases** (file: `tests/v1x-phase8-5b/dashboard-mega-doc.spec.ts`)

**TC-8.5b-B1-11 — Dashboard ProjectCard for mega-doc shows ≥ 500k words**
- GIVEN the Mega Manuscript fixture is seeded AND user is signed in
- WHEN user navigates to `/dashboard`
- THEN the ProjectCard for "Mega Manuscript" displays a word count string containing "500,000" or "500K" (regression guard for the 187k bug)

**TC-8.5b-B1-12 — Dashboard ProjectCard for Sample Novel shows ~640 words**
- GIVEN the Sample Novel fixture is seeded AND user is signed in
- WHEN user navigates to `/dashboard`
- THEN the ProjectCard for "Sample Novel — The Quiet Door" displays a word count between 600 and 700

**TC-8.5b-B1-13 — Progress bar reflects new rollup values**
- GIVEN a project with `words_drafted = 100000`, `words_target = 200000`
- WHEN user navigates to `/dashboard`
- THEN the ProjectCard progress bar visually reflects 50% complete (computed `Math.min(100, Math.round(wordsDrafted/wordsTarget * 100))`)

**TC-8.5b-B1-14 — Document header word-count display reflects rollup**
- GIVEN the Mega Manuscript fixture is seeded
- WHEN user opens `/projects/[megaId]/documents/[megaDocId]`
- THEN the document header word-count strip displays the rollup value (verify visual matches expected after wire-up)

### B.1 — Regression set
Full Vitest and Playwright suites must remain green. Specifically:
- Every existing Phase 8.01.D dashboard test
- Every existing rollup-adjacent unit test (`tests/unit/project-aggregates.test.ts` if it exists; create if not)
- All Sample Novel and Shadow Protocol fixture tests

### B.1 — Manual verification checklist
- [ ] Load `/dashboard` in production-build mode. Mega Manuscript card shows real ≥ 500k words. Sample Novel card shows correct ~640 words.
- [ ] Hover/click a ProjectCard — confirm progress bar reflects the new numbers
- [ ] Open `/projects/[megaId]` — confirm Header still works (document count, last-active unchanged)
- [ ] Open `/projects/[megaId]/documents/[megaDocId]` — confirm tree still loads, no visual regression
- [ ] Browser DevTools Network tab: confirm the new `/api/documents/[id]/rollup` and `/api/projects/[id]/rollup` calls fire when expected, and complete in < 100 ms each

### B.1 — Perf-budget assertions
- TC-8.5b-B1-P01: Document rollup RPC < 100 ms p50 against mega-doc (Vitest timing — 10 runs, take median)
- TC-8.5b-B1-P02: Project rollup RPC < 200 ms p50 against the org (Vitest timing — 10 runs, take median)

### B.1 — Vercel smoke (post-merge)
Sign in to `stelavox.vercel.app`. Open the dashboard. Confirm:
- No console errors
- ProjectCards render with word counts
- Word counts are non-zero for projects with documents

### B.1 — Test Report verdict criteria
PASS when:
- All 14 new test cases green
- Both perf-budget assertions pass
- Full Vitest suite green
- Full Playwright suite green
- All manual checklist items confirmed
- Vercel smoke complete with no console errors

---

## 2. Sub-phase B.2 — Endpoint projection

### B.2a — New test cases (back-compat addition)

**Vitest unit cases** (file: `tests/unit/nodes-route-projection.test.ts`)

**TC-8.5b-B2a-01 — Default returns current payload (back-compat)**
- GIVEN B.2a code is deployed
- WHEN `GET /api/documents/[mega]/nodes` is called with no `?include=`
- THEN response payload size is ≥ 2.0 MB AND `rows[0]` contains a `prose` field

**TC-8.5b-B2a-02 — Explicit `?include=*` matches default behaviour**
- GIVEN B.2a code is deployed
- WHEN `GET /api/documents/[mega]/nodes?include=*` is called
- THEN response payload is identical (within timing-noise tolerance) to TC-8.5b-B2a-01 response

**TC-8.5b-B2a-03 — `?include=summary` excludes prose**
- GIVEN B.2a code is deployed
- WHEN `GET /api/documents/[mega]/nodes?include=summary` is called
- THEN `rows[0]` contains `summary` but NOT `prose` NOR `metadata` NOR `notes`

**TC-8.5b-B2a-04 — `?include=prose` excludes summary**
- GIVEN B.2a code is deployed
- WHEN `GET /api/documents/[mega]/nodes?include=prose` is called
- THEN `rows[0]` contains `prose` but NOT `summary` NOR `metadata` NOR `notes`

**TC-8.5b-B2a-05 — `?include=summary,prose` includes both, excludes others**
- WHEN `GET /api/documents/[mega]/nodes?include=summary,prose` is called
- THEN `rows[0]` contains both `summary` and `prose` but NOT `metadata` NOR `notes`

**TC-8.5b-B2a-06 — `?include=unknown` returns 400**
- WHEN `GET /api/documents/[mega]/nodes?include=foobar` is called
- THEN response status is 400 AND response body contains the allow-list error message naming `foobar`

**TC-8.5b-B2a-07 — Allow-list validation precedes Supabase call**
- GIVEN a Supabase mock that throws on any call
- WHEN the route handler receives `?include=invalid`
- THEN it returns 400 WITHOUT invoking the Supabase mock (validation happens first)

**TC-8.5b-B2a-08 — Projection is via SELECT columns at DB layer**
- GIVEN a Supabase mock that captures the SELECT clause string
- WHEN the route handler is called with `?include=summary`
- THEN the captured SELECT clause contains `summary` but NOT `prose`, `metadata`, `notes`

### B.2b — New test cases (default flip)

**Vitest unit cases** (add to same file)

**TC-8.5b-B2b-01 — Default returns projected payload (flip)**
- GIVEN B.2b code is deployed
- WHEN `GET /api/documents/[mega]/nodes` is called with no `?include=`
- THEN response payload size is ≤ 100 KB gzipped AND `rows[0]` does NOT contain `prose`, `summary`, `metadata`, `notes`

**TC-8.5b-B2b-02 — `?include=*` still returns all columns (escape hatch)**
- GIVEN B.2b code is deployed
- WHEN `GET /api/documents/[mega]/nodes?include=*` is called
- THEN `rows[0]` contains `prose` AND `summary` AND all other fields

**TC-8.5b-B2b-03 — All 8 consumers continue passing their tests**
- GIVEN all 8 consumers have been migrated to their target `?include=...` value
- WHEN their respective existing test suites run
- THEN every test in those suites still passes

**Playwright integration cases** (file: `tests/v1x-phase8-5b/mega-doc-projection.spec.ts`)

**TC-8.5b-B2b-04 — Mega-doc default response ≤ 100 KB gzipped**
- GIVEN the Mega Manuscript fixture and B.2b deployed
- WHEN user navigates to `/projects/[megaId]/documents/[megaDocId]`
- THEN the `/api/documents/[id]/nodes` response has `content-length` indicating ≤ 100 KB gzipped (network-tap)

**TC-8.5b-B2b-05 — `?include=prose` response is ≥ 2 MB (regression guard for escape hatch)**
- GIVEN the Mega Manuscript fixture
- WHEN `fetch('/api/documents/[megaDocId]/nodes?include=prose')` is executed in the browser
- THEN response payload size is ≥ 2 MB

**TC-8.5b-B2b-06 — Tree renders all 1556 rows correctly after flip**
- GIVEN the Mega Manuscript fixture and B.2b deployed
- WHEN user opens the mega-doc
- THEN `[role="treeitem"]` element count equals 1556

**TC-8.5b-B2b-07 — Detail panel hydrates correctly via `/api/nodes/[id]`**
- GIVEN B.2b deployed and a beat in the mega-doc
- WHEN user clicks that beat
- THEN `[data-testid="detail-title-row"]` becomes visible AND a `GET /api/nodes/[beatId]` network call is recorded AND the panel content matches the beat's data

**TC-8.5b-B2b-08 — Director conversation context still includes prose for referenced nodes**
- GIVEN B.2b deployed and a document with prose content
- WHEN user sends a Director message referencing a specific node `@Beat 1.1`
- THEN the Director response stream contains the prose content of `Beat 1.1` in its context

**TC-8.5b-B2b-09 — Export still produces correct DOCX with full prose**
- GIVEN B.2b deployed and the Mega Manuscript document
- WHEN user triggers a DOCX export
- THEN the resulting DOCX file size is within 10% of pre-B.2b baseline AND contains the prose from at least 100 random beats sampled

**TC-8.5b-B2b-10 — Workflow read tools that need prose still receive it**
- GIVEN B.2b deployed
- WHEN a workflow with a `synthesise_beat` step is dispatched
- THEN the agent job's input context contains the prose of the target node and adjacent siblings

### B.2 — Regression set
- All existing tree-rendering tests
- All existing detail-panel tests
- All existing autosave tests
- All existing Director conversation tests
- All existing export tests
- All existing workflow execution tests
- Any test asserting specific `/api/documents/[id]/nodes` response shape (likely needs update for B.2b — flag in audit)

### B.2 — Manual verification checklist (B.2a)
- [ ] Browser Network tab: hit a document — confirm response payload size and shape unchanged from baseline
- [ ] Manually request `/api/documents/[megaDocId]/nodes?include=summary` via DevTools fetch — confirm projected payload

### B.2 — Manual verification checklist (B.2b)
- [ ] Browser Network tab on cold document open: confirm `/api/documents/[id]/nodes` response < 100 KB
- [ ] Browser-side fetch test: `fetch('/api/documents/[id]/nodes?include=prose')` returns ~2 MB
- [ ] Open every beat in succession — confirm detail panel + editor work, prose loads via `/api/nodes/[id]`
- [ ] Run an export from the project page — confirm DOCX has full prose
- [ ] Open Director, send a message that references nodes — confirm context includes prose
- [ ] Open Focus Mode on a beat — confirm prose visible
- [ ] Run the Phase 8.5 measure-perf harness against the mega-doc — confirm J2 timing improved meaningfully

### B.2 — Perf-budget assertions
- TC-8.5b-B2-P01: Mega-doc default `/api/documents/[id]/nodes` payload ≤ 100 KB gzipped (Playwright network-tap; assertion on `Content-Length` or response.body().byteLength after gzip)
- TC-8.5b-B2-P02: Mega-doc default `/api/documents/[id]/nodes` server time ≤ 500 ms p50 (Playwright timing; 10 runs, take median)

### B.2 — Vercel smoke (post-merge)
Sign in to `stelavox.vercel.app`. Open a document (any). Confirm:
- Tree loads quickly (subjective; if visibly slow, investigate)
- No console errors
- Clicking a beat opens the detail panel; prose visible
- No failed network requests in DevTools

### B.2 — Test Report verdict criteria
PASS when:
- All 18 new test cases green (B2a-01..08 + B2b-01..10)
- Both perf budgets pass
- Full Vitest + Playwright suites green
- Manual checklist (both a and b) complete
- Vercel smoke complete

---

## 3. Sub-phase B.3 — Client cache (TanStack Query)

### B.3 — New test cases

**Vitest unit cases** (file: `tests/unit/queries-document-nodes.test.ts` + siblings)

**TC-8.5b-B3-01 — `useDocumentNodes` returns typed structural rows**
- GIVEN B.3 deployed and a Test wrapper QueryClientProvider
- WHEN `useDocumentNodes(megaDocId)` hook is rendered AND `await waitFor(query.isSuccess)`
- THEN `result.current.data` is a `StructuralNodeRow[]` AND `data.length === 1556` AND `data[0]` does NOT contain `prose`

**TC-8.5b-B3-02 — `useDocumentNodes` exposes loading state**
- GIVEN a mock fetch that delays 200 ms
- WHEN the hook is rendered
- THEN immediately `result.current.isLoading === true` AND `result.current.data === undefined`

**TC-8.5b-B3-03 — `useNode` returns full node record**
- GIVEN B.3 deployed and a beat node
- WHEN `useNode(beatId)` resolves
- THEN `result.current.data` contains `prose` field

**TC-8.5b-B3-04 — `useDocumentRollup` returns DocumentRollup type**
- GIVEN B.3 deployed
- WHEN `useDocumentRollup(megaDocId)` resolves
- THEN `result.current.data` matches the `DocumentRollup` interface AND `words_drafted === 500006`

**TC-8.5b-B3-05 — `useProjectRollup` returns ProjectRollup type**
- GIVEN B.3 deployed
- WHEN `useProjectRollup(megaProjectId)` resolves
- THEN `result.current.data` matches the `ProjectRollup` interface

**TC-8.5b-B3-06 — Cache keys use typed factories**
- GIVEN the cache key factories file `lib/queries/keys.ts`
- WHEN inspected
- THEN `documentKeys.nodes(docId)` equals `['document', docId, 'nodes']` AND there are no inline cache-key literals in `lib/queries/*.ts`

**TC-8.5b-B3-07 — Realtime patcher applies single-row UPDATE**
- GIVEN cache populated with 5 rows; one with id `X`
- WHEN `onNodeUpdate({ id: 'X', name: 'New Name', ... })` is invoked
- THEN cache row with id `X` has `name === 'New Name'` AND other 4 rows unchanged

**TC-8.5b-B3-08 — Realtime patcher updates per-node cache**
- GIVEN cache `['node', 'X']` populated
- WHEN `onNodeUpdate({ id: 'X', prose: NEW_PROSE, ... })` is invoked
- THEN `getQueryData(['node', 'X'])` contains `prose === NEW_PROSE`

**TC-8.5b-B3-09 — Aggregate-affecting change invalidates rollup**
- GIVEN cache `['document', docId, 'rollup']` populated AND `invalidateQueries` is spied
- WHEN `onNodeUpdate({ word_count_actual: 999, document_id: docId, ... })` is invoked
- THEN `invalidateQueries` is called with `['document', docId, 'rollup']`

**TC-8.5b-B3-10 — Realtime INSERT adds to tree cache**
- GIVEN cache `['document', docId, 'nodes']` populated with 5 rows
- WHEN `onNodeInsert(newRow)` is invoked with `document_id: docId`
- THEN cache contains 6 rows AND last row equals structural fields of `newRow`

**TC-8.5b-B3-11 — Realtime DELETE removes from tree cache**
- GIVEN cache `['document', docId, 'nodes']` populated with 5 rows including row `X`
- WHEN `onNodeDelete({ id: 'X', document_id: docId })` is invoked
- THEN cache contains 4 rows AND no row has `id === 'X'`

**TC-8.5b-B3-12 — Autosave optimistic update applies; reverts on failure**
- GIVEN cache `['node', 'X']` contains `{name: 'Old'}` AND fetch mock returns 500
- WHEN `mutation.mutate({id: 'X', name: 'New'})` is called
- THEN immediately `getQueryData(['node', 'X']).name === 'New'`
- AND after the failure resolves: `getQueryData(['node', 'X']).name === 'Old'`
- AND a `FailureToast` event was emitted

**TC-8.5b-B3-13 — Autosave optimistic update reconciles on success**
- GIVEN cache `['node', 'X']` contains `{name: 'Old'}` AND fetch mock returns `{id: 'X', name: 'NewServer', version: 2}`
- WHEN `mutation.mutate({id: 'X', name: 'NewClient'})` is called
- THEN final cache state: `getQueryData(['node', 'X']) === {id: 'X', name: 'NewServer', version: 2}`

**Playwright integration cases** (file: `tests/v1x-phase8-5b/no-refetch-on-navigation.spec.ts`)

**TC-8.5b-B3-14 — Click between tree rows triggers no nodes refetch**
- GIVEN user is on mega-doc AND the initial tree fetch has completed
- WHEN user clicks Beat 1.1, then Beat 1.2, then Beat 1.3 (in sequence, each waited for detail panel)
- THEN exactly ZERO additional `GET /api/documents/[id]/nodes` calls are recorded after the initial one (network tap)

**TC-8.5b-B3-15 — Navigate to Director mode triggers no nodes refetch**
- GIVEN user is on mega-doc with tree fetched
- WHEN user clicks the Director tab in ModeTabBar
- THEN ZERO additional `GET /api/documents/[id]/nodes` calls are recorded

**TC-8.5b-B3-16 — Optimistic autosave visible without server round-trip**
- GIVEN user is editing a beat
- WHEN user types "x"
- THEN within 50 ms `[data-editor="prose"]` text content contains "x"
- AND a `PATCH /api/nodes/[id]` is fired (debounced)

**Playwright two-tab integration** (file: `tests/v1x-phase8-5b/two-tab-realtime-patch.spec.ts`)

**TC-8.5b-B3-17 — Tab A edits prose; Tab B reflects within 2 s without spinner**
- GIVEN two tabs (A and B) open on the same doc and same beat detail panel
- WHEN tab A types "marker" in the prose editor and waits 1 s (autosave debounce)
- THEN within 2 s after tab A's autosave fires, tab B's `[data-editor="prose"]` contains "marker"
- AND no `[data-testid="spinner"]` element appeared in tab B during the update

**TC-8.5b-B3-18 — Tab A renames beat; Tab B tree row updates without refetch**
- GIVEN two tabs open on the same doc
- WHEN tab A renames Beat 1.1 to "Renamed"
- THEN within 2 s tab B's `[role="treeitem"]` for that beat displays text containing "Renamed"
- AND tab B records zero new `GET /api/documents/[id]/nodes` calls

**TC-8.5b-B3-19 — Tab A creates new beat; Tab B tree shows it without refetch**
- GIVEN two tabs open on the same doc
- WHEN tab A POSTs `/api/documents/[id]/nodes` to create a new beat under Scene 1.1
- THEN within 2 s tab B's `[role="treeitem"]` count increases by 1
- AND tab B records zero new `GET /api/documents/[id]/nodes` calls

**TC-8.5b-B3-20 — Tab A deletes beat; Tab B tree removes it without refetch**
- GIVEN two tabs open on the same doc, both viewing tree
- WHEN tab A DELETEs Beat 1.1
- THEN within 2 s tab B's `[role="treeitem"]` for that beat is no longer present
- AND tab B records zero new `GET /api/documents/[id]/nodes` calls

**TC-8.5b-B3-21 — Realtime event arriving before initial fetch is buffered and applied**
- GIVEN a fresh page mount with mocked slow fetch (200 ms delay)
- WHEN a Realtime UPDATE event arrives at t = 50 ms (before fetch resolves)
- THEN the patch is buffered (no `setQueryData` thrown on undefined cache)
- AND when the fetch resolves at t = 200 ms, the cache contains BOTH the fetched data AND the buffered patch applied
- AND `pendingPatches` is empty after flush

### B.3 — Regression set
- All existing tree tests
- All existing detail-panel tests
- All existing autosave tests
- All existing Realtime-driven tests (e.g. status indicator updates)

### B.3 — Manual verification checklist
- [ ] Open dev tools React Query devtools panel; confirm queries are populating
- [ ] Open mega-doc — observe network tab; confirm tree fetch happens once
- [ ] Click between several beats — confirm no additional `/api/documents/[id]/nodes` calls; confirm `/api/nodes/[id]` fires per beat
- [ ] Type into a beat — observe optimistic update (instant feel); autosave PATCH fires after debounce
- [ ] Open two tabs to the same doc; edit in tab A; confirm tab B reflects the change without UI spinner
- [ ] Disconnect network briefly, reconnect; confirm `refetchOnReconnect` brings caches current
- [ ] Confirm `<TreeSkeleton>` shows during cold fetch (slow network throttle in DevTools)
- [ ] Confirm `<QueryErrorFallback>` shows when API returns 500 (use mock or temporary endpoint sabotage)

### B.3 — Perf-budget assertions
- TC-8.5b-B3-P01: Tree-row click → detail panel visible < 300 ms p50 (Playwright timing)
- TC-8.5b-B3-P02: Optimistic update visible < 50 ms p50 (Playwright timing)
- TC-8.5b-B3-P03: Tab-B reflects tab-A's change < 2 s p50 (Playwright)

### B.3 — Vercel smoke (post-merge)
Sign in to `stelavox.vercel.app`. Confirm:
- Open a document — tree loads
- Click between beats — no spinner; detail panel renders fast
- Edit prose — autosave fires; no console errors
- Open a second tab; edit in one, observe other updates

### B.3 — Test Report verdict criteria
PASS when:
- All 21 new test cases green (TC-8.5b-B3-01..21)
- All 3 perf budgets pass
- Full Vitest + Playwright suites green
- Manual checklist complete
- Vercel smoke complete

---

## 4. Sub-phase B.4 — RSC initial seed

### B.4 — New test cases

**Playwright integration** (file: `tests/v1x-phase8-5b/rsc-seed-cold-open.spec.ts`)

**TC-8.5b-B4-01 — Cold doc HTML contains dehydrated query state**
- GIVEN B.4 deployed and a fresh browser session (no cache)
- WHEN user navigates directly to `/projects/[megaId]/documents/[megaDocId]`
- THEN the initial HTML response contains the string `dehydratedState` (or equivalent serialised cache marker) somewhere in the body

**TC-8.5b-B4-02 — Cold doc open issues zero client-side nodes fetch**
- GIVEN B.4 deployed and a fresh browser session
- WHEN user navigates to the mega-doc URL AND `[role="treeitem"]` becomes visible
- THEN ZERO `GET /api/documents/[id]/nodes` client-side network calls were recorded

**TC-8.5b-B4-03 — Cold doc open total time within budget (production-build mode)**
- GIVEN production-build mode (`npm run build && npm run start`) AND a fresh browser session
- WHEN user navigates to mega-doc
- THEN time from `Date.now()` at navigation to first `[role="treeitem"]` visible is < 2000 ms in p50 (10 runs, take median)

**TC-8.5b-B4-04 — After cold open, click works as expected**
- GIVEN B.4 cold open complete
- WHEN user clicks Beat 1.1
- THEN detail panel renders within 300 ms AND no `GET /api/documents/[id]/nodes` re-fires

**TC-8.5b-B4-05 — Realtime patches cache after RSC seed**
- GIVEN B.4 cold open complete AND tab A open
- WHEN tab B (other session) UPDATEs Beat 1.1's name
- THEN tab A's tree updates within 2 s (cache-patching still works on top of seeded cache)

**TC-8.5b-B4-06 — No client refetch within `staleTime` window**
- GIVEN B.4 cold open complete
- WHEN user waits 50 seconds (within `staleTime: 60_000` of cold-landing)
- THEN ZERO `GET /api/documents/[id]/nodes` calls fired in those 50 seconds

### B.4 — Regression set
- All B.3 tests must still pass (RSC seed shouldn't break the cache patching)
- All existing document-page tests

### B.4 — Manual verification checklist
- [ ] Run `npm run build && npm run start` to test in production-build mode
- [ ] Open mega-doc cold (clear cache + cookies first); confirm tree visible quickly
- [ ] Inspect Network tab: confirm only the page HTML fetched, no `/api/documents/[id]/nodes` round-trip
- [ ] After page loads, edit a beat — confirm autosave still works
- [ ] Inspect HTML source — confirm dehydrated cache state is present

### B.4 — Perf-budget assertions
- TC-8.5b-B4-P01: Cold doc open total < 2 s p50 in production-build mode
- TC-8.5b-B4-P02: Cold doc open client `/api/documents/[id]/nodes` count === 0

### B.4 — Vercel smoke (post-merge)
Sign in to `stelavox.vercel.app`. Open a document cold (fresh tab). Confirm:
- Tree visible within ~2 seconds (subjective; flag if visibly slow)
- No console errors

### B.4 — Test Report verdict criteria
PASS when:
- All 6 new test cases green
- Both perf budgets pass
- Full Vitest + Playwright suites green
- Manual checklist complete
- Vercel smoke complete

---

## 5. Sub-phase B.5 — Realtime multiplex

### B.5 — New test cases

**Vitest unit cases** (file: `tests/unit/realtime-demuxer.test.ts`)

**TC-8.5b-B5-01 — Demuxer routes nodes event to subscribers**
- GIVEN demuxer instantiated AND a subscriber registered for `nodes` topic
- WHEN demuxer dispatches a `nodes` event with payload `{id: 'X'}`
- THEN the subscriber's `onEvent` callback is called once with the payload

**TC-8.5b-B5-02 — Demuxer respects per-component filter**
- GIVEN demuxer + subscriber registered for `nodes` topic with filter `row => row.document_id === 'A'`
- WHEN demuxer dispatches a `nodes` event with `document_id: 'B'`
- THEN the subscriber's `onEvent` is NOT called

**TC-8.5b-B5-03 — Multiple subscribers for same topic each receive event**
- GIVEN demuxer + two subscribers (sub1, sub2) registered for `nodes` topic
- WHEN demuxer dispatches a `nodes` event
- THEN both sub1.onEvent and sub2.onEvent are called once

**TC-8.5b-B5-04 — Subscriber unmount cleanly unregisters**
- GIVEN demuxer + subscriber registered AND an unsubscribe handle returned
- WHEN the unsubscribe handle is called
- THEN subsequent dispatches do NOT call the subscriber AND no memory leak (internal subscriber list is empty for that topic)

**TC-8.5b-B5-05 — Demuxer handles topic with no subscribers**
- GIVEN demuxer instantiated; no subscribers
- WHEN demuxer dispatches a `nodes` event
- THEN no error thrown

**TC-8.5b-B5-06 — Demuxer routes 9 distinct topics independently**
- GIVEN demuxer with one subscriber per topic (nodes, agent_jobs, briefs, brief_stages, conversation_messages, director_turns, export_jobs, project_profiles, profile_amendments)
- WHEN each topic's event is dispatched once
- THEN exactly one subscriber per topic receives its respective event; no cross-routing

**TC-8.5b-B5-07 — Reconnect cascade re-establishes filters**
- GIVEN `useUserChannel` mounted; channel subscribed
- WHEN the channel disconnects AND `useUserChannel` triggers reconnect
- THEN `ensureRealtimeAuth` is called AND the channel resubscribes with all 9 topic filters re-registered

**TC-8.5b-B5-08 — `ensureRealtimeAuth` is called before `.subscribe()`**
- GIVEN `useUserChannel` mounted
- WHEN the effect runs
- THEN the await of `ensureRealtimeAuth(supabase)` resolves BEFORE `.subscribe()` is invoked

**Playwright integration** (file: `tests/v1x-phase8-5b/single-channel-multiplex.spec.ts`)

**TC-8.5b-B5-09 — Single channel per tab across all UI surfaces**
- GIVEN B.5 deployed AND user signed in
- WHEN user navigates: dashboard → document page → director tab → scheduler page (all within one tab)
- THEN at any time the active Realtime channel count (via test-instrumented Supabase client) is exactly 1 (the `user:{userId}` channel)

**TC-8.5b-B5-10 — Status indicator updates via multiplexed channel**
- GIVEN B.5 deployed AND status indicator visible
- WHEN a Realtime UPDATE on `agent_jobs` fires (e.g. via a separate INSERT in another session)
- THEN within 2 s the status indicator's counter updates

**TC-8.5b-B5-11 — NodeTree updates via multiplexed channel**
- GIVEN B.5 deployed AND mega-doc tree visible
- WHEN tab B UPDATEs Beat 1.1 name
- THEN tab A's tree row for Beat 1.1 displays new name within 2 s

**TC-8.5b-B5-12 — DirectorPanel updates via multiplexed channel**
- GIVEN B.5 deployed AND Director conversation open
- WHEN a Realtime INSERT on `conversation_messages` fires (e.g. new assistant message)
- THEN the new message appears in the conversation thread within 2 s

**TC-8.5b-B5-13 — SchedulerPanel updates via multiplexed channel**
- GIVEN B.5 deployed AND Scheduler page open
- WHEN a Realtime UPDATE on `briefs` fires
- THEN the brief's row in the panel updates within 2 s

**TC-8.5b-B5-14 — BriefViewer updates via multiplexed channel**
- GIVEN B.5 deployed AND a brief's detail visible (if applicable; or ProjectProfileViewer instead)
- WHEN a Realtime UPDATE on `project_profiles` fires
- THEN the profile viewer reflects the update within 2 s

**TC-8.5b-B5-15 — RealtimeBadge surfaces during disconnect; clears on reconnect**
- GIVEN B.5 deployed AND channel connected
- WHEN the network is throttled to fully offline for 5 s, then restored
- THEN within 1 s of disconnect, `[data-testid="realtime-badge"]` becomes visible with "Reconnecting…" copy
- AND within 5 s after restore, the badge clears

**TC-8.5b-B5-16 — Two-tab tests from B.3 still pass under multiplex**
- GIVEN B.5 deployed
- WHEN running B.3's TC-8.5b-B3-17 through TC-8.5b-B3-20
- THEN all 4 pass

### B.5 — Regression set
- ALL B.3 + B.4 tests (tree cache + RSC seed) must still pass; multiplexing should be invisible to existing assertions
- All Realtime-driven UI tests (status indicator, agent badges, scheduler counts, Director streaming)

### B.5 — Manual verification checklist
- [ ] Open dev tools; in console, run `supabase.getChannels()` or equivalent test instrumentation; confirm exactly 1 channel
- [ ] Open every UI surface (dashboard / doc / Director / scheduler / brief / settings); re-check channel count — still 1
- [ ] Open 10 browser tabs as same user (test isolation: incognito vs regular for cookies); inspect Supabase logs for total channel count
- [ ] Trigger an event for each topic (write a node, dispatch an agent, propose a brief, etc.); confirm the relevant UI surface updates
- [ ] Disconnect/reconnect network briefly; confirm channel reconnects, badge surfaces and clears, updates resume

### B.5 — Perf-budget assertions
- TC-8.5b-B5-P01: Active Realtime channels per browser tab ≤ 1 (via test instrumentation against the Supabase client's channel list)
- TC-8.5b-B5-P02: Reconnect cascade completes within 10 s of network restoration p95

### B.5 — Vercel smoke (post-merge)
Sign in to `stelavox.vercel.app`. Confirm:
- Open dashboard then a document then scheduler — all surfaces still work
- Trigger a change in a second tab; confirm first tab updates
- Use DevTools to check `supabase.getChannels()` returns 1 entry

### B.5 — Test Report verdict criteria
PASS when:
- All 16 new test cases green
- Both perf budgets pass
- Full Vitest + Playwright suites green
- Manual checklist complete (especially the 10-tab stress test)
- No Realtime-driven UI surface regression
- Vercel smoke complete

---

## 6. Sub-phase B.6 — Bundle slim + polish

### B.6 — New test cases

**Bundle-size check** (file: `scripts/check-bundle-budget.ts`; invoked by husky pre-push)

**TC-8.5b-B6-01 — `next build` succeeds**
- GIVEN clean repo state
- WHEN `npm run build` is executed
- THEN exit code is 0

**TC-8.5b-B6-02 — Document page First Load JS ≤ 350 KB gzipped**
- GIVEN build complete
- WHEN check-bundle-budget parses the build output for the document route
- THEN reported First Load JS ≤ 350 KB gzipped

**TC-8.5b-B6-03 — Dashboard First Load JS ≤ 200 KB gzipped**
- GIVEN build complete
- WHEN check-bundle-budget parses the build output for the dashboard route
- THEN reported First Load JS ≤ 200 KB gzipped

**TC-8.5b-B6-04 — `docx` not in any client chunk**
- GIVEN build complete
- WHEN every file under `.next/static/chunks/*.js` is scanned for the string `"docx"`
- THEN zero matches

**TC-8.5b-B6-05 — `epub-gen-memory` not in any client chunk**
- GIVEN build complete
- WHEN client chunks scanned for `"epub-gen-memory"`
- THEN zero matches

**TC-8.5b-B6-06 — `@anthropic-ai/sdk` not in any client chunk**
- GIVEN build complete
- WHEN client chunks scanned for `"@anthropic-ai/sdk"`
- THEN zero matches

**Vitest unit case** (file: `tests/unit/bundle-discipline.test.ts`)

**TC-8.5b-B6-07 — No namespace imports of lucide-react**
- GIVEN the codebase
- WHEN `rg "import \* as.*from ['\"]lucide-react['\"]"` is executed against the source tree
- THEN zero matches

**TC-8.5b-B6-08 — Husky pre-push hook fires on over-budget push**
- GIVEN a commit that pushes bundle over budget (mock or actual)
- WHEN `git push` is attempted
- THEN the push is rejected by the hook AND the error message names the over-budget route

### B.6 — Regression set
Full Vitest + Playwright suites still green. Bundle changes should not affect runtime behaviour.

### B.6 — Manual verification checklist
- [ ] `npm run build` — note bundle sizes in the route table
- [ ] Open `.next/analyze/*.html` reports (from `@next/bundle-analyzer`) — visually confirm document page chunks no longer include docx/epub
- [ ] Cold-load `/dashboard` in production-build mode — confirm fast first paint
- [ ] Cold-load a document page — confirm Tiptap chunk loads (it has to) but no `docx`/`epub` chunks
- [ ] Navigate to `/admin`, `/settings`, etc. — confirm pages still work
- [ ] Run an export — confirm it still works (docx/epub are server-side; should be unaffected)
- [ ] Test the husky hook: make a commit that deliberately over-bloats a chunk; attempt push; confirm rejection

### B.6 — Perf-budget assertions
Covered by TC-8.5b-B6-02 and -03.

### B.6 — Vercel smoke (post-merge)
Sign in to `stelavox.vercel.app`. Confirm:
- Lighthouse score on `/dashboard` shows acceptable First Load JS (manual check)
- No console errors on any page
- Export still produces valid DOCX/EPUB

### B.6 — Test Report verdict criteria
PASS when:
- All 8 new test cases green
- Full Vitest + Playwright suites green
- Manual checklist complete
- Vercel smoke complete

---

## 7. Phase 8.5b — Overall close-out

After B.6 merges to master:

### 7.1 — Re-run baseline measurement
Run `npm run script scripts/measure-perf.ts -- --target local` against the mega-doc. Compare each journey's timing to the Phase 8.5 baseline (`docs/perf/measure-local-2026-06-07T13-28-07-687Z.json`).

Targets (matches Tier-A spec §8):

| Journey | Phase 8.5 baseline | Target after 8.5b | Status |
|---|---|---|---|
| J1 cold dashboard | 4,466 ms (dev mode) | n/a (architecture not focused here) | n/a |
| J2 cold doc open | 3,910 ms | < 2,000 ms | TBD |
| J3 click tree row | 3,372 ms | < 500 ms | TBD |
| J4 autosave | 2,317 ms | < 1,500 ms | TBD |
| J5 Director panel | 17,112 ms | investigate first | flagged |
| J7 POST export | 244 ms | unchanged | ✓ |
| J8 Sentence Focus | 3,883 ms (incl. nav) | unchanged | ✓ |

If J5 is still anomalous, treat as a separate investigation outside 8.5b scope.

### 7.2 — Tier-A spec sync
Update `docs/stelavox_technical_architecture_v*.md`:
- §11 — Phase 8 row gains "8.5b — Document Load Architecture" with MET status
- §5 — H-29..H-35 hazards documented in full
- §3.6 / §3.7 — relevant subsections referencing the new patterns

Update `CLAUDE.md`:
- Current phase tasks cell reset to Phase 8.6 (E2E suite) per build checklist §9
- Changelog entry documenting 8.5b ship

### 7.3 — Consolidated Test Report
Author `docs/stelavox_phase8_5b_test_report_v1_0.md` consolidating the per-sub-phase reports. Final verdict: PASS.

### 7.4 — Smoke against Vercel
Push master and verify on `stelavox.vercel.app`:
- Sign in
- Open the cloud equivalent of the mega-doc (or any doc — perf improvement should be visible across the board)
- Confirm tree, detail, Director, export all work
- Confirm no console errors

---

## 8. Failure modes and rollback

### What "PASS" requires
Every sub-phase Test Report must have:
- All listed new test cases passing
- Full Vitest + Playwright suite green (no decrease in pass count from baseline)
- Manual verification checklist complete with screenshots/notes
- All perf-budget assertions met
- Vercel smoke complete with no console errors
- No new hazards introduced beyond H-29..H-35 (and any new ones documented)

### What constitutes a failure
- Any sub-phase test case red
- Any pre-existing test that was green before sub-phase is red after
- Any perf budget violated
- A surface visually regresses (compared to before-screenshots)
- A Realtime topic stops working
- Vercel smoke shows console errors or visible regression

### Rollback policy
- Within sub-phase: revert the offending commit on the sub-phase branch; fix; re-test
- Post-merge regression (within 24h of merge): prefer fix-forward over revert unless severity warrants
- Major regression discovered later: full revert of the sub-phase merge; root-cause; re-plan; re-ship

### Risk register
Highest-risk sub-phase: **B.5 (Realtime multiplex)** — touches every Realtime consumer. The substrate-first / consumer-one-at-a-time pattern mitigates but doesn't eliminate.

Second-highest: **B.2 (Endpoint projection)** — the consumer-audit step has high "miss-something" risk. Two-commit pattern (B.2a back-compat, B.2b flip) mitigates.

Lowest-risk: **B.1 (rollup correctness)** — small, isolated, no UI changes.

---

## 9. Test coverage map

| Surface | Vitest | Playwright | Manual | Notes |
|---|---|---|---|---|
| Document rollup RPC | B.1 unit | B.1 dashboard | B.1 dev open | covers correctness + perf |
| Project rollup RPC | B.1 unit | B.1 dashboard | B.1 dev open | covers correctness + perf |
| Projected nodes endpoint | B.2 unit | B.2 mega | B.2 network tap | covers contract + size |
| Tree rendering | regression | regression | every sub-phase | preserves the existing surface |
| Detail panel | regression | regression | every sub-phase | preserves the existing surface |
| Autosave | B.3 unit | B.3 + regression | B.3 type-feel | adds optimistic |
| Realtime patching | B.3 + B.5 unit | B.3 two-tab | B.3 two-tab | preserves multi-tab behaviour |
| Realtime ordering buffer | B.3 unit (TC-21) | n/a | n/a | edge case proof |
| Realtime channel count | B.5 unit | B.5 integration | B.5 10-tab | new contract: ≤ 1 per tab |
| Cold doc open timing | B.4 perf | B.4 perf | B.4 verify | < 2 s p50 |
| Bundle size | B.6 budget | B.6 husky | B.6 verify | enforced pre-push |
| Director conversation | regression | regression | B.2 + B.5 | preserves existing |
| Export pipeline | regression | regression | B.2 verify | preserves existing |
| Focus Mode | regression | regression | B.2 + B.4 | preserves existing |
| Scheduler panel | regression | B.5 verify | B.5 verify | Realtime topic |
| Brief lifecycle | regression | B.5 verify | B.5 verify | Realtime topic |
| Comments | regression | B.5 verify | B.5 verify | Realtime topic |
| Edge cases (§10) | §10 dedicated | §10 dedicated | §10 dedicated | new coverage |

---

## 10. Edge case test matrix (NEW v1.1)

These cases test the boundary behaviours that v1.0 missed. Each is a Playwright test unless noted.

**TC-8.5b-EDGE-01 — Empty document**
- GIVEN a freshly-created document with only the root node, no children
- WHEN user opens the document
- THEN tree renders with the root node visible
- AND rollup returns zeros (not NULL): `words_drafted = 0, leaf_count = 0`
- AND `<TreeSkeleton>` does NOT remain visible after data resolves (no infinite-skeleton bug)
- Layer: B.1 + B.3

**TC-8.5b-EDGE-02 — Single-node document (only root)**
- GIVEN a document with one node (the root)
- WHEN user opens the document
- THEN tree shows one row; clicking it opens the detail panel
- AND detail panel renders correctly for non-leaf
- Layer: B.2 + B.3

**TC-8.5b-EDGE-03 — Very deep tree (10 layers nested)**
- GIVEN a synthetic document with 10 layers of nesting (one node per layer); `layer_index` from 0 to 9
- WHEN user opens the document
- THEN tree renders all 10 rows correctly indented
- AND rollup correctly identifies the deepest level as leaves
- Layer: B.1

**TC-8.5b-EDGE-04 — Node deleted while detail panel open**
- GIVEN tab A has node X's detail panel open
- WHEN tab B deletes node X
- THEN within 2 s tab A's detail panel handles gracefully:
  - Shows a friendly "This node has been deleted" message (NOT a crash, NOT an indefinite spinner)
  - Tree row for X removed
- AND no JavaScript errors logged in tab A's console
- Layer: B.3 + B.5

**TC-8.5b-EDGE-05 — Network drop mid-mutation; revert UI**
- GIVEN user is editing a beat with optimistic-update enabled
- WHEN user types "X" AND network is killed (DevTools offline mode) AND autosave debounce fires
- THEN the PATCH fails AND optimistic state reverts to pre-X
- AND `<FailureToast>` displays the autosave failure message
- WHEN network is restored
- THEN user can edit again successfully
- Layer: B.3

**TC-8.5b-EDGE-06 — Server returns 500 on tree fetch**
- GIVEN the API mocked to return 500 on `/api/documents/[id]/nodes`
- WHEN user opens the document
- THEN `<QueryErrorFallback>` renders with retry button
- AND tree skeleton is dismissed (no infinite skeleton)
- WHEN user clicks "Retry" AND mock is restored to 200
- THEN tree loads successfully
- Layer: B.3

**TC-8.5b-EDGE-07 — RLS denies access mid-session**
- GIVEN user has a document open AND is removed from the org via service-role mutation
- WHEN user clicks a tree row that triggers `/api/nodes/[id]` fetch
- THEN response is 404 (per existing cross-org test contract)
- AND user sees "This document is no longer available." message
- AND no crash; user can navigate away
- Layer: B.3

**TC-8.5b-EDGE-08 — Concurrent autosaves on same node**
- GIVEN user is rapidly typing in a beat (multiple keystrokes within debounce window)
- WHEN autosaves fire (or are queued)
- THEN exactly one PATCH per debounce window is sent (no parallel duplicates)
- AND optimistic state reflects the latest typed content
- AND on server response, cache reconciles to server state
- Layer: B.3

**TC-8.5b-EDGE-09 — Channel reconnect during in-flight mutation**
- GIVEN user submits a mutation while Realtime channel is reconnecting
- WHEN mutation succeeds and reconnect completes
- THEN cache reflects the mutation
- AND `refetchOnReconnect: 'always'` re-fetches active queries to reconcile
- Layer: B.5

**TC-8.5b-EDGE-10 — `pendingPatches` buffer bound**
- GIVEN cache is cold AND `pendingPatches` buffer is at 999 entries (synthetic load)
- WHEN a 1001st patch arrives
- THEN the oldest patch is evicted (FIFO) AND buffer size stays at 1000
- AND no memory error or crash
- Layer: B.3 unit test

These 10 cases bring total test count to ~110 across the sub-phases.

---

## 11. Per-sub-phase Vercel smoke (recap)

Embedded in each sub-phase section above. Pattern:

1. Vercel auto-deploys master push
2. Within 30 minutes of merge, sign in to `stelavox.vercel.app`
3. Execute the sub-phase's specific smoke steps (per its section above)
4. Log result in Test Report under "Vercel smoke"
5. If smoke fails: open issue; decide fix-forward or revert per Phase 8.5b build checklist §10

---

## Changelog

**v1.1 — 2026-06-08** Audit pass — absorbed C5, C9, C10, M5 findings from 2026-06-08 critical review. **Every test case rewritten in GIVEN/WHEN/THEN format** for precision; vague cases that couldn't be made precise were dropped or replaced. §0.1 precision standard codified. §0.2 fixture data section added enumerating the three fixtures. §0.3 test isolation guarantees. TC-8.5b-B3-21 added for the Realtime-before-fetch ordering buffer per Tier-A §3.4.1. TC-8.5b-B3-12/13 specifics for optimistic revert and reconciliation. TC-8.5b-B5-08 added for `ensureRealtimeAuth` ordering. TC-8.5b-B5-15 added for `<RealtimeBadge>` reconnect UX. TC-8.5b-B6-08 added for husky hook firing. §10 Edge case test matrix added with 10 cases (TC-8.5b-EDGE-01 through -10). §11 per-sub-phase Vercel smoke embedded throughout and recapped. Test count grew from ~85 to ~110 cases. v1.0 substantive structure retained.

**v1.0 — 2026-06-08** Initial draft. Authored as the Tier-B test plan for Phase 8.5b. Six sub-phases B.1-B.6, each with new test cases (~85 cases total), regression set, manual verification checklist, perf-budget assertions, and Test Report PASS criteria. Phase 8.5b overall close-out section §7 captures Tier-A spec sync (TA + CLAUDE.md), consolidated Test Report, and Vercel smoke. Failure modes and rollback policy at §8. Coverage map at §9 cross-references every surface against the test layer protecting it.
