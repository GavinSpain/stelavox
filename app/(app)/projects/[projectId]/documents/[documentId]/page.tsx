import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { DocumentClient } from './_DocumentClient'
import { BriefViewer } from '@/components/director/BriefViewer'
import { getBriefState } from '@/lib/brief/getBriefState'

interface Props {
  params: Promise<{ projectId: string; documentId: string }>
}

export default async function DocumentPage({ params }: Props) {
  const { projectId, documentId } = await params
  const supabase = await createClient()

  const { data: document } = await supabase
    .from('documents')
    .select('id, name, description, document_type, status, created_at, brief_id')
    .eq('id', documentId)
    .maybeSingle()

  if (!document) notFound()

  // V1.x-A: every document has exactly one Brief (Migration 073 backfill
  // + Migration 074 auto-create). Server-render the initial state so the
  // BriefViewer hydrates without an extra round-trip; client component
  // subscribes to realtime updates from there.
  const initialBrief = document.brief_id
    ? await getBriefState(supabase, document.brief_id).catch(() => null)
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
        {document.brief_id ? (
          <div style={{ marginTop: 'var(--space-3)' }}>
            <BriefViewer briefId={document.brief_id} initialState={initialBrief} />
          </div>
        ) : null}
      </div>
      <div style={{ flex: 1, overflow: 'hidden' }}>
        <DocumentClient
          projectId={projectId}
          documentId={documentId}
          documentName={document.name}
          documentType={document.document_type as 'novel' | 'short_story' | 'series'}
          briefId={document.brief_id}
        />
      </div>
    </div>
  )
}
