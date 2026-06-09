// Phase 8.01.E T-1 — Project page rewrite.
//
// Server component fetches project + documents; hands off to
// ProjectPageClient which owns the Documents | Export tab state
// (URL-driven via `?tab=`).
//
// Phase 8 nav cleanup follow-up (2026-06-09): each document row now
// carries a live rollup (wordsDrafted / wordsTarget / lastUpdatedAt)
// pulled from get_document_rollup (M-212). The Documents tab uses
// these to render real word counts + a real last-edit timestamp
// instead of the static `documents.description` string and the stale
// `documents.updated_at` (which doesn't move when nodes change).
// One rollup RPC per document, executed in parallel — for typical
// projects (1–3 docs) the wall-clock is dominated by the slowest
// single RPC and runs sub-50 ms.

import type { SupabaseClient } from '@supabase/supabase-js'

import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getDocumentRollup } from '@/lib/queries/rollups'
import { ProjectSidebarSetup } from './_ProjectSidebarSetup'
import { ProjectPageClient, type ProjectDocumentRow } from './_ProjectPageClient'

interface Props {
  params: Promise<{ projectId: string }>
}

type DocumentBase = Omit<ProjectDocumentRow, 'rollup'>

export default async function ProjectPage({ params }: Props) {
  const { projectId } = await params
  const supabase = await createClient()

  const { data: project } = await supabase
    .from('projects')
    .select('id, name, description, default_document_type, updated_at')
    .eq('id', projectId)
    .maybeSingle<{
      id: string
      name: string
      description: string | null
      default_document_type: string | null
      updated_at: string | null
    }>()
  if (!project) notFound()

  const { data: documentsRaw } = await supabase
    .from('documents')
    .select('id, name, description, document_type, status, created_at, updated_at')
    .eq('project_id', projectId)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .returns<DocumentBase[]>()

  // Fan out one rollup RPC per document, in parallel through the
  // Supabase pooler. Individual failures degrade gracefully — the
  // ProjectDocumentsTab falls back to the legacy description /
  // doc.updated_at rendering when rollup is null.
  const documents: ProjectDocumentRow[] = await Promise.all(
    (documentsRaw ?? []).map(async (d) => {
      try {
        const rollup = await getDocumentRollup(
          supabase as unknown as SupabaseClient,
          d.id,
        )
        return {
          ...d,
          rollup: {
            wordsDrafted: rollup.words_drafted,
            wordsTarget: rollup.words_target,
            lastUpdatedAt: rollup.last_updated_at,
          },
        }
      } catch {
        return { ...d, rollup: null }
      }
    }),
  )

  return (
    <>
      <ProjectSidebarSetup projectId={projectId} projectName={project.name} />
      <ProjectPageClient
        projectId={projectId}
        projectName={project.name}
        projectDescription={project.description}
        projectDocumentType={project.default_document_type}
        projectUpdatedAt={project.updated_at}
        documents={documents}
      />
    </>
  )
}
