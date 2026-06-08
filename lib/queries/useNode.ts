'use client'

// Phase 8.5b B.3 — useNode hook.
//
// Wraps GET /api/nodes/[id] via TanStack Query. Per Tier-A §2.2, this
// is the per-node hydration surface — always returns the full node
// record including prose / summary / notes / metadata. Used by the
// detail panel when the user opens a tree row.
//
// Refs: docs/stelavox_document_load_architecture_v1_0.md §3 + §3.3
//       lib/queries/keys.ts (nodeKeys factory)

import { useQuery } from '@tanstack/react-query'

import { nodeKeys } from './keys'

export interface NodeRecord {
  id: string
  document_id: string | null
  project_id: string
  organisation_id: string
  parent_id: string | null
  order: number
  node_category: string
  node_type: string
  layer_index: number | null
  name: string | null
  status: string
  word_count_actual: number | null
  word_count_target: number | null
  version: number
  content_revision: number
  created_at: string
  updated_at: string
  is_leaf?: boolean
  locked?: boolean
  scope?: string | null
  summary?: unknown
  prose?: unknown
  notes?: unknown
  metadata?: Record<string, unknown> | null
  short_description?: string | null
  tags?: string[] | null
  agent_instruction?: string | null
  last_ai_change_at?: string | null
}

export function useNode(nodeId: string | null | undefined, opts: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: nodeId ? nodeKeys.single(nodeId) : ['node', 'none'] as const,
    queryFn: async (): Promise<NodeRecord | null> => {
      if (!nodeId) return null
      const res = await fetch(`/api/nodes/${nodeId}`, { cache: 'no-store' })
      if (res.status === 404) return null
      if (!res.ok) throw new Error(`useNode ${nodeId}: ${res.status}`)
      const body = (await res.json()) as { node: NodeRecord }
      return body.node ?? null
    },
    enabled: !!nodeId && (opts.enabled ?? true),
  })
}
