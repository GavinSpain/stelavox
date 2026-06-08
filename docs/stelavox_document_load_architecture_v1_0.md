# Stelavox Document Load Architecture
## Version 1.1
**Date:** 2026-06-08
**Status:** Draft v1.1 — for user review before any code lands

> **v1.1 audit pass.** v1.0 was an architecture sketch; this revision absorbs the C1–C10 + I-tier findings from the 2026-06-08 critical audit. New material: concrete code inventory (§0.2), existing scaffolding pointers (§3.0, §5.0), typed query-key factories (§3.3.1), ordering guarantees for Realtime-before-fetch (§3.4.1), App Router gotchas (§3.6.1), SSR data-source decision (§3.6.2), error handling and failure UX (§3.7), loading-state vocabulary (§3.7.1), observability (§3.8), TypeScript type-contracts (§2.5), correction of the "channel per session" claim to per-tab reality (§5.2), CI mechanism decision (§7.1), pagination revisit thresholds (§11.1). Existing sections retained substantially with reference updates.

---

## 0. Overview

This document defines how Stelavox loads, caches, and updates document tree data. It is the architectural target for **Phase 8.5b — Document Load Architecture**. Once approved, all document-load code is expected to converge on these patterns. Existing code that doesn't fit is treated as technical debt and migrated in the phased work captured in the Phase 8.5b build checklist.

The document is authored after a measurement baseline (Phase 8.5, report at `docs/stelavox_phase8_5_perf_baseline_v1_0.md`) found four concrete defects in the current implementation:

1. `/api/documents/[id]/nodes` returns 2.7 MB of JSON for a 500k-word document — every column on every row including the prose JSONB, even when callers need only ~10 structural fields.
2. The same endpoint is fetched 2× per route change inside a document (server-render + client hydrate).
3. Aggregate rollups (dashboard ProjectCard word count, document header word count) read all rows into TypeScript and sum them — and hit PostgREST's default 1000-row limit, silently under-reporting on any document over ~1000 nodes.
4. Realtime subscriptions are per-resource (5-10 channels per active tab), saturating Supabase Pro's 500-channel cap at ~30-60 concurrent tabs (note: tabs, not users; see §5.2).

These are symptoms of one root cause: **a load-everything implementation pattern that doesn't separate structural data from content and doesn't compute aggregates where the data lives**.

The target architecture in this document fixes all four by adopting industry-standard patterns for hierarchical-content systems: structure/content separation, projected endpoints, client-side cache with Realtime patching, materialised-eligible Postgres-side aggregates, and multiplexed Realtime topology. It is designed for **today's scale (single author per document, ~1500-node novels) while not precluding multi-user scaling to ~10k concurrent users without architectural rewrite**.

**This spec deliberately does not target millions of users.** Patterns that don't preclude that future scale are preferred over patterns that do; specific million-user optimisations (sharding, dedicated Realtime infra, edge-computed rollups) are V2+ and explicitly out of scope here.

### 0.1 Document scope and authority

This document is the **canonical specification** for document-load patterns in Stelavox. When code, comments, or other docs disagree with this, this document wins. Exceptions require:
- An explicit changelog entry in this document recording the exception, OR
- A version bump of this document recording the new pattern

Stelavox's Phase 8.5b ships in six sub-phases (see §10). Each sub-phase's compliance with this spec is verified by its Test Report.

### 0.2 Pre-flight code inventory

Before code starts on Phase 8.5b, an implementer must understand the surface area to be touched. **Both inventories below are static reads done at v1.1 authoring (HEAD `d9752b1`).** They may shift before B.1 starts; re-grep at sub-phase kickoff to confirm.

#### 0.2.1 Consumers of `/api/documents/[id]/nodes`

Eight production code surfaces fetch this endpoint. All eight must be audited during sub-phase B.2 (see build checklist B.2b — Work items).

| # | File | Line(s) | Usage shape | Migration notes |
|---|---|---|---|---|
| 1 | `components/tree/NodeTree.tsx` | 134, 217 | Cold tree fetch + post-write refresh | Largest consumer; migrate to `useDocumentNodes` hook in B.3 |
| 2 | `components/focus/FocusMode.tsx` | 177 | Fetches tree to scope keyboard navigation | Needs structural fields only; migrate first |
| 3 | `components/director/NodePicker.tsx` | 86 | Fetches with `?category=all` for `@`-mention | Currently grabs everything; can use structural |
| 4 | `app/(app)/projects/[projectId]/documents/[documentId]/page.tsx` | (server fetch path) | Server component prefetches via `lib/data/nodes.ts:listNodes()` | Direct DB read, not API; migrate to projected shape in B.4 |
| 5 | `components/project/ProjectSettingsTab.tsx` | (verify location) | Reference exists; audit during B.2 to determine actual usage | May be a doc-comment only; verify |
| 6 | `lib/editor/serialise.ts` | 52 | Doc comment only — references endpoint in JSDoc | No code change |
| 7 | `app/api/projects/[projectId]/context-nodes/route.ts` | (verify) | Internal `listNodes` use, not API call | Audit during B.2 |
| 8 | `app/api/nodes/[nodeId]/route.ts` | (verify) | Internal reference in route doc comment | Audit during B.2 |

**Note on indirection.** Several "consumers" go through `lib/data/nodes.ts:listNodes()` rather than `fetch('/api/...')` directly. The projection plumbing lives in `listNodes()`; the API route is one (high-traffic) caller of `listNodes()` among several. B.2 work touches both the API route and `listNodes()` itself.

Tests and scripts touch the endpoint extensively (`tests/api/nodes.spec.ts`, `tests/boundary/nodes_rls.spec.ts`, `scripts/hardening-drive.ts`, others) — they are NOT migrated; they assert on the API contract and must continue to pass with the projected default. Tests calling `?include=prose` explicitly stay green by virtue of the opt-in.

#### 0.2.2 Realtime subscribers

Eleven production code surfaces open `supabase.channel(...).on('postgres_changes', ...)` calls. All eleven are migrated to the demuxer pattern in sub-phase B.5.

| # | File | Channel name(s) | Tables subscribed | Migration notes |
|---|---|---|---|---|
| 1 | `lib/hooks/useNodesRealtime.ts` | per-document channel | `nodes` | Existing hook; B.3 Realtime patcher absorbs this |
| 2 | `lib/hooks/useNodeRealtime.ts` | per-node channel | `nodes` | Existing hook; B.3 patcher absorbs |
| 3 | `lib/hooks/useAgentJobsRealtime.ts` | per-context channel | `agent_jobs` | Migrate in B.5 |
| 4 | `lib/hooks/useDirectorConversation.ts` (2 channels) | per-conversation × 2 | `director_turns`, `conversation_messages` | Migrate in B.5 |
| 5 | `lib/hooks/useExportJobs.ts` (3 channels) | `export_jobs:active`, `export_jobs:{id}`, `export_jobs:doc:{docId}` | `export_jobs` | Migrate in B.5; three sub-hooks |
| 6 | `components/layout/ModeTabBar.tsx` | inline channel | `conversation_messages`, `briefs` | Migrate in B.5 |
| 7 | `components/layout/AppShellStatusIndicator.tsx` | inline channel | `agent_jobs`, `briefs` | Migrate in B.5 (smallest surface — first consumer) |
| 8 | `components/cost/CostMeterFull.tsx` | inline channel | (one table — verify) | Migrate in B.5 |
| 9 | `components/director/ProjectProfileViewer.tsx` | inline channel | `project_profiles`, `profile_amendments` | Migrate in B.5 |
| 10 | `components/scheduler/SchedulerPanel.tsx` | inline channel | `briefs`, `brief_stages`, `agent_jobs` | Migrate in B.5 (largest surface — verify last) |
| 11 | `lib/supabase/realtime-auth.ts` | (helper, not subscriber) | n/a | Existing scaffolding; absorbed by the demuxer (see §5.0) |

