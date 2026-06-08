'use client'

// Phase 8.5b B.3 — useDocumentNodes hook.
//
// Wraps GET /api/documents/[id]/nodes via TanStack Query. Default
// projection (structural columns only, per B.2) — callers that need
// content opt-in via the include parameter.
//
// Refs: docs/stelavox_document_load_architecture_v1_0.md §3 + §3.3
//       lib/queries/keys.ts (documentKeys factory)
//
// Returns the tree as a flat depth-first array. The route handler still
// decorates with `is_leaf` and `locked` per existing contract. This
// hook intentionally exposes the same shape the pre-B.3 fetch returned
// so the migrating NodeTree can swap implementations transparently.

import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import { documentKeys } from './keys'
import { flushPendingPatches } from './realtime-patcher'
import type { NodeIncludeField } from '@/lib/types/api'

export interface UseDocumentNodesOptions {
  /** Disable the query (e.g. when documentId is undefined). */
  enabled?: boolean
  /** `category` query param; defaults to 'structural' (same as pre-B.3). */
  category?: 'structural' | 'context' | 'all'
  /** Opt-in content fields per B.2 ?include= contract. Default: structural-only. */
  include?: readonly NodeIncludeField[] | '*' | null
}

/**
 * Tree row shape — superset of `StructuralNodeRow` augmented with the
 * route handler's decorations (`is_leaf`, `locked`). The actual fields
 * present in the response depend on `include`; consumers must handle
 * the structural-only case (most rows lack prose / summary).
 */
export interface TreeNodeRow {
  id: string
  parent_id: string | null
  order: number
  node_category: string
  node_type: string
  layer_index: number | null
  name: string | null
  status: string
  word_count_actual: number | null
  word_count_target: number | null
  updated_at: string
  created_at: string
  is_leaf: boolean
  depth?: number
  locked: boolean
  document_id?: string
  project_id?: string
  organisation_id?: string
  scope?: string | null
  version?: number
  content_revision?: number
  last_ai_change_at?: string | null
  // Opt-in content fields — present only when `include` requested them.
  summary?: unknown
  prose?: unknown
  notes?: unknown
  metadata?: unknown
  short_description?: string | null
  tags?: string[]
  agent_instruction?: string | null
}

function buildUrl(documentId: string, opts: UseDocumentNodesOptions): string {
  const params = new URLSearchParams()
  if (opts.category && opts.category !== 'structural') params.set('category', opts.category)
  if (opts.include === '*') {
    params.set('include', '*')
  } else if (Array.isArray(opts.include) && opts.include.length > 0) {
    params.set('include', opts.include.join(','))
  }
  const qs = params.toString()
  return `/api/documents/${documentId}/nodes${qs ? `?${qs}` : ''}`
}

export function useDocumentNodes(documentId: string | null | undefined, opts: UseDocumentNodesOptions = {}) {
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: documentId ? documentKeys.nodes(documentId) : ['document', 'none', 'nodes'] as const,
    queryFn: async (): Promise<TreeNodeRow[]> => {
      if (!documentId) return []
      const res = await fetch(buildUrl(documentId, opts), { cache: 'no-store' })
      if (!res.ok) {
        throw new Error(`useDocumentNodes ${documentId}: ${res.status}`)
      }
      const body = (await res.json()) as { nodes: TreeNodeRow[] }
      return body.nodes ?? []
    },
    enabled: !!documentId && (opts.enabled ?? true),
  })

  // Flush any Realtime patches that arrived before the first fetch
  // landed (Tier-A §3.4.1 ordering buffer). The patcher uses
  // dataUpdatedAt > 0 as the signal that the cache is now populated.
  useEffect(() => {
    if (!documentId) return
    if (query.dataUpdatedAt > 0) {
      flushPendingPatches(queryClient, documentKeys.nodes(documentId))
    }
  }, [documentId, query.dataUpdatedAt, queryClient])

  return query
}
