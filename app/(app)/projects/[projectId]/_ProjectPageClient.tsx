'use client'

// Phase 8.01.E T-1 — ProjectPage client wrapper.
// Phase 8.01 wireframe-alignment round 1 (Brand Identity v2.3) — Header
// gets stack-badge (use #11) + meta line; TabBar restyled to the
// wireframe's spacing/weight; document rows redesigned in
// ProjectDocumentsTab with verdigris ordinal tile (use #10) +
// document-type chip (use #11) + Open hover-action (use #12).
//
// Owns the tab-strip state (URL-driven `?tab=`) and renders the
// Documents tab or Export tab body. Documents tab body is the existing
// project-page experience refactored into the new shape; Export tab is
// the OQ-1 (b) document picker — lists documents with per-row Export
// buttons that open the existing per-document ExportModal (Phase 7).

import { useRouter, useSearchParams } from 'next/navigation'
import { type ReactNode } from 'react'

import { ProjectDocumentsTab } from '@/components/project/ProjectDocumentsTab'
import { ProjectExportTab } from '@/components/project/ProjectExportTab'

export type ProjectTabId = 'documents' | 'export'
const VALID_TABS: ReadonlySet<string> = new Set<ProjectTabId>(['documents', 'export'])

export interface ProjectDocumentRow {
  id: string
  name: string
  description: string | null
  document_type: string
  status: string
  created_at: string
  updated_at: string | null
}

interface ProjectPageClientProps {
  projectId: string
  projectName: string
  projectDescription: string | null
  projectDocumentType: string | null
  projectUpdatedAt: string | null
  documents: ProjectDocumentRow[]
}

/**
 * Resolve `?tab=` to a tab id. Unknown values fall back to 'documents'.
 * Exported for unit testing.
 */
export function resolveProjectTab(raw: string | null | undefined): ProjectTabId {
  if (raw && VALID_TABS.has(raw)) return raw as ProjectTabId
  return 'documents'
}

export function ProjectPageClient({
  projectId,
  projectName,
  projectDescription,
  projectDocumentType,
  projectUpdatedAt,
  documents,
}: ProjectPageClientProps) {
  const router = useRouter()
  const search = useSearchParams()
  const tab: ProjectTabId = resolveProjectTab(search?.get('tab'))

  const selectTab = (next: ProjectTabId) => {
    const url = next === 'documents' ? `/projects/${projectId}` : `/projects/${projectId}?tab=${next}`
    router.push(url)
  }

  // Stack badge falls back to the first document's type when the
  // project doesn't carry an explicit default — older projects (incl.
  // Shadow Protocol) were created before default_document_type became
  // a standard create-flow field, so they're null in the DB.
  const effectiveStackType = projectDocumentType ?? documents[0]?.document_type ?? null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <Header
        projectName={projectName}
        projectDescription={projectDescription}
        projectDocumentType={effectiveStackType}
        projectUpdatedAt={projectUpdatedAt}
        documentCount={documents.length}
      />
      <TabBar tab={tab} onSelect={selectTab} documentCount={documents.length} />
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '24px 32px',
        }}
      >
        {tab === 'documents' ? (
          <ProjectDocumentsTab projectId={projectId} documents={documents} />
        ) : (
          <ProjectExportTab projectId={projectId} documents={documents} />
        )}
      </div>
    </div>
  )
}

/**
 * Pretty-print a stack identifier (`series_of_novels` → `Series of Novels`).
 * Used by both the project header stack-badge (use #11 — larger size) and
 * the document-row stack-tag chip (use #11 — small size).
 */
export function prettyDocumentType(t: string | null | undefined): string {
  if (!t) return 'Document'
  return t
    .split('_')
    .filter(Boolean)
    .map((s) => s[0]!.toUpperCase() + s.slice(1))
    .join(' ')
}

/**
 * Format an ISO timestamp into a short relative label. Pure helper —
 * mirrors the dashboard ProjectCard formatter so author-facing prose
 * matches across surfaces.
 */
export function formatLastActive(iso: string | null | undefined): string | null {
  if (!iso) return null
  const then = new Date(iso).getTime()
  if (!Number.isFinite(then)) return null
  const deltaSec = Math.max(0, Math.round((Date.now() - then) / 1000))
  if (deltaSec < 60) return 'last active just now'
  if (deltaSec < 3600) return `last active ${Math.floor(deltaSec / 60)}m ago`
  if (deltaSec < 86_400) return `last active ${Math.floor(deltaSec / 3600)}h ago`
  const days = Math.floor(deltaSec / 86_400)
  if (days < 7) return `last active ${days}d ago`
  if (days < 30) return `last active ${Math.floor(days / 7)}w ago`
  return `last active ${Math.floor(days / 30)}mo ago`
}

