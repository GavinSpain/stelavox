'use client'

// Phase 8.01.E T-1 + Phase 8.01 wireframe-alignment round 1 (Brand
// Identity v2.3) — Documents tab of the Project page.
//
// Each document is a card with six discrete regions matching
// `docs/wireframes/wireframe_phase8_01_ux_consistency/03_project_page_v1_iter1.html`:
//   1. Verdigris ordinal tile (Inviolable #2 use #10)
//   2. Title + document-type stack-tag chip (use #11)
//   3. Meta strip (last edit / status)
//   4. Hover-actions strip — Open (use #12), Export, Archive
//   5. Hover lift + verdigris border-color transition
//   6. Always-visible 3-dot DocumentMenu (Rename / Archive / Delete)
//
// Out of scope for round 1 (deferred to a later sub-phase that brings
// per-document data aggregates): progress bar column, status pip +
// lifecycle pill, right-side ProjectProfile + RecentActivity cards.

import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useState, useTransition } from 'react'

import NewDocumentDialog from '@/components/documents/NewDocumentDialog'
import DocumentMenu from '@/components/documents/DocumentMenu'
import {
  formatLastActive,
  prettyDocumentType,
  type ProjectDocumentRow,
} from '@/app/(app)/projects/[projectId]/_ProjectPageClient'

interface ProjectDocumentsTabProps {
  projectId: string
  documents: ProjectDocumentRow[]
}

export function ProjectDocumentsTab({ projectId, documents }: ProjectDocumentsTabProps) {
  return (
    <div data-testid="project-documents-tab">
      <SectionHeader projectId={projectId} />
      {documents.length === 0 ? (
        <EmptyState />
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {documents.map((doc, index) => (
            <DocumentRow key={doc.id} projectId={projectId} doc={doc} ordinal={index + 1} />
          ))}
        </ul>
      )}
    </div>
  )
}

function SectionHeader({ projectId }: { projectId: string }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 16,
      }}
    >
      <h2
        data-testid="documents-section-title"
        style={{
          fontFamily: 'var(--font-inter), Inter, sans-serif',
          fontWeight: 600,
          fontSize: 11,
          letterSpacing: '0.28em',
          textTransform: 'uppercase',
          color: 'var(--color-text-secondary)',
          margin: 0,
        }}
      >
        Documents in this project
      </h2>
      <NewDocumentDialog projectId={projectId} />
    </div>
  )
}

function EmptyState() {
  return (
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
  )
}

interface DocumentRowProps {
  projectId: string
  doc: ProjectDocumentRow
  ordinal: number
}

