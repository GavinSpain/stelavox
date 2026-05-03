import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import NewDocumentDialog from '@/components/documents/NewDocumentDialog'
import DocumentMenu from '@/components/documents/DocumentMenu'

interface Props {
  params: Promise<{ projectId: string }>
}

export default async function ProjectPage({ params }: Props) {
  const { projectId } = await params
  const supabase = await createClient()

  const { data: project } = await supabase
    .from('projects')
    .select('id, name, description')
    .eq('id', projectId)
    .maybeSingle()

  if (!project) notFound()

  const { data: documents } = await supabase
    .from('documents')
    .select('id, name, description, document_type, status, created_at')
    .eq('project_id', projectId)
    .eq('status', 'active')
    .order('created_at', { ascending: false })

  return (
    <div style={{ maxWidth: '800px', margin: '0 auto' }}>
      <div style={{ marginBottom: 'var(--space-5)' }}>
        <Link href="/dashboard" style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', textDecoration: 'none' }}>
          ← Projects
        </Link>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-6)' }}>
        <div>
          <h1 style={{ fontSize: 'var(--text-2xl)', color: 'var(--color-text-primary)', fontWeight: 500 }}>
            {project.name}
          </h1>
          {project.description && (
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', marginTop: 'var(--space-1)' }}>
              {project.description}
            </p>
          )}
        </div>
        <NewDocumentDialog projectId={projectId} />
      </div>

      {!documents?.length ? (
        <div style={{ textAlign: 'center', padding: 'var(--space-8) 0' }}>
          <p style={{ fontSize: 'var(--text-base)', color: 'var(--color-text-muted)' }}>
            No documents yet. Create one to get started.
          </p>
        </div>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          {documents.map(doc => (
            <li
              key={doc.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: 'var(--space-3) var(--space-4)',
                background: 'var(--color-bg-surface)',
                border: '1px solid var(--color-border-subtle)',
                borderRadius: '6px',
                opacity: doc.status === 'archived' ? 0.6 : 1,
              }}
            >
              <Link href={`/projects/${projectId}/documents/${doc.id}`} style={{ textDecoration: 'none', flex: 1 }}>
                <span style={{ fontSize: 'var(--text-base)', color: 'var(--color-text-primary)', fontWeight: 500 }}>
                  {doc.name}
                </span>
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginLeft: 'var(--space-2)', textTransform: 'capitalize' }}>
                  {doc.document_type.replace('_', ' ')} · {doc.status}
                </span>
              </Link>
              <DocumentMenu documentId={doc.id} documentName={doc.name} documentStatus={doc.status} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
