import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'

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
    <div style={{ maxWidth: '800px', margin: '0 auto' }}>
      <div style={{ marginBottom: 'var(--space-5)' }}>
        <Link href={`/projects/${projectId}`} style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', textDecoration: 'none' }}>
          ← {document.name}
        </Link>
      </div>
      <h1 style={{ fontSize: 'var(--text-2xl)', color: 'var(--color-text-primary)', fontWeight: 500, marginBottom: 'var(--space-2)' }}>
        {document.name}
      </h1>
      <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', marginBottom: 'var(--space-6)' }}>
        {document.document_type.replace('_', ' ')} · {document.status}
      </p>
      <div
        style={{
          padding: 'var(--space-6)',
          background: 'var(--color-bg-surface)',
          border: '1px solid var(--color-border-subtle)',
          borderRadius: '6px',
          textAlign: 'center',
        }}
      >
        <p style={{ fontSize: 'var(--text-base)', color: 'var(--color-text-muted)' }}>
          Editor coming in Phase 2.
        </p>
      </div>
    </div>
  )
}
