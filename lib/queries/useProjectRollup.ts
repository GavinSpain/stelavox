'use client'

// Phase 8.5b B.3 — useProjectRollup hook.
//
// Wraps GET /api/projects/[id]/rollup via TanStack Query. Backed by
// the get_project_rollup Postgres RPC (M-212). Returns project-level
// aggregates summed across the project's documents.
//
// Refs: docs/stelavox_document_load_architecture_v1_0.md §2.4 + §3.3
//       lib/queries/keys.ts (projectKeys.rollup factory)

import { useQuery } from '@tanstack/react-query'

import { projectKeys } from './keys'
import type { ProjectRollup } from '@/lib/types/api'

export function useProjectRollup(projectId: string | null | undefined, opts: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: projectId ? projectKeys.rollup(projectId) : ['project', 'none', 'rollup'] as const,
    queryFn: async (): Promise<ProjectRollup | null> => {
      if (!projectId) return null
      const res = await fetch(`/api/projects/${projectId}/rollup`, { cache: 'no-store' })
      if (!res.ok) throw new Error(`useProjectRollup ${projectId}: ${res.status}`)
      return (await res.json()) as ProjectRollup
    },
    enabled: !!projectId && (opts.enabled ?? true),
  })
}
