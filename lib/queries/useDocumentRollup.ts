'use client'

// Phase 8.5b B.3 — useDocumentRollup hook.
//
// Wraps GET /api/documents/[id]/rollup via TanStack Query. The rollup
// endpoint is backed by the get_document_rollup Postgres RPC (M-212)
// and returns the aggregate counts: words_drafted, words_target,
// node_count, leaf_count, status_counts, last_updated_at.
//
// Refs: docs/stelavox_document_load_architecture_v1_0.md §2.3 + §3.3
//       lib/queries/keys.ts (documentKeys.rollup factory)

import { useQuery } from '@tanstack/react-query'

import { documentKeys } from './keys'
import type { DocumentRollup } from '@/lib/types/api'

export function useDocumentRollup(documentId: string | null | undefined, opts: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: documentId ? documentKeys.rollup(documentId) : ['document', 'none', 'rollup'] as const,
    queryFn: async (): Promise<DocumentRollup | null> => {
      if (!documentId) return null
      const res = await fetch(`/api/documents/${documentId}/rollup`, { cache: 'no-store' })
      if (!res.ok) throw new Error(`useDocumentRollup ${documentId}: ${res.status}`)
      return (await res.json()) as DocumentRollup
    },
    enabled: !!documentId && (opts.enabled ?? true),
  })
}