**Net active channel count today.** A user opening dashboard + 1 doc + Director + scheduler has 1 + 5 + 2 + 3 = **11 channels active in that tab**. Per-tab × N-tabs is the actual concurrent-channel load on Supabase. Multi-tab math drives the urgency of B.5.

### 0.3 Decisions locked at v1.1

These decisions land here so the implementation is not blocked on adjudication mid-sub-phase.

| Decision | Choice | Rationale |
|---|---|---|
| Client cache library | **TanStack Query v5+** | Industry standard, ecosystem, devtools |
| Rollup architecture | **On-demand Postgres RPC** | Simpler to ship; promotion path to materialised documented |
| Realtime topology | **Channel per browser tab**, with client-side demuxer (§5.2 — corrected from v1.0's "per user session") | Multi-tab reality of session lifecycle |
| Bundle-size CI mechanism | **Husky pre-push hook** (see §7.1) | No GitHub Actions exists; pre-push is the lightest enforcement available today |
| SSR data source | Server component reads from `lib/data/nodes.ts:listNodes()` directly (NOT internal fetch of own API) (see §3.6.2) | Avoids fetch-self anti-pattern; identical projection logic enforced by sharing `listNodes()` between API and SSR |
| Empty-state error handling | Skeleton on initial fetch, error card on persistent failure, optimistic-rollback toast on mutation failure (see §3.7) | Industry-standard UX vocabulary |

---

## 1. Principles

The five principles below are the durable shape of every decision in this document. When a future change touches document load, the test is: does this respect all five?

### 1.1 Structure-vs-content separation

The tree's **structure** (id, parent_id, order, name, status, lifecycle metadata) and the tree's **content** (prose, summary JSONB, large metadata blobs) have completely different access patterns. Structure is small per row, accessed everywhere, must be fast. Content is large per row, accessed only when a specific node is opened, can tolerate a per-node round-trip.

These are fetched separately, cached separately, and invalidated separately. **Bundling them is the single biggest design mistake we are correcting.**

### 1.2 Lazy by default

The default for any data fetch is to load only what is currently visible and hydrate on demand. Loading data the user might want later, in case they ask for it, is an exception that requires explicit justification — and the justification must include a measurement of the wasted bytes if the user doesn't ask.

### 1.3 Project at the boundary

REST endpoints accept field-selection parameters. Callers declare what they need. The server delivers no more. This applies to:
- `/api/documents/[id]/nodes` (the headline endpoint)
- `/api/nodes/[id]` (already returns full per-node; could project further if a need is identified)
- Future endpoints that return multi-row payloads

Projection happens in SQL (`SELECT` columns), not in TypeScript (`map(omit(...))`). The cost of an unselected column is paid by Postgres, not the wire and not the parser.

### 1.4 Aggregate where the data lives

Sums, counts, max-of, status-distributions — these are *aggregates* and they run in Postgres. The current pattern of fetching all rows and summing in TypeScript is wrong in two ways: it wastes bandwidth and CPU, and it silently corrupts past the 1000-row PostgREST cap.

Aggregates are exposed via Postgres functions (RPCs) that return one row. Future change to a materialised view is an optimisation, not a rewrite.

### 1.5 Updates are diffs, not refetches

When data changes, the change is propagated as a patch. Supabase Realtime sends the new row payload on every UPDATE — that *is* the diff. The client applies it to its in-memory cache. Refetching the whole tree because one row changed is wrong.

---

## 2. Endpoint contracts

### 2.1 `GET /api/documents/[id]/nodes` (revised)

**Default response.** Structural columns only.

```json
{
  "rows": [
    {
      "id": "uuid",
      "parent_id": "uuid|null",
      "order": 0,
      "node_category": "structural",
      "node_type": "beat",
      "layer_index": 4,
      "name": "Beat 1.1",
      "status": "draft",
      "word_count_actual": 400,
      "word_count_target": 400,
      "updated_at": "2026-06-07T13:24:01Z",
      "created_at": "2026-06-07T13:24:01Z",
      "is_leaf": true,
      "depth": 5
    },
    ...
  ]
}
```

Excluded by default: `prose`, `summary`, `metadata`, `notes`, `short_description`, lock fields, scope, layer-stack denormalisations, anything not in the list above.

Projection delivered via `SELECT` in the route handler — *not* via TypeScript `map`. Postgres skips the JSONB read for `prose` and `summary` entirely; server-side cost drops dramatically (measured baseline: 2 seconds → projected 200-400 ms).

**Size at mega-doc scale.** 1556 rows × ~250 bytes structural = ~390 KB raw, ~80 KB gzipped. **~85% reduction** vs the current 2.7 MB.

**Opt-in via query string.** Callers that need more declare it:

| Query param | Adds field |
|---|---|
| `?include=summary` | `summary` (Tiptap JSONB; ~1 KB/row typical) |
| `?include=prose` | `prose` (Tiptap JSONB; can be large) |
| `?include=metadata` | `metadata` (JSONB) |
| `?include=notes` | `notes` (Tiptap JSONB) |
| `?include=summary,prose` | both |
| `?include=*` | all fields (preserved as B.2b-compatible escape hatch) |

Combinations are comma-separated. Order doesn't matter. Unknown values produce a 400; the route validates against an allow-list.

**No new endpoint variants.** The existing endpoint absorbs the new contract. Callers that need specific subsets pass `?include=...`; the default is the slim shape.

**Server response order remains depth-first** per existing API Contract §3.2 / TC-A-26. No change to row ordering.

**Authentication, RLS, validation, error contracts** — unchanged.

### 2.2 `GET /api/nodes/[id]` — clarified

Already exists. Returns the full single-node record including `prose`, `summary`, `metadata`, `notes`. Used for per-node hydration when the user opens a tree row.

**No change to this endpoint's contract** in this phase. It is the canonical "fetch one node's full state" surface. Documented here so the reader understands the boundary: `/api/documents/[id]/nodes` is structural; `/api/nodes/[id]` is contentful.

### 2.3 `GET /api/documents/[id]/rollup` (NEW)

Returns one row of aggregates computed in Postgres.

```json
{
  "document_id": "uuid",
  "words_drafted": 500006,
  "words_target": 500000,
  "node_count": 1556,
  "leaf_count": 1250,
  "status_counts": {
    "draft": 1556,
    "in_progress": 0,
    "approved": 0
  },
  "last_updated_at": "2026-06-07T13:24:01Z"
}
```

Backed by Postgres RPC `get_document_rollup(p_document_id UUID)` (see §4.1). On mega-doc scale: ~10 ms server side, ~1 KB response.

**Used by:** document page header word-count display, eventually any document-level metric surface.

### 2.4 `GET /api/projects/[id]/rollup` (NEW)

Same shape as document rollup but project-scoped, summing across all documents in the project.

```json
{
  "project_id": "uuid",
  "document_count": 1,
  "words_drafted": 500006,
  "words_target": 500000,
  "node_count": 1556,
  "leaf_count": 1250,
  "last_updated_at": "2026-06-07T13:24:01Z"
}
```

Backed by `get_project_rollup(p_project_id UUID)`.

**Used by:** dashboard ProjectCard. **Replaces** the broken TypeScript-side sum in `lib/dashboard/projectAggregates.ts`.

### 2.5 TypeScript type contracts

All API response types live in `lib/types/api.ts` (NEW file in B.1). Endpoints and consumers import from the same file. No ad-hoc shapes.

Canonical types:

```ts
// lib/types/api.ts

export interface StructuralNodeRow {
  id: string
  parent_id: string | null
  order: number
  node_category: 'structural'
  node_type: string
  layer_index: number
  name: string
  status: NodeStatus
  word_count_actual: number | null
  word_count_target: number | null
  updated_at: string
  created_at: string
  is_leaf: boolean
  depth: number
}

export type NodeIncludeField = 'summary' | 'prose' | 'metadata' | 'notes'

export interface FullNodeRow extends StructuralNodeRow {
  summary?: TiptapDoc | null
  prose?: TiptapDoc | null
  notes?: TiptapDoc | null
  metadata?: Record<string, unknown> | null
}

export interface DocumentRollup {
  document_id: string
  words_drafted: number
  words_target: number
  node_count: number
  leaf_count: number
  status_counts: Record<NodeStatus, number>
  last_updated_at: string | null
}

export interface ProjectRollup {
  project_id: string
  document_count: number
  words_drafted: number
  words_target: number
  node_count: number
  leaf_count: number
  last_updated_at: string | null
}
```

The structural-columns const drives both projection logic and the response type:

```ts
// lib/types/api.ts
export const STRUCTURAL_COLUMNS = [
  'id', 'parent_id', 'order', 'node_category', 'node_type',
  'layer_index', 'name', 'status', 'word_count_actual',
  'word_count_target', 'updated_at', 'created_at',
] as const
// `is_leaf` and `depth` are derived (server-computed); included in StructuralNodeRow but not in this list
```

Any mismatch between projection list and TypeScript type fails type-check.

---

## 3. Client cache layer

### 3.0 Existing scaffolding

Before adding TanStack Query, an implementer must read these existing surfaces:

- **`lib/supabase/realtime-auth.ts`** — `ensureRealtimeAuth(supabase)` helper. Resolves an anon-race documented at 2026-06-07. **Every channel subscription must await this helper before `.subscribe()`.** B.5 demuxer absorbs the helper but does not bypass it.
- **`lib/hooks/useNodesRealtime.ts`** — existing per-document Realtime → state hook. B.3 Realtime-patcher is a generalisation of this hook against the cache, not a parallel reinvention.
- **`lib/hooks/useNodeRealtime.ts`** — existing per-node Realtime hook. Same comment.
- **`lib/hooks/useAgentJobsRealtime.ts`** + **`useDirectorConversation.ts`** + **`useExportJobs.ts`** — existing per-resource Realtime hooks. B.5 collapses them into demuxer subscribers.
- **`feedback_intermittent_problem_methodology.md`** memory — the diagnosis history that birthed `realtime-auth.ts`. B.5 documentation must reference this so future readers understand the auth-race risk.

### 3.1 Library choice

**TanStack Query (React Query) v5+.** Industry standard for server-state caching in React. First-class Next.js App Router support; SSR hydration via `dehydrate` / `hydrate`. Devtools integration is well-supported.

Decision locked at session 2026-06-08 (Tier-A §0.3).

### 3.2 Provider mounting

Provider mounts at `app/(app)/layout.tsx`. **One `QueryClient` per request server-side, never a module-level singleton** (would leak state across users — see §3.6.1). **One persistent `QueryClient` per browser session client-side.** Default options:

```ts
{
  queries: {
    staleTime: 60_000,          // 60 s; Realtime invalidates explicitly
    gcTime: 5 * 60_000,         // 5 min after unmount
    refetchOnWindowFocus: false, // Realtime handles freshness
    refetchOnReconnect: 'always', // catch up after a network drop
    retry: 1,                    // single retry on transient errors; see §3.7
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 30_000),
  },
  mutations: {
    retry: 0,                    // mutations don't auto-retry — UI surface errors
  },
}
```

`refetchOnWindowFocus: false` is important — we have Realtime; we don't want React Query racing it.

### 3.3 Cache key convention

The convention is `['domain', id, 'subkey?']`. Concretely:

| Key | Returns | Invalidation source |
|---|---|---|
| `['document', docId, 'nodes']` | Structural tree from `/api/documents/[id]/nodes` | Realtime `nodes` change for this document |
| `['document', docId, 'rollup']` | Document rollup from `/api/documents/[id]/rollup` | Realtime `nodes` change for this document |
| `['node', nodeId]` | Single node from `/api/nodes/[id]` | Realtime UPDATE on this node |
| `['project', projectId, 'rollup']` | Project rollup | Realtime any-doc change in this project |
| `['user', 'attention']` | Pending-attention bundle | Realtime agent_jobs / briefs |

`useQuery` hooks are co-located with the data they fetch under `lib/queries/`. One hook per cache key.

### 3.3.1 Typed query-key factories

To prevent silent cache-key drift, all keys go through typed factories:

```ts
// lib/queries/keys.ts
export const documentKeys = {
  all: () => ['document'] as const,
  nodes: (docId: string) => ['document', docId, 'nodes'] as const,
  rollup: (docId: string) => ['document', docId, 'rollup'] as const,
} as const

export const nodeKeys = {
  all: () => ['node'] as const,
  single: (id: string) => ['node', id] as const,
} as const

export const projectKeys = {
  all: () => ['project'] as const,
  rollup: (projectId: string) => ['project', projectId, 'rollup'] as const,
} as const

export const userKeys = {
  attention: () => ['user', 'attention'] as const,
} as const
```

Rule: **no inline cache key literals.** Every `useQuery`, `setQueryData`, `invalidateQueries`, and `getQueryData` call goes through the factory. Lint can catch violations (a future `no-restricted-syntax` rule against `queryKey:` with string-literal first elements).

The `as const` on each factory yields typed-tuple keys; TanStack Query then infers the type of cached data per key.

### 3.4 Realtime → cache patching

When a Realtime `postgres_changes` event arrives, the listener patches the cache directly:

```ts
function onNodeUpdate(newRow: FullNodeRow) {
  queryClient.setQueryData(
    documentKeys.nodes(newRow.document_id),
    (prev: StructuralNodeRow[] | undefined) =>
      prev?.map(r => r.id === newRow.id ? structuralFieldsOf(newRow) : r),
  )
  queryClient.setQueryData(nodeKeys.single(newRow.id), newRow)
  // For aggregate-touching changes (status, word_count_actual), invalidate the rollup
  if (rowAffectsAggregate(newRow)) {
    queryClient.invalidateQueries({ queryKey: documentKeys.rollup(newRow.document_id) })
  }
}
```

The pattern:
- Direct cache mutation for the cheap cases (single-row patch)
- `invalidateQueries` for the cases where the patch can't be computed client-side (rollups)

**No `router.refresh()`** for data updates. `router.refresh()` is reserved for navigation events that fundamentally change page identity (URL changes that cross route segments).

### 3.4.1 Ordering guarantees

A Realtime event can arrive **before** the initial fetch completes — the page just opened; cold cache; event in flight; fetch in flight. Without explicit ordering, the cache ends in an undefined state (event applies to empty cache; then fetch result overwrites it; event is lost).

**Pattern.** The Realtime patcher checks whether the relevant query has data:

```ts
function onNodeUpdate(newRow: FullNodeRow) {
  const key = documentKeys.nodes(newRow.document_id)
  const current = queryClient.getQueryData<StructuralNodeRow[]>(key)
  if (current === undefined) {
    // Cache cold — buffer the patch until first fetch lands
    pendingPatches.push({ key, row: newRow })
    return
  }
  queryClient.setQueryData(key, (prev) => mergeRow(prev, newRow))
}
```

When a query first lands (via `onSuccess` or via the `select` callback), the patcher flushes any pending patches for that key:

```ts
function flushPending(key: QueryKey) {
  const patches = pendingPatches.filter(p => keysEqual(p.key, key))
  for (const patch of patches) {
    queryClient.setQueryData(key, (prev) => mergeRow(prev, patch.row))
  }
  pendingPatches = pendingPatches.filter(p => !keysEqual(p.key, key))
}
```

**Test:** TC-8.5b-B3-21 (added in test plan §3) verifies that an event-then-fetch sequence ends with both applied; that a fetch-then-event sequence also ends with both applied; and that the buffer is bounded (drops oldest if it grows beyond 1000).

**Bound.** `pendingPatches` is capped at 1000 entries to prevent runaway memory. Realistic burst sizes are < 10.

### 3.5 Optimistic updates

Mutation hooks use TanStack's optimistic-update pattern:

```ts
const mutation = useMutation({
  mutationFn: patchNode,
  onMutate: async (newData) => {
    await queryClient.cancelQueries({ queryKey: nodeKeys.single(newData.id) })
    const previous = queryClient.getQueryData(nodeKeys.single(newData.id))
    queryClient.setQueryData(nodeKeys.single(newData.id), { ...previous, ...newData })
    return { previous }
  },
  onError: (err, newData, ctx) => {
    queryClient.setQueryData(nodeKeys.single(newData.id), ctx?.previous)
    // Surface error to user — see §3.7
    showToast({ kind: 'error', message: 'Autosave failed. Your changes are still in the editor.' })
  },
  onSettled: (data) => {
    if (data) queryClient.setQueryData(nodeKeys.single(data.id), data)
  },
})
```

Autosave PATCH is the highest-traffic mutation; it's also the most user-visible. Optimistic updates make typing feel tighter.

**Reconciliation on Realtime reconnect.** TanStack's `refetchOnReconnect: 'always'` (see §3.2) handles the case where the channel dropped mid-mutation; on reconnect the cache re-fetches and any server-side state the local cache missed is reconciled.

### 3.6 SSR hydration

Server components fetch initial state and inject a dehydrated cache into the page:

```tsx
// app/(app)/projects/[p]/documents/[d]/page.tsx (sketch)
import { dehydrate, HydrationBoundary, QueryClient } from '@tanstack/react-query'
import { listNodes } from '@/lib/data/nodes'
import { documentKeys } from '@/lib/queries/keys'

export default async function DocumentPage({ params }: ...) {
  const queryClient = new QueryClient()
  const { documentId } = await params
  await queryClient.prefetchQuery({
    queryKey: documentKeys.nodes(documentId),
    queryFn: () => listNodes({ documentId, projection: 'structural' }),
  })

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <DocumentClient documentId={documentId} />
    </HydrationBoundary>
  )
}
```

Result: client-side tree component reads from cache on first paint. Zero round-trip on cold open beyond the HTML payload (which carries the dehydrated cache state).

This eliminates the duplicate fetch observed in the Phase 8.5 baseline.

### 3.6.1 App Router gotchas

TanStack Query + Next.js App Router has known sharp edges. Implementer must:

1. **Never create a module-level singleton `QueryClient` on the server.** Each request creates its own. Pattern:
   ```ts
   // app/(app)/QueryProvider.tsx (CLIENT)
   'use client'
   const [client] = useState(() => new QueryClient(defaults))
   ```
   ```ts
   // app/(app)/projects/[p]/documents/[d]/page.tsx (SERVER)
   const queryClient = new QueryClient(defaults)  // per-request
   ```

2. **Server-side `prefetchQuery` callbacks cannot call `cookies()` lazily.** The Supabase client is created inside `listNodes()` (which calls `await cookies()` via `lib/supabase/server.ts`); that's fine because the call is awaited inside the `queryFn`. Don't try to invoke `cookies()` outside the await chain.

3. **`staleTime` on dehydrated state.** When the server prefetches and dehydrates, the client receives the cached data. With `staleTime: 0` (TanStack default) the client immediately refetches on mount — defeating the SSR optimisation. Our `staleTime: 60_000` (§3.2) prevents this. **Verify in B.4 tests that no client refetch happens within 60 s of SSR landing.**

4. **No streaming SSR for tree fetch in V1.** The `@tanstack/react-query-next-experimental` package supports streaming dehydration; we don't use it. Document page renders fully on the server with the tree data inlined; sub-trees that load later (Director conversation) can stream independently in a future revision.

5. **Server components and client components share the `QueryClient` per request via the `HydrationBoundary`.** Don't try to pass the server-side QueryClient instance through props to a client component — won't work; dehydrate/hydrate via the boundary is the only supported path.

### 3.6.2 SSR data source

**Server components fetch from `lib/data/nodes.ts:listNodes()` directly. They do not internally call `fetch('/api/documents/[id]/nodes')`.**

Reasons:
- Calling own API via `fetch` on the server is the well-known Next.js fetch-self anti-pattern (adds round-trip latency, complicates auth, doesn't share connection pooling)
- `listNodes()` already encapsulates the projection logic and is shared with the API route handler
- Single source of truth for "fetch the structural columns of a document's nodes"

The API route's job becomes: thin wrapper that parses `?include=...`, validates, calls `listNodes({ documentId, projection })`, returns the result. **No business logic in the route handler.**

### 3.7 Error handling and failure UX

The architecture has three failure surfaces. Each has a defined response.

**Query failure** (e.g. `/api/documents/[id]/nodes` returns 500 or times out).
- TanStack retries once (per §3.2 `retry: 1`); if both fail, the query enters error state.
- The consumer (e.g. `NodeTree`) renders a **`<QueryErrorFallback>`** component that displays a card with: error message, "Retry" button (calls `queryClient.invalidateQueries`), "Report" button (no-op in V1; placeholder).
- `<QueryErrorFallback>` lives in `components/feedback/QueryErrorFallback.tsx` (NEW in B.3).
- Existing failure tokens (`--color-error`) drive the visual.
- No silent failure. Empty data never substitutes for failed data.

**Mutation failure** (e.g. autosave PATCH rejected, or network down).
- TanStack mutation `onError` runs — see §3.5 example
- Optimistic cache state reverts to pre-mutation
- `<FailureToast>` (existing, V1.x-F shipped) surfaces with the error message
- User can re-attempt by editing again (autosave debounce will re-trigger)

**Realtime channel failure** (e.g. channel disconnects, reconnect fails).
- `useUserChannel` (B.5) handles reconnection with exponential backoff
- During disconnect, `<RealtimeBadge>` component (NEW in B.5) shows in app header: "Reconnecting…" with `--color-status-review` token
- On successful reconnect, badge fades; in-flight queries refetch via `refetchOnReconnect: 'always'`
- If reconnect fails persistently (3 attempts), badge becomes "Disconnected" with `--color-error`; user sees data may be stale; manual refresh required

**Authorization failure** (RLS denies access mid-session).
- `/api/documents/[id]/nodes` returns 404 (the cross-org case per existing test contract)
- TanStack query enters error state
- `<QueryErrorFallback>` displays: "This document is no longer available."
- No redirect — user remains on the page; can navigate away

### 3.7.1 Loading state vocabulary

Three loading vocabularies, picked by expected duration:

| Expected duration | Treatment | Surface |
|---|---|---|
| < 200 ms | Nothing (data appears) | Autosave PATCH, optimistic updates |
| 200 ms – 2 s | Skeleton screen | Tree initial fetch, detail panel hydration |
| > 2 s OR unknown | Spinner + "Loading…" copy | Director conversation initial load, export render |

**Skeleton components** live in `components/feedback/skeletons/` (NEW in B.3). One per shape:
- `<TreeSkeleton />` — N greyed rows in a list
- `<DetailPanelSkeleton />` — header strip + content placeholder

**Spinner** is the existing `<ProgressBar>` from `components/feedback/`.

Rule: no surface flashes "Loading…" for less than 200 ms. Defer the indicator with `setTimeout(showSpinner, 200)` if needed.

### 3.8 Observability

Phase 8.5b adds instrumentation so we can answer "is the cache working in production?" without guessing.

**Metrics emitted to console.debug in dev; to a sample-rate-limited POST `/api/metrics/client` in production** (NEW endpoint in B.3; lands in `metrics_minute_buckets` table — existing V1.x-B.2 substrate).

| Metric | When |
|---|---|
| `cache.hit` / `cache.miss` | Every `useQuery` resolves; `dataUpdatedAt` vs `fetchedAt` |
| `query.duration_ms` | Every successful query |
| `query.failure` | Every error |
| `mutation.duration_ms` | Every mutation result |
| `mutation.failure` | Every mutation error |
| `realtime.event` | Every Realtime payload received |
| `realtime.reconnect` | Every channel reconnect cycle |
| `realtime.drop` | Channel disconnect detected |

Surfacing: V1.x-E admin dashboard gains a "Document Load" panel (out of scope for Phase 8.5b; add to V1.x-E backlog).

Sample rate: 5% in production (random sampling) to keep metrics cost bounded.

---

## 4. Rollup architecture

### 4.1 RPC contracts

Two SECURITY DEFINER RPCs land in a single migration:

**`get_document_rollup(p_document_id UUID)`** returns one row with the document's aggregates. Filters rows by `document_id`, computes `is_leaf` via the document's layer stack max-layer-index, sums leaf `word_count_actual` and `word_count_target`, counts nodes and leaves, builds `status_counts` via `jsonb_object_agg`, takes `max(updated_at)`.

**`get_project_rollup(p_project_id UUID)`** wraps `get_document_rollup` across all documents in the project, summing the results.

Both functions are `STABLE` (deterministic for a given snapshot), `SECURITY DEFINER`, with `SET search_path = public` per H-13. RLS interaction:

- RPCs are called via `supabase.rpc(...)`; the call inherits the caller's auth context
- Inside the RPC body, queries against `nodes` apply RLS as configured
- Service-role callers bypass RLS via standard Supabase service-role behaviour
- **Empty result (RLS-filtered to nothing) returns zero-valued aggregates, not NULL** — caller doesn't have to coalesce

Detailed SQL bodies live in the Phase 8.5b build checklist B.1 section. The contract here is the function signatures and return shapes.

### 4.2 On-demand RPC vs materialised view

V1.0 of this spec specifies **on-demand RPC** for both rollups. Reasoning:

- Simpler to ship and to reason about; one source of truth (the live `nodes` table)
- Postgres aggregate over 1500-15000 rows is sub-50 ms uncached; sub-5 ms with the right index
- No trigger maintenance, no eventual-consistency window, no refresh-coordination logic
- Rollups are not on hot critical paths once cached (TanStack Query holds them client-side for the session)

A migration path to a materialised `document_rollups` table is documented at §4.3 below. **Promotion is gated on measurement**: only if production telemetry shows RPC time crossing 50 ms p95 at scale.

### 4.3 Future migration: materialised rollups

If/when promotion becomes warranted:

1. Add `document_rollups` table with the columns from §2.3
2. Trigger on `nodes` INSERT/UPDATE/DELETE recomputes and upserts the affected document's row
3. RPC `get_document_rollup` switches to read from the table; if the row is missing, falls back to the SQL aggregate and inserts (warm-up)
4. Same pattern for project rollups

This is a non-trivial migration in its own right. Documented here so the V1 RPC isn't a dead end.

### 4.4 Indexing

For the on-demand RPC to be fast we need:

- `nodes(document_id, node_category)` — index already exists per existing migrations
- `nodes(document_id, layer_index)` — needed for the max-layer-index lookup; may already exist
- `nodes(project_id, node_category)` — needed for project rollup

Index audit happens as a migration in B.1. Index creation is `CREATE INDEX IF NOT EXISTS` so it's idempotent.

---

## 5. Realtime topology

### 5.0 Existing scaffolding

`lib/supabase/realtime-auth.ts` ships an `ensureRealtimeAuth(supabase)` helper. The helper resolves the auth-race that previously caused channels to register as anon and silently drop RLS-protected events.

**Usage pattern (from the helper's JSDoc):**

```ts
useEffect(() => {
  if (!someId) return
  const supabase = createClient()
  let channel: ReturnType<typeof supabase.channel> | null = null
  let mounted = true

  void (async () => {
    await ensureRealtimeAuth(supabase)
    if (!mounted) return
    channel = supabase.channel('...').on(...).subscribe()
  })()

  return () => {
    mounted = false
    if (channel) void supabase.removeChannel(channel)
  }
}, [someId])
```

**B.5 substrate (`useUserChannel`) absorbs this pattern.** It does NOT bypass `ensureRealtimeAuth`; it calls it once on channel creation. The existing 11 consumers that copy/paste the pattern today (per §0.2.2 inventory) cease to call the helper directly — the substrate calls it for them.

Closes the "shared waitForAuthThenSubscribe helper across 4 hooks" follow-up from the 2026-06-07 intermittent-bug session.

### 5.1 Current state

Each component subscribes its own Realtime channel; total active channels per tab can reach 10+ on a fully-engaged session (per §0.2.2). Supabase Pro caps at 500 total → saturates at **30-60 concurrent tabs**, not "users" (see §5.2).

### 5.2 Target: channel-per-tab with topic demux

**One persistent Supabase Realtime channel per browser tab**, named `user:{userId}` (where userId comes from the authenticated session). The channel subscribes to a curated set of `postgres_changes` filters that cover everything that tab might care about. A client-side demuxer fans out events to registered listeners by topic.

**Correction from v1.0.** v1.0 called this "per user session" but a "session" in Supabase Auth terms is per-tab. A user with 5 tabs has 5 channels under v1.1's design. Cross-tab coordination (using BroadcastChannel API to fan one channel out across tabs) is a V2 optimisation — see §11 out-of-scope list.

Sketch:

```ts
// lib/realtime/useUserChannel.ts (conceptual)
export function useUserChannel() {
  // singleton per tab; mounted at app root
  const supabase = useMemo(() => createClient(), [])
  const channelRef = useRef<RealtimeChannel | null>(null)
  const userId = useUserId()
  const orgId = useOrgId()

  useEffect(() => {
    if (!userId) return
    let mounted = true
    let channel: RealtimeChannel | null = null

    void (async () => {
      await ensureRealtimeAuth(supabase)  // from lib/supabase/realtime-auth.ts
      if (!mounted) return
      channel = supabase.channel(`user:${userId}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'nodes', filter: `organisation_id=eq.${orgId}` },
            (p) => demux.dispatch('nodes', p))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'agent_jobs', filter: `triggered_by=eq.${userId}` },
            (p) => demux.dispatch('agent_jobs', p))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'briefs', filter: `organisation_id=eq.${orgId}` },
            (p) => demux.dispatch('briefs', p))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'brief_stages' /* no org filter — joined */ },
            (p) => demux.dispatch('brief_stages', p))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'conversation_messages' /* joined */ },
            (p) => demux.dispatch('conversation_messages', p))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'director_turns' /* joined */ },
            (p) => demux.dispatch('director_turns', p))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'export_jobs', filter: `organisation_id=eq.${orgId}` },
            (p) => demux.dispatch('export_jobs', p))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'project_profiles', filter: `organisation_id=eq.${orgId}` },
            (p) => demux.dispatch('project_profiles', p))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'profile_amendments' /* joined */ },
            (p) => demux.dispatch('profile_amendments', p))
        .subscribe()
      channelRef.current = channel
    })()

    return () => {
      mounted = false
      if (channel) void supabase.removeChannel(channel)
      channelRef.current = null
    }
  }, [userId, orgId, supabase])
}