function Header({
  projectName,
  projectDescription,
  projectDocumentType,
  projectUpdatedAt,
  documentCount,
}: {
  projectName: string
  projectDescription: string | null
  projectDocumentType: string | null
  projectUpdatedAt: string | null
  documentCount: number
}) {
  const stackLabel = prettyDocumentType(projectDocumentType)
  const lastActive = formatLastActive(projectUpdatedAt)
  return (
    <header
      style={{
        padding: '18px 32px 12px',
        borderBottom: '1px solid var(--color-border-subtle)',
      }}
    >
      <BackLink />
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 16 }}>
        <div style={{ minWidth: 0 }}>
          <div
            data-testid="project-title-row"
            style={{
              display: 'flex',
              alignItems: 'baseline',
              gap: 14,
              marginBottom: 6,
              flexWrap: 'wrap',
            }}
          >
            <h1
              data-testid="project-page-title"
              style={{
                fontFamily: 'var(--font-inter), Inter, sans-serif',
                fontWeight: 600,
                fontSize: 24,
                color: 'var(--color-text-primary)',
                margin: 0,
                letterSpacing: '-0.01em',
              }}
            >
              {projectName}
            </h1>
            {/* Inviolable #2 use #11 — document-type identifier chip
                (large stack-badge variant). Verdigris-hover border + text,
                very subtle verdigris-tinted background. */}
            <span
              data-testid="project-stack-badge"
              style={{
                fontFamily: 'ui-monospace, "JetBrains Mono", SFMono-Regular, Menlo, monospace',
                fontSize: 10,
                fontWeight: 500,
                letterSpacing: '0.04em',
                color: 'var(--color-accent-hover)',
                padding: '2px 8px',
                border: '1px solid color-mix(in srgb, var(--color-accent-hover) 40%, transparent)',
                borderRadius: 3,
                background: 'color-mix(in srgb, var(--color-accent) 6%, transparent)',
              }}
            >
              {stackLabel}
            </span>
          </div>
          <div
            data-testid="project-meta"
            style={{
              fontFamily: 'var(--font-inter), Inter, sans-serif',
              fontSize: 12,
              fontWeight: 300,
              color: 'var(--color-text-muted)',
              marginBottom: projectDescription ? 6 : 0,
            }}
          >
            <strong
              data-testid="project-doc-count"
              style={{ color: 'var(--color-text-secondary)', fontWeight: 400 }}
            >
              {documentCount} {documentCount === 1 ? 'document' : 'documents'}
            </strong>
            {lastActive && <> · {lastActive}</>}
          </div>
          {projectDescription && (
            <p
              style={{
                fontFamily: 'var(--font-inter), Inter, sans-serif',
                fontSize: 13,
                color: 'var(--color-text-secondary)',
                margin: '6px 0 0',
              }}
            >
              {projectDescription}
            </p>
          )}
        </div>
      </div>
    </header>
  )
}

function BackLink() {
  return (
    <a
      href="/dashboard"
      style={{
        fontFamily: 'var(--font-inter), Inter, sans-serif',
        fontSize: 11,
        color: 'var(--color-text-muted)',
        textDecoration: 'none',
        display: 'inline-block',
        marginBottom: 14,
      }}
    >
      ← Projects
    </a>
  )
}

interface TabBarProps {
  tab: ProjectTabId
  onSelect: (tab: ProjectTabId) => void
  documentCount?: number
}

function TabBar({ tab, onSelect, documentCount }: TabBarProps) {
  return (
    <nav
      role="tablist"
      aria-label="Project sections"
      data-testid="project-tab-bar"
      style={{
        display: 'flex',
        gap: 0,
        padding: '0 32px',
        borderBottom: '1px solid var(--color-border-subtle)',
      }}
    >
      <TabBtn id="documents" current={tab} onSelect={onSelect} count={documentCount}>
        Documents
      </TabBtn>
      <TabBtn id="export" current={tab} onSelect={onSelect}>
        Export
      </TabBtn>
    </nav>
  )
}

function TabBtn({
  id,
  current,
  onSelect,
  children,
  count,
}: {
  id: ProjectTabId
  current: ProjectTabId
  onSelect: (t: ProjectTabId) => void
  children: ReactNode
  count?: number
}) {
  const active = id === current
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      data-testid={`project-tab-${id}`}
      data-state={active ? 'active' : 'inactive'}
      onClick={() => onSelect(id)}
      style={{
        background: 'transparent',
        border: 0,
        padding: '10px 16px 11px',
        fontFamily: 'var(--font-inter), Inter, sans-serif',
        fontSize: 13,
        fontWeight: active ? 500 : 400,
        color: active ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
        // Active-tab underline at 0.6 opacity of text-primary per Phase 2 lock.
        borderBottom: active
          ? '2px solid color-mix(in srgb, var(--color-text-primary) 60%, transparent)'
          : '2px solid transparent',
        cursor: 'pointer',
        marginBottom: -1,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
      }}
    >
      {children}
      {typeof count === 'number' && (
        <span
          data-testid={`project-tab-${id}-count`}
          style={{
            fontFamily: 'ui-monospace, "JetBrains Mono", SFMono-Regular, Menlo, monospace',
            fontSize: 11,
            fontWeight: 400,
            color: 'var(--color-text-muted)',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {count}
        </span>
      )}
    </button>
  )
}
