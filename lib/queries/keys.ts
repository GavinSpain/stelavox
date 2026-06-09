// Phase 8.5b B.3 — Typed query-key factories for TanStack Query.
//
// Single source of truth for every cache key in the app. Direct string-
// literal queryKeys are forbidden by convention — every useQuery,
// setQueryData, invalidateQueries, and getQueryData call goes through
// these factories. Typos become compile errors instead of silent cache
// misses.
//
// Refs: docs/stelavox_document_load_architecture_v1_0.md §3.3 + §3.3.1
//
// Key shape: `[domain, id, subkey?]`. The first element is always the
// domain string ('document', 'node', 'project', 'user'). The second
// element scopes by id; the third optional element scopes by subtopic.
//
// Examples:
//   documentKeys.nodes('abc-123')   → ['document', 'abc-123', 'nodes']
//   nodeKeys.single('def-456')      → ['node', 'def-456']
//   projectKeys.rollup('proj-789')  → ['project', 'proj-789', 'rollup']
//
// The `as const` tuple type on each factory yields the strongest
// inference TanStack can use — `useQuery({ queryKey: documentKeys.nodes(id), ... })`
// infers the data type from the registered hook.
//
// Removing or renaming a factory entry breaks all consumers at type-check.
// Adding a new one is additive and safe.

export const documentKeys = {
  /** Root for invalidation patterns: invalidate('document') drops everything. */
  all: () => ['document'] as const,
  /** Structural tree from GET /api/documents/[id]/nodes. */
  nodes: (docId: string) => ['document', docId, 'nodes'] as const,
  /** Aggregate rollup from GET /api/documents/[id]/rollup. */
  rollup: (docId: string) => ['document', docId, 'rollup'] as const,
} as const

export const nodeKeys = {
  all: () => ['node'] as const,
  /** Full node from GET /api/nodes/[id]. */
  single: (id: string) => ['node', id] as const,
} as const

export const projectKeys = {
  all: () => ['project'] as const,
  /** Aggregate rollup from GET /api/projects/[id]/rollup. */
  rollup: (projectId: string) => ['project', projectId, 'rollup'] as const,
  /** Document list from GET /api/projects/[id]/documents. */
  documents: (projectId: string) => ['project', projectId, 'documents'] as const,
} as const

export const userKeys = {
  all: () => ['user'] as const,
  /** Pending-attention bundle (status indicator). */
  attention: () => ['user', 'attention'] as const,
} as const
