import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { DocumentClient } from './_DocumentClient'
import { ProjectProfileViewer } from '@/components/director/ProjectProfileViewer'
import { getProjectProfile } from '@/lib/profile/getProjectProfile'

interface Props {
  params: Promise<{ projectId: string; documentId: string }>
}

export default async function DocumentPage({ params }: Props) {
  const { projectId, documentId } = await params
  const supabase = await createClient()

  const { data: document } = await supabase
    .from('documents')
    .select('id, name, description, document_type, status, created_at, profile_id')
    .eq('id', documentId)
    .maybeSingle()

  if (!document) notFound()

  // V1.x-A.1: every document has exactly one Project Profile (M-084
  // backfill + M-085 auto-create). Server-render the initial state so
  // the ProjectProfileViewer hydrates without an extra round-trip; the
  // client component subscribes to realtime updates from there.
  const initialProfile = document.profile_id
    ? await getProjectProfile(supabase, document.profile_id).catch(() => null)
    : null

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div
        style={{
          padding: 'var(--space-4) var(--space-5)',
          borderBottom: '1px solid var(--color-border-subtle)',
          flexShrink: 0,
        }}
      >
        <Link
          href={`/projects/${projectId}`}
          style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', textDecoration: 'none' }}
        >
          ← Project
        </Link>
        <h1
          style={{
            fontSize: 'var(--text-lg)',
            color: 'var(--color-text-primary)',
            fontWeight: 500,
            marginTop: 'var(--space-2)',
          }}
        >
          {document.name}
        </h1>
        <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginTop: 'var(--space-1)' }}>
          {document.document_type.replace('_', ' ')} · {document.status}
        </p>
        {document.profile_id ? (
          <div style={{ marginTop: 'var(--space-3)' }}>
            <ProjectProfileViewer profileId={document.profile_id} initialState={initialProfile} />
          </div>
        ) : null}
      </div>
      <div style={{ flex: 1, overflow: 'hidden' }}>
        <DocumentClient
          projectId={projectId}
          documentId={documentId}
          documentName={document.name}
          documentType={document.document_type as 'novel' | 'short_story' | 'series'}
          profileId={document.profile_id}
        />
      </div>
    </div>
  )
}
