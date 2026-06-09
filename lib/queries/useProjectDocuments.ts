'use client'

// Phase 8 nav cleanup follow-up (2026-06-09) — useProjectDocuments.
//
// Wraps GET /api/projects/[id]/documents via TanStack Query. The
// Sidebar's PROJECT slot uses this to render the project's full
// document set (indented under the project name with the active
// document highlighted) — a navigation surface for switching between
// documents within the same project without bouncing through the
// project page.
//
// No realtime subscription: `documents` is not in the realtime
// publication (would need a migration) and document CRUD is rare
// enough that the layout-remount-on-doc-switch refetch covers nearly
// every change. If same-tab freshness becomes a real issue post-launch,
// add `documents` to the realtime publication + REALTIME_TOPICS then.
//
// Refs: lib/queries/keys.ts (projectKeys.documents)
//       app/api/projects/[projectId]/documents/route.ts (GET handler)

import { useQuery } from '@tanstack/react-query'

import { projectKeys } from './keys'

export interface ProjectDocumentRow {
  id: string
  name: string
  document_type: 'novel' | 'short_story' | 'series'
  status: 'active' | 'archived' | 'published'
}

interface ApiResponse {
  documents: Array<{
    id: string
    name: string
    document_type: string
    status: string
  }>
}

export function useProjectDocuments(
  projectId: string | null | undefined,
  opts: { enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: projectId ? projectKeys.documents(projectId) : (['project', 'none', 'documents'] as const),
    queryFn: async (): Promise<ProjectDocumentRow[]> => {
      if (!projectId) return []
      const res = await fetch(`/api/projects/${projectId}/documents?status=active`, {
        cache: 'no-store',
      })
      if (!res.ok) throw new Error(`useProjectDocuments ${projectId}: ${res.status}`)
      const body = (await res.json()) as ApiResponse
      return (body.documents ?? []).map((d) => ({
        id: d.id,
        name: d.name,
        document_type: d.document_type as ProjectDocumentRow['document_type'],
        status: d.status as ProjectDocumentRow['status'],
      }))
    },
    enabled: !!projectId && (opts.enabled ?? true),
    // Document set rarely changes; keep cached longer than the default.
    staleTime: 5 * 60_000,
  })
}
