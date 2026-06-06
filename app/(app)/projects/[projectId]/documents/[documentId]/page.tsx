import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { DocumentClient } from './_DocumentClient'

interface Props {
  params: Promise<{ projectId: string; documentId: string }>
}

export default async function DocumentPage({ params }: Props) {
  const { projectId, documentId } = await params
  const supabase = await createClient()

  const { data: document } = await supabase
    .from('documents')
    .select('id, name, description, document_type, status, created_at, updated_at, profile_id')
    .eq('id', documentId)
    .maybeSingle()

  if (!document) notFound()

  // Project name for the Sidebar PROJECT slot. Tiny extra read; the
  // server-render path already has a Supabase client open.
  const { data: project } = await supabase
    .from('projects')
    .select('name')
    .eq('id', projectId)
    .maybeSingle()

  // Phase 8.01 wireframe-alignment round 3: the ProjectProfileViewer
  // strip that previously sat above the tree is removed — the
  // wireframe Edit Mode (`02_edit_mode_v2_iter3.html`) doesn't show a
  // Profile strip in the tree pane; Profile content is reachable via
  // the Director panel. Removing the server-side getProjectProfile
  // round-trip too since nothing on this page renders it now.
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <DocumentClient
        projectId={projectId}
        documentId={documentId}
        documentName={document.name}
        documentType={document.document_type as 'novel' | 'short_story' | 'series'}
        documentUpdatedAt={document.updated_at}
        profileId={document.profile_id}
        projectName={project?.name ?? null}
      />
    </div>
  )
}