function DocumentRow({ projectId, doc, ordinal }: DocumentRowProps) {
  const router = useRouter()
  const [hovered, setHovered] = useState(false)
  const [archiving, startArchiveTransition] = useTransition()

  const lastEdit =
    formatLastActive(doc.updated_at ?? doc.created_at)?.replace(/^last active /, 'last edit ') ?? null

  function handleArchive() {
    startArchiveTransition(async () => {
      const res = await fetch(`/api/documents/${doc.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: doc.status === 'archived' ? 'active' : 'archived' }),
      })
      if (res.ok) router.refresh()
    })
  }

  return (
    <li
      data-testid="project-document-row"
      data-document-id={doc.id}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        gap: 18,
        padding: '18px 20px',
        background: 'var(--color-bg-surface)',
        border: '1px solid',
        borderColor: hovered ? 'var(--color-accent-hover)' : 'var(--color-border-default)',
        borderRadius: 6,
        transform: hovered ? 'translateY(-1px)' : 'translateY(0)',
        transition: 'border-color 120ms ease, transform 120ms ease',
      }}
    >
      <OrdinalTile ordinal={ordinal} />

      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <Link
          href={`/projects/${projectId}/documents/${doc.id}`}
          style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              gap: 10,
              flexWrap: 'wrap',
            }}
          >
            <span
              data-testid="document-row-title"
              style={{
                fontFamily: 'var(--font-inter), Inter, sans-serif',
                fontSize: 16,
                fontWeight: 500,
                color: 'var(--color-text-primary)',
                letterSpacing: '-0.005em',
              }}
            >
              {doc.name}
            </span>
            <StackTag documentType={doc.document_type} />
          </div>
          <MetaStrip lastEdit={lastEdit} status={doc.status} description={doc.description} />
        </Link>
      </div>

      <HoverActionsStrip
        projectId={projectId}
        documentId={doc.id}
        documentStatus={doc.status}
        visible={hovered}
        onArchive={handleArchive}
        archiving={archiving}
      />

      <DocumentMenu
        documentId={doc.id}
        documentName={doc.name}
        documentStatus={doc.status}
      />
    </li>
  )
}

/** Inviolable #2 use #10 — Document-row ordinal tile.
 *  --color-accent-muted background + --color-accent-hover digit.
 *  Exported for unit tests (Phase 8.01 wireframe-alignment round 1). */
export function OrdinalTile({ ordinal }: { ordinal: number }) {
  return (
    <div
      data-testid="document-row-ordinal"
      aria-hidden="true"
      style={{
        width: 36,
        height: 36,
        borderRadius: 6,
        background: 'var(--color-accent-muted)',
        color: 'var(--color-accent-hover)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'ui-monospace, "JetBrains Mono", SFMono-Regular, Menlo, monospace',
        fontSize: 13,
        fontWeight: 600,
        flexShrink: 0,
      }}
    >
      {ordinal}
    </div>
  )
}

/** Inviolable #2 use #11 — Document-type identifier chip (small
 *  stack-tag variant; the larger stack-badge variant lives in the
 *  project Header in _ProjectPageClient.tsx).
 *  Exported for unit tests (Phase 8.01 wireframe-alignment round 1). */
export function StackTag({ documentType }: { documentType: string }) {
  return (
    <span
      data-testid="document-row-stack-tag"
      style={{
        fontFamily: 'ui-monospace, "JetBrains Mono", SFMono-Regular, Menlo, monospace',
        fontSize: 9.5,
        fontWeight: 500,
        letterSpacing: '0.04em',
        color: 'var(--color-accent-hover)',
        padding: '1px 6px',
        border: '1px solid color-mix(in srgb, var(--color-accent-hover) 35%, transparent)',
        borderRadius: 2,
        background: 'color-mix(in srgb, var(--color-accent) 6%, transparent)',
      }}
    >
      {prettyDocumentType(documentType)}
    </span>
  )
}

function MetaStrip({
  lastEdit,
  status,
  description,
}: {
  lastEdit: string | null
  status: string
  description: string | null
}) {
  const items: string[] = []
  if (lastEdit) items.push(lastEdit)
  if (status && status !== 'active') items.push(status)
  return (
    <div
      data-testid="document-row-meta"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        fontFamily: 'var(--font-inter), Inter, sans-serif',
        fontSize: 11,
        color: 'var(--color-text-muted)',
      }}
    >
      {items.length === 0 ? (
        <span style={{ fontStyle: 'italic' }}>no edits yet</span>
      ) : (
        items.map((item, i) => (
          <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            {i > 0 && <span aria-hidden>·</span>}
            <span>{item}</span>
          </span>
        ))
      )}
      {description && (
        <>
          <span aria-hidden>·</span>
          <span
            style={{
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              maxWidth: 320,
              color: 'var(--color-text-secondary)',
              fontWeight: 400,
            }}
          >
            {description}
          </span>
        </>
      )}
    </div>
  )
}

interface HoverActionsStripProps {
  projectId: string
  documentId: string
  documentStatus: string
  visible: boolean
  onArchive: () => void
  archiving: boolean
}

/** Hover-actions strip — appears on row hover with Open / Export /
 *  Archive. Open renders in verdigris (Inviolable #2 use #12 — the
 *  sole admitted hover-state verdigris use, justified by the Catalog
 *  category in Brand Identity v2.3 §5.2). */
function HoverActionsStrip({
  projectId,
  documentId,
  documentStatus,
  visible,
  onArchive,
  archiving,
}: HoverActionsStripProps) {
  return (
    <div
      data-testid="document-row-actions"
      data-visible={visible ? 'true' : 'false'}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 0,
        padding: 2,
        background: 'var(--color-bg-elevated)',
        border: '1px solid var(--color-border-strong)',
        borderRadius: 4,
        opacity: visible ? 1 : 0,
        pointerEvents: visible ? 'auto' : 'none',
        transition: 'opacity 120ms ease',
        marginRight: 4,
      }}
    >
      <ActionLink
        href={`/projects/${projectId}/documents/${documentId}`}
        testid="document-row-open"
        primary
      >
        Open
      </ActionLink>
      <ActionSep />
      <ActionLink
        href={`/projects/${projectId}?tab=export`}
        testid="document-row-export"
      >
        Export
      </ActionLink>
      <ActionSep />
      <ActionButton
        testid="document-row-archive"
        onClick={onArchive}
        disabled={archiving}
      >
        {documentStatus === 'archived' ? 'Unarchive' : 'Archive'}
      </ActionButton>
    </div>
  )
}

function ActionLink({
  href,
  children,
  testid,
  primary = false,
}: {
  href: string
  children: React.ReactNode
  testid: string
  primary?: boolean
}) {
  return (
    <Link
      data-testid={testid}
      href={href}
      style={{
        fontFamily: 'var(--font-inter), Inter, sans-serif',
        fontSize: 10.5,
        fontWeight: 500,
        // Inviolable #2 use #12 — Open action renders in verdigris.
        // All other actions in the strip stay neutral.
        color: primary ? 'var(--color-accent-hover)' : 'var(--color-text-secondary)',
        padding: '3px 8px',
        borderRadius: 2,
        cursor: 'pointer',
        textDecoration: 'none',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </Link>
  )
}

function ActionButton({
  onClick,
  disabled,
  children,
  testid,
}: {
  onClick: () => void
  disabled?: boolean
  children: React.ReactNode
  testid: string
}) {
  return (
    <button
      type="button"
      data-testid={testid}
      onClick={onClick}
      disabled={disabled}
      style={{
        background: 'transparent',
        border: 0,
        fontFamily: 'var(--font-inter), Inter, sans-serif',
        fontSize: 10.5,
        fontWeight: 500,
        color: 'var(--color-text-secondary)',
        padding: '3px 8px',
        borderRadius: 2,
        cursor: disabled ? 'progress' : 'pointer',
        opacity: disabled ? 0.6 : 1,
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </button>
  )
}

function ActionSep() {
  return (
    <span
      aria-hidden
      style={{
        width: 1,
        height: 14,
        background: 'var(--color-border-default)',
        margin: '0 2px',
        flexShrink: 0,
      }}
    />
  )
}