// Components subscribe to topics via the demuxer
export function useRealtimeTopic<T>(topic: string, onEvent: (payload: T) => void, filter?: (row: T) => boolean) {
  // registers a listener with the demuxer; auto-cleanup on unmount
}
```

**Filter count: 9 distinct topics**, each one a `.on('postgres_changes', ...)` call on the single channel. Within the spec's documented limit (≤ 10 per channel — see §5.3).

**Channel reduction:** 10+ → 1 per tab. At average 1.5 tabs/user → 1.5 channels/user. Supabase Pro 500-cap fits ~330 concurrent users.

### 5.3 Filter strategy

Postgres-changes filters on the channel are at the organisation/user level — broad enough to catch everything for that user, narrow enough that we don't waste bandwidth on other orgs' data. The client-side demuxer applies per-component filters (e.g., "only events for this `documentId`").

The tradeoff: server delivers more events to the client than any one component cares about; client filters down. This is acceptable at the per-user scale (one user's org generates modest event volume). It would not be acceptable at "tenant Realtime" scale, which is V2+ if it ever arises.

**Soft cap: 12 topic filters per channel** (raised from 10 on 2026-06-08; see changelog). Adding a 13th must be justified in the spec changelog with rationale.

**2026-06-08 — cap raised 10 → 12.** B.5b added `organisations` (10th topic). B.5c added `workflows` + `workflow_steps` (11th + 12th) so `useDirectorConversation` runs off the user channel rather than its own pair of standalone channels. Both topics are core Director functionality: the `workflows` row INSERT happens when the user approves a Plan, and no other already-multiplexed topic fires at that moment (`agent_jobs` rows are inserted asynchronously by the dispatcher; `conversation_messages` is the Director's assistant turn that proposed the plan, not the user's approval). Without `workflows` in REALTIME_TOPICS, the PlanCard would lag behind the user's Approve click. Marginal server cost of two extra `.on()` handlers on a per-tab channel is negligible compared with the elimination of two standalone channels. Soft cap is advisory; the spec-changelog gate is the mechanism that forces this conversation when adding topics. Further additions still require a changelog entry.

### 5.4 Channel-per-document considered and rejected

The simpler refactor — channel per opened document — yields ~3-5× reduction. Channel-per-user yields ~10×. The bigger consolidation is worth the design cost.

Channel-per-user has one specific complication: cross-document data (briefs, agent_jobs, scheduler events) needs to live on the user channel even when no document is open. That's fine — the user channel exists for the session regardless.

### 5.5 Reconnection and resilience

Substrate hook handles reconnection with the same logic existing code uses today (Phase 8.5 mid-session investigation hardened this in some places). All resilience logic centralises in `useUserChannel`; per-component subscribers see a stable interface.

**Reconnect cascade:**
1. Channel detects disconnect (`@SUPABASE_REALTIME_DISCONNECT` event or socket close)
2. `useUserChannel` sets internal state `disconnected = true`; `<RealtimeBadge>` shows
3. Auto-reconnect attempts with exponential backoff (1 s → 2 s → 4 s → 8 s → 30 s max)
4. On reconnect: `ensureRealtimeAuth` re-runs; channel resubscribes; `<RealtimeBadge>` clears
5. After reconnect, TanStack `refetchOnReconnect: 'always'` re-fetches all active queries

### 5.6 Backwards compatibility during migration

The migration in sub-phase B.5 lands the substrate *first*, then consumers migrate one at a time. Each consumer migration is its own commit. Old per-channel code paths stay in place until their consumer is migrated. The final commit of B.5 deletes the old helpers when no consumer remains.

---

## 6. RSC initial-seed pattern

Server components for routes that load document data prefetch into a per-request `QueryClient`, dehydrate, and render the client tree inside a `HydrationBoundary`. Pattern shown at §3.6.

**The prefetched query function uses `listNodes()` from `lib/data/nodes.ts` directly** (not an internal fetch to own API — see §3.6.2).

Surfaces that benefit:
- `/projects/[p]/documents/[d]` — dehydrate `documentKeys.nodes(docId)` and `documentKeys.rollup(docId)` (priority — lands in B.4)
- `/projects/[p]/documents/[d]/scheduler` — dehydrate scheduler data (defer to B.4 or later)
- `/admin` — dehydrate admin dashboard query (defer)
- `/dashboard` — dehydrate `projectKeys.rollup(projectId)` for each card (defer or batch)

Only the document page prefetch is scoped into B.4; the rest are explicit candidates for future revisits.

---

## 7. Bundle discipline

The Phase 8.5 baseline identified:
- 264 KB gzipped chunk = Tiptap + ProseMirror. Loaded once per session per release. Unavoidable on document mode; ensure not loaded on dashboard / settings.
- 41 KB gzipped chunk = `docx + epub`. Server-only libraries; client leak.
- ~30 KB chunk for cmdk + dialog primitives.
- Various smaller chunks.

Discipline:

- **Dynamic imports for route-conditional UI.** Director panel, Focus Mode, Scheduler view, Export modal — all `next/dynamic`. Cuts dashboard/settings bundle.
- **No server-only libraries in client bundles.** Audit imports of `docx`, `epub-gen-memory`, `@anthropic-ai/sdk` to confirm they're only reached from server modules. The `serverExternalPackages` config helps; verify it's covering everything.
- **Lucide icon imports.** Use named imports (`import { Foo } from 'lucide-react'`) not namespace imports (`import * as Icons from 'lucide-react'`). Audit and fix.
- **Per-route First Load JS budget.** Document page ≤ 350 KB gzipped; dashboard ≤ 200 KB gzipped. Enforcement per §7.1.

### 7.1 Bundle-size enforcement (CI decision)

**Choice locked at v1.1: Husky pre-push hook.** Rationale: Stelavox has no GitHub Actions / CircleCI / other CI pipeline today; adding one is a separate body of work; pre-push hook is the lightest enforcement that fires before code leaves the developer's machine.

Implementation in B.6:
- `npm install --save-dev husky @next/bundle-analyzer`
- `npx husky init` (one-time setup; commits the `.husky/` directory)
- `.husky/pre-push` runs `npm run check-bundle-budget`
- `npm run check-bundle-budget` = a Node script (`scripts/check-bundle-budget.ts`) that:
  - Runs `next build`
  - Reads `.next/build-manifest.json` (or analyzer JSON output)
  - Compares each route's First Load JS against budget
  - Exits non-zero on regression with a clear error message

Bypass for emergency push: `git push --no-verify` (developer responsibility; surfaces in code review).

Migrating to GitHub Actions is a future option (V2). Not in 8.5b scope.

---

## 8. Performance budgets

The Phase 8.5 baseline proposed these. They become contractual in this spec.

| Surface | Budget (production) | Source of truth |
|---|---|---|
| Initial JS payload (document route) | < 350 KB gzipped | Pre-push hook bundle assertion |
| Initial JS payload (dashboard route) | < 200 KB gzipped | Pre-push hook bundle assertion |
| `/api/documents/[id]/nodes` response (1500-node doc, default) | < 100 KB gzipped | Playwright perf assertion (mega-doc fixture) |
| `/api/documents/[id]/nodes` server time | < 500 ms p50 | Playwright timing (mega-doc fixture) |
| `/api/nodes/[id]` server time | < 200 ms p50 | Playwright timing (production-build mode) |
| Cold doc-open client-visible total | < 2 s p50 | Playwright timer in production-build mode |
| In-document navigation (tree row click) | < 300 ms p50 | Playwright timer |
| Autosave PATCH round-trip | < 1 s p50 | Existing test |
| Realtime channels per browser tab | ≤ 2 | Manual measurement; Playwright instrumentation in B.5 |

**Note on local vs production.** All budgets in this table apply to **production-build mode** (`npm run build && npm run start`), not Next.js dev mode. Dev mode incurs Turbopack compile-on-demand cost that's irrelevant to user perf. Tests assertions explicitly run against production builds.

Numbers are aspirational targets for end of Phase 8.5b. Current numbers vs targets land in the Phase 8.5b test report (per Phase 8.5 baseline `docs/stelavox_phase8_5_perf_baseline_v1_0.md` §2).

---

## 9. Hazards

New hazards introduced by this architecture:

### H-29 — Stale cache after Realtime miss

If a Realtime event is dropped (network blip), the client cache diverges from the server. **Mitigation:** `refetchOnReconnect: 'always'` catches up after network drops; user-driven refresh via the Realtime substrate's reconnection logic. **Status:** designed-in; tests cover.

### H-30 — RSC dehydration race with client mutation

If a server component starts a slow query, the user navigates, the client mounts and starts mutating, then the slow server response lands — the dehydrated state could overwrite client mutations. **Mitigation:** server-component queries are fast (RPCs and projected reads); `setQueryData` from the dehydrated boundary respects existing query data per TanStack's defaults; explicit `staleTime: 60_000` in the boundary prevents overwrite when the client has fresher state. **Status:** documented; verified by test in B.4.

### H-31 — Aggregate drift between cache and rollup

The client may have a tree cache reflecting recent writes that haven't propagated to the rollup query (if the rollup uses on-demand aggregation, it's always live; if promoted to materialised, the materialised table may lag by a trigger cycle). **Mitigation:** on-demand RPC is live; materialised promotion (if ever) includes a trigger-based incremental update that runs synchronously with the write transaction. **Status:** designed-out for V1 by the on-demand choice.

### H-32 — Channel-per-tab filter explosion

The `user:{userId}` channel subscribes to multiple postgres-changes filters. If the filter list grows unboundedly, channel setup time and Supabase load grow. **Mitigation:** keep filter count ≤ 10 per channel; bundle related tables into wider filters where possible; document the filter list in the substrate. Soft cap and rule documented at §5.3. **Status:** monitored; design constraint.

### H-33 — Realtime event arrives before initial fetch

Cold cache + Realtime event in flight: `setQueryData` on an empty cache + subsequent fetch overwrite → patch lost. **Mitigation:** ordering buffer per §3.4.1 with bounded size (1000 patches); test TC-8.5b-B3-21 verifies. **Status:** designed-in.

### H-34 — Cross-tab Realtime channel multiplication

A user opens 5 tabs → 5 `user:{userId}` channels → 5× channel cost. Supabase Pro 500-cap fires earlier than the per-user model assumes. **Mitigation:** v1.1 design accepts this; multi-user scaling math in §5.2 uses tabs not users. Cross-tab coordination via BroadcastChannel API is V2 candidate. **Status:** accepted; revisit if average tabs/user crosses 2.0.

### H-35 — Optimistic update overlap

Multiple rapid autosave PATCHes — second mutation's `onMutate` reads the optimistic state from the first, not the original. On the first's failure, revert restores incorrect "previous" state. **Mitigation:** TanStack `cancelQueries` in `onMutate` cancels in-flight refetches but doesn't queue mutations; sequential autosave debounce (already 500 ms in current code) ensures only one PATCH in flight per node. **Status:** designed-in via debounce; verify in B.3 test.

These six hazards (H-29 through H-35) join the existing H-01..H-28 in `docs/stelavox_technical_architecture_v2_15.md` §5 once Phase 8.5b lands. Full entries authored as part of the Tier-A spec sync at sub-phase close-out per build checklist §7.

---

## 10. Phasing summary

| Sub-phase | What | Visible result | Est. sessions |
|---|---|---|---|
| B.1 — Rollup correctness | Postgres RPCs + migrate dashboard + doc header | Dashboard shows real numbers (fixes 187k → 500k for mega-doc) | 1 |
| B.2 — Endpoint projection | `?include=` opt-in + migrate 8 consumers + flip default | Doc open ~4× faster on big docs | 2 |
| B.3 — Client cache | TanStack Query + Realtime patching + error UI | In-doc navigation feels instant | 2 |
| B.4 — RSC seed | Server dehydrates query cache | Cold doc open noticeably faster | 1 |
| B.5 — Realtime multiplex | Channel-per-tab with demuxer; 11 consumers migrated | Scales to ~330 concurrent users on Supabase Pro | 3 |
| B.6 — Bundle slim | docx/epub leak fix + dynamic imports + husky pre-push budget | Cold load ~50-80 KB lighter | 1 |
| **Total** | | | **10 sessions** |

Detailed work-item breakdown in `docs/stelavox_phase8_5b_build_checklist_v1_0.md`.

---

## 11. What this spec does not cover

Out of scope for V1.0:

- **Multi-user collaboration patterns.** CRDT, OT, presence cursors. V2+.
- **Cross-document Director.** Each document has its own Director conversation. Cross-document context-sharing is V2+.
- **Edge caching.** Vercel `unstable_cache` + `revalidateTag` could land at any point post-B.4; treated as optimisation-on-optimisation.
- **Pagination of tree fetch.** All current V1 layer stacks (Novel, Series, Short Story) top out at ~5-15k nodes. Pagination kicks in if Anthology / TV Series stacks emerge with >50k nodes per document. See §11.1 for revisit thresholds.
- **Postgres read replicas.** Not needed at V1 scale; signalled here as the V2 scaling lever.
- **Anthropic API redesign.** Director and agent endpoints already use streaming + caching + BYOK. No changes in this phase.
- **Self-hosted Realtime.** V2+ scaling lever beyond what Supabase Team can deliver.
- **Cross-tab Realtime channel coordination via BroadcastChannel API.** V2+; current spec accepts per-tab multiplication (see H-34).
- **GitHub Actions / cloud CI.** V2+; current spec uses Husky pre-push hook (§7.1).
- **Streaming SSR (`@tanstack/react-query-next-experimental`).** V2+; current spec uses standard `dehydrate`/`hydrate`.

Each of these has a place in a future TA / Director Architecture revision.

### 11.1 When pagination becomes necessary

The default projected `/api/documents/[id]/nodes` payload is ~80 KB gzipped at 1556 nodes. Scaling that up:

| Node count | Estimated payload (gzipped) | Status |
|---|---|---|
| ~1,500 (Novel, today's mega-doc) | ~80 KB | ✅ comfortable |
| ~5,000 (large Novel) | ~270 KB | ✅ acceptable |
| ~15,000 (long Series) | ~800 KB | ⚠️ noticeable; revisit |
| ~50,000 (Anthology / TV Series stack) | ~2.7 MB | ❌ pagination required |

**Revisit thresholds:**
- Any single document exceeding 5,000 nodes → reassess whether projection alone is enough
- Any org structural-node total exceeding 10,000 → may indicate pattern issues with the rollup queries
- Project rollup latency p95 crossing 100 ms → investigate index health or RPC plan
- Document rollup latency p95 crossing 50 ms → same

Triggers re-design conversation; not an in-place fix.

---

## 12. Glossary

**Projected response.** A response containing only an explicit subset of columns/fields, sized to what the caller actually needs.

**Rollup.** A precomputed aggregate over a set of rows (count, sum, max, etc.) returned as one row.

**RPC.** Remote procedure call — here, a Postgres function callable via Supabase's `.rpc(...)` interface. SECURITY DEFINER bodies with `SET search_path = public` per H-13.

**Demuxer.** Client-side event router that takes events from one Realtime channel and dispatches them to multiple component-level subscribers by topic.

**Dehydration.** TanStack Query pattern for serialising a server-side `QueryClient`'s cache state into a payload that the client picks up and rehydrates into its own `QueryClient`.

**Hydration boundary.** React component (`HydrationBoundary` from `@tanstack/react-query`) wrapping client subtrees that consume dehydrated query state.

**Channel multiplex.** One Realtime channel carrying events for multiple logical topics; subscribers register interest in specific topics rather than opening separate channels.

**Query-key factory.** Typed function producing a TanStack Query cache key. Pattern at §3.3.1. Eliminates string-literal key drift.

**Patcher.** The Realtime → cache integration layer. Applies row deltas to the TanStack cache without triggering refetches.

**Topic.** A logical grouping of Realtime events corresponding to a table or filtered subset. Components subscribe to topics via `useRealtimeTopic`; the demuxer routes events to them.

**Filter.** A PostgREST-style row filter applied to a `postgres_changes` subscription. Each topic has at most one filter per channel.

**Per-request QueryClient.** A `QueryClient` instance created inside a server component and discarded at request end. Distinct from the per-session client-side QueryClient. See §3.6.1.

**Skeleton.** A placeholder UI rendered during cold fetch, sized to the expected content shape. See §3.7.1.

**Ordering buffer.** The bounded queue of Realtime patches that arrived before their target query's first fetch resolved. Flushed when the fetch lands. See §3.4.1.

---

## Changelog

**v1.1 — 2026-06-08** Audit pass — absorbed C1–C10 + I-tier findings from the same-day critical review. New material: §0.2 pre-flight code inventory (8 endpoint consumers, 11 Realtime subscribers with file/line references); §0.3 decisions locked at v1.1 (TanStack Query, on-demand RPC, channel-per-tab, husky pre-push, listNodes() SSR data source); §2.5 TypeScript type contracts (lib/types/api.ts as single source of truth); §3.0 existing scaffolding pointers (realtime-auth.ts, existing realtime hooks); §3.3.1 typed query-key factories; §3.4.1 ordering guarantees for Realtime-before-fetch; §3.6.1 App Router gotchas (per-request QueryClient, cookies(), staleTime tuning); §3.6.2 SSR data source decision (server reads listNodes() not own API); §3.7 error handling and failure UX (per-failure-surface treatment); §3.7.1 loading-state vocabulary (skeleton vs spinner vs nothing); §3.8 observability (metric topics, sampling rate); §5.0 existing realtime-auth scaffolding absorption plan; §5.2 corrected "per session" to "per tab"; §5.5 reconnect cascade detail; §7.1 CI mechanism locked (Husky pre-push); §8 budgets clarified as production-mode only; §11.1 pagination revisit thresholds; §10 phasing table gains session-count estimates totalling 10 sessions; H-33 (Realtime-before-fetch), H-34 (per-tab channel multiplication), H-35 (optimistic update overlap) added. v1.0 substantive content retained; numbering preserved where possible.

**v1.0 — 2026-06-08** Initial draft. Authored as the Tier-A architecture target for Phase 8.5b — Document Load Architecture. Three architectural decisions locked at user session 2026-06-08: TanStack Query as client cache library; on-demand Postgres RPC for rollups (with documented promotion path to materialised); channel-per-user Realtime topology with client-side demuxer. Six sub-phases B.1-B.6 phased to deliver visible improvement at each step and minimise blast radius. Eight performance budgets locked. Four new hazards H-29..H-32 documented; full entries land in TA §5 once Phase 8.5b ships. Out-of-scope items (CRDT, edge caching, pagination, replicas, self-hosted Realtime) explicitly enumerated to prevent scope creep during sub-phase execution.
