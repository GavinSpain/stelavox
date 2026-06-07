// Phase 8.01.E T-1 — Project page rewrite.
//
// Server component fetches project + documents; hands off to
// ProjectPageClient which owns the Documents | Export tab state
// (URL-driven via `?tab=`).

import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { ProjectSidebarSetup } from './_ProjectSidebarSetup'
import { ProjectPageClient, type ProjectDocumentRow } from './_ProjectPageClient'

interface Props {
  params: Promise<{ projectId: string }>
}

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

  const { data: documents } = await supabase
    .from('documents')
    .select('id, name, description, document_type, status, created_at, updated_at')
    .eq('project_id', projectId)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .returns<ProjectDocumentRow[]>()

  return (
    <>
      <ProjectSidebarSetup projectId={projectId} projectName={project.name} />
      <ProjectPageClient
        projectId={projectId}
        projectName={project.name}
        projectDescription={project.description}
        projectDocumentType={project.default_document_type}
        projectUpdatedAt={project.updated_at}
        documents={documents ?? []}
      />
    </>
  )
}
