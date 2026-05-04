import { notFound } from 'next/navigation'
import Link from 'next/link'
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
    .select('id, name, description, document_type, status, created_at')
    .eq('id', documentId)
    .maybeSingle()

  if (!document) notFound()

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
      </div>
      <div style={{ flex: 1, overflow: 'hidden' }}>
        <DocumentClient
          projectId={projectId}
          documentId={documentId}
          documentType={document.document_type as 'novel' | 'short_story' | 'series'}
        />
      </div>
    </div>
  )
}
