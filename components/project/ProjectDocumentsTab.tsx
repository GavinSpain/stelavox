'use client'

// Phase 8.01.E T-1 — Documents tab of the Project page.
//
// Reflows the prior project-page list into the new card shape inside
// the Documents tab. Existing NewDocumentDialog + DocumentMenu wiring
// is preserved.

import Link from 'next/link'

import NewDocumentDialog from '@/components/documents/NewDocumentDialog'
import DocumentMenu from '@/components/documents/DocumentMenu'
import type { ProjectDocumentRow } from '@/app/(app)/projects/[projectId]/_ProjectPageClient'

interface ProjectDocumentsTabProps {
  projectId: string
  documents: ProjectDocumentRow[]
}

export function ProjectDocumentsTab({ projectId, documents }: ProjectDocumentsTabProps) {
  return (
    <div data-testid="project-documents-tab">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <h2
          style={{
            fontFamily: 'var(--font-inter), Inter, sans-serif',
            fontWeight: 500,
            fontSize: 15,
            color: 'var(--color-text-primary)',
            margin: 0,
          }}
        >
          Documents
        </h2>
        <NewDocumentDialog projectId={projectId} />
      </div>
      {documents.length === 0 ? (
        <div
          style={{
            textAlign: 'center',
            padding: '32px 0',
            fontFamily: 'var(--font-inter), Inter, sans-serif',
            fontSize: 13,
            color: 'var(--color-text-muted)',
          }}
        >
          No documents yet. Create one to get started.
        </div>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {documents.map((doc) => (
            <li
              key={doc.id}
              data-testid="project-document-row"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '14px 16px',
                background: 'var(--color-bg-elevated)',
                border: '1px solid var(--color-border-subtle)',
                borderRadius: 6,
              }}
            >
              <Link
                href={`/projects/${projectId}/documents/${doc.id}`}
                style={{ textDecoration: 'none', flex: 1, minWidth: 0 }}
              >
                <div
                  style={{
                    fontFamily: 'var(--font-inter), Inter, sans-serif',
                    fontWeight: 500,
                    fontSize: 14,
                    color: 'var(--color-text-primary)',
                  }}
                >
                  {doc.name}
                </div>
                <div
                  style={{
                    fontFamily: 'ui-monospace, "JetBrains Mono", SFMono-Regular, Menlo, monospace',
                    fontSize: 10.5,
                    color: 'var(--color-text-muted)',
                    marginTop: 2,
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                  }}
                >
                  {doc.document_type.replace('_', ' ')} · {doc.status}
                </div>
                {doc.description && (
                  <div
                    style={{
                      fontFamily: 'var(--font-inter), Inter, sans-serif',
                      fontSize: 12,
                      color: 'var(--color-text-secondary)',
                      marginTop: 6,
                    }}
                  >
                    {doc.description}
                  </div>
                )}
              </Link>
              <DocumentMenu documentId={doc.id} documentName={doc.name} documentStatus={doc.status} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
