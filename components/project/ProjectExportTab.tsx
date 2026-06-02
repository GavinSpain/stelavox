'use client'

// Phase 8.01.E T-2 — Export tab of the Project page.
//
// Per OQ-1 (b) lock: document picker. One Export button per document
// opens the existing per-document ExportModal (Phase 7). No new export
// pipeline work; the project-scope multi-document tree-with-checkboxes
// is a V1.x / V2 candidate, not 8.01.E scope.

import { DocumentExportButton } from '@/components/export/DocumentExportButton'
import type { ProjectDocumentRow } from '@/app/(app)/projects/[projectId]/_ProjectPageClient'

interface ProjectExportTabProps {
  projectId: string
  documents: ProjectDocumentRow[]
}

export function ProjectExportTab({ projectId, documents }: ProjectExportTabProps) {
  return (
    <div data-testid="project-export-tab">
      <div style={{ marginBottom: 16 }}>
        <h2
          style={{
            fontFamily: 'var(--font-inter), Inter, sans-serif',
            fontWeight: 500,
            fontSize: 15,
            color: 'var(--color-text-primary)',
            margin: 0,
          }}
        >
          Export
        </h2>
        <p
          style={{
            fontFamily: 'var(--font-inter), Inter, sans-serif',
            fontSize: 12.5,
            color: 'var(--color-text-secondary)',
            margin: '6px 0 0',
            maxWidth: 540,
          }}
        >
          Pick a document to export. Each export goes through the document&apos;s
          tree with the format and profile you choose.
        </p>
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
          No documents to export yet.
        </div>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {documents.map((doc) => (
            <li
              key={doc.id}
              data-testid="export-document-row"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '14px 16px',
                background: 'var(--color-bg-elevated)',
                border: '1px solid var(--color-border-subtle)',
                borderRadius: 6,
                gap: 16,
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
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
              </div>
              <DocumentExportButton
                projectId={projectId}
                documentId={doc.id}
                documentName={doc.name}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
