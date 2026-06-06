// Phase 8.01 wireframe-alignment round 2 — Document title strip above
// the tree. Maps to `.tree-toolbar` in
// `02_edit_mode_v2_iter3.html`:
//
//   [breadcrumb: Project / Manuscript]
//   [16px/600 title] [verdigris stack-badge use #11] [meta line]
//
// Inviolable #2: use #11 (document-type identifier chip) on stack-badge.
// No other verdigris uses in this file.
//
// "N nodes" and "X% complete" meta items are wireframe-spec'd but require
// per-document aggregation we don't have yet (deferred to a later sub-phase
// that brings the data layer). The meta line renders what's available now:
// document type + last edit relative time.

import Link from 'next/link'

interface DocumentTitleStripProps {
  projectId: string
  projectName: string | null
  documentName: string
  documentType: string
  /** ISO-8601 timestamp of last document edit. */
  documentUpdatedAt: string | null
  /** Optional right-rail slot — Export button etc. */
  rightSlot?: React.ReactNode
}

/** Pretty-print snake_case document type (`series_of_novels` →
 *  `Series of Novels`). Exported for unit tests. */
export function prettyType(t: string | null | undefined): string {
  if (!t) return 'Document'
  return t
    .split('_')
    .filter(Boolean)
    .map((s) => s[0]!.toUpperCase() + s.slice(1))
    .join(' ')
}

/** Short relative-time formatter — `12 min ago` / `2h ago` / `5d ago`.
 *  Exported for unit tests. */
export function formatRelative(iso: string | null | undefined): string | null {
  if (!iso) return null
  const then = new Date(iso).getTime()
  if (!Number.isFinite(then)) return null
  const deltaSec = Math.max(0, Math.round((Date.now() - then) / 1000))
  if (deltaSec < 60) return 'just now'
  if (deltaSec < 3600) return `${Math.floor(deltaSec / 60)} min ago`
  if (deltaSec < 86_400) return `${Math.floor(deltaSec / 3600)}h ago`
  const days = Math.floor(deltaSec / 86_400)
  if (days < 7) return `${days}d ago`
  if (days < 30) return `${Math.floor(days / 7)}w ago`
  return `${Math.floor(days / 30)}mo ago`
}

export function DocumentTitleStrip({
  projectId,
  projectName,
  documentName,
  documentType,
  documentUpdatedAt,
  rightSlot,
}: DocumentTitleStripProps) {
  const lastEdit = formatRelative(documentUpdatedAt)
  return (
    <div
      data-testid="document-title-strip"
      style={{
        padding: '14px 20px 12px',
        borderBottom: '1px solid var(--color-border-subtle)',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        flexShrink: 0,
        background: 'var(--color-bg-base)',
      }}
    >
      {/* Breadcrumb */}
      <div
        data-testid="document-breadcrumb"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontFamily: 'var(--font-inter), Inter, sans-serif',
          fontSize: 11,
          color: 'var(--color-text-muted)',
        }}
      >
        <Link
          href={`/projects/${projectId}`}
          style={{
            color: 'var(--color-text-secondary)',
            textDecoration: 'none',
          }}
        >
          {projectName ?? 'Project'}
        </Link>
        <span aria-hidden style={{ color: 'var(--color-text-disabled)' }}>/</span>
        <span style={{ color: 'var(--color-text-secondary)' }}>Manuscript</span>
      </div>

      {/* Title row */}
      <div
        data-testid="document-title-row"
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 14,
          flexWrap: 'wrap',
          width: '100%',
        }}
      >
        <h1
          data-testid="document-title"
          style={{
            fontFamily: 'var(--font-inter), Inter, sans-serif',
            fontSize: 16,
            fontWeight: 600,
            color: 'var(--color-text-primary)',
            margin: 0,
            letterSpacing: '-0.005em',
          }}
        >
          {documentName}
        </h1>
        {/* Inviolable #2 use #11 — document-type identifier chip
            (smaller variant inside the tree title strip). */}
        <span
          data-testid="document-stack-badge"
          style={{
            fontFamily: 'ui-monospace, "JetBrains Mono", SFMono-Regular, Menlo, monospace',
            fontSize: 9.5,
            fontWeight: 500,
            letterSpacing: '0.04em',
            color: 'var(--color-accent-hover)',
            padding: '2px 7px',
            border: '1px solid color-mix(in srgb, var(--color-accent-hover) 40%, transparent)',
            borderRadius: 3,
            background: 'color-mix(in srgb, var(--color-accent) 6%, transparent)',
          }}
        >
          {prettyType(documentType)}
        </span>
        {lastEdit && (
          <span
            data-testid="document-meta"
            style={{
              fontFamily: 'var(--font-inter), Inter, sans-serif',
              fontSize: 11,
              color: 'var(--color-text-muted)',
            }}
          >
            · last edit {lastEdit}
          </span>
        )}
        <div style={{ marginLeft: 'auto', flexShrink: 0 }}>{rightSlot}</div>
      </div>
    </div>
  )
}
