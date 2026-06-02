'use client'

// Phase 8.01.E T-1 — ProjectPage client wrapper.
//
// Owns the tab-strip state (URL-driven `?tab=`) and renders the
// Documents tab or Export tab body. Documents tab body is the existing
// project-page experience refactored into the new shape; Export tab is
// the OQ-1 (b) document picker — lists documents with per-row Export
// buttons that open the existing per-document ExportModal (Phase 7).

import { useRouter, useSearchParams } from 'next/navigation'
import { useMemo, type ReactNode } from 'react'

import { LayerLabel } from '@/components/tree/LayerLabel'
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
}

interface ProjectPageClientProps {
  projectId: string
  projectName: string
  projectDescription: string | null
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
  documents,
}: ProjectPageClientProps) {
  const router = useRouter()
  const search = useSearchParams()
  const tab: ProjectTabId = resolveProjectTab(search?.get('tab'))

  const selectTab = (next: ProjectTabId) => {
    const url = next === 'documents' ? `/projects/${projectId}` : `/projects/${projectId}?tab=${next}`
    router.push(url)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <Header
        projectId={projectId}
        projectName={projectName}
        projectDescription={projectDescription}
        documentCount={documents.length}
      />
      <TabBar tab={tab} onSelect={selectTab} />
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

function Header({
  projectId,
  projectName,
  projectDescription,
  documentCount,
}: {
  projectId: string
  projectName: string
  projectDescription: string | null
  documentCount: number
}) {
  return (
    <header
      style={{
        padding: '24px 32px 12px',
        borderBottom: '1px solid var(--color-border-subtle)',
      }}
    >
      <BackLink />
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 16 }}>
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              marginBottom: 6,
              fontFamily: 'var(--font-inter), Inter, sans-serif',
              fontSize: 11,
              color: 'var(--color-text-muted)',
              letterSpacing: '0.02em',
            }}
          >
            <LayerLabel layer="book" position={1} />
            <span style={{ color: 'var(--color-text-faint)' }}>·</span>
            <span data-testid="project-doc-count">
              {documentCount} {documentCount === 1 ? 'document' : 'documents'}
            </span>
          </div>
          <h1
            data-testid="project-page-title"
            style={{
              fontFamily: 'var(--font-inter), Inter, sans-serif',
              fontWeight: 500,
              fontSize: 22,
              color: 'var(--color-text-primary)',
              margin: 0,
              letterSpacing: '-0.01em',
            }}
          >
            {projectName}
          </h1>
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
}

function TabBar({ tab, onSelect }: TabBarProps) {
  return (
    <nav
      role="tablist"
      aria-label="Project sections"
      data-testid="project-tab-bar"
      style={{
        display: 'flex',
        gap: 24,
        padding: '0 32px',
        borderBottom: '1px solid var(--color-border-subtle)',
      }}
    >
      <TabBtn id="documents" current={tab} onSelect={onSelect}>Documents</TabBtn>
      <TabBtn id="export"    current={tab} onSelect={onSelect}>Export</TabBtn>
    </nav>
  )
}

function TabBtn({
  id,
  current,
  onSelect,
  children,
}: {
  id: ProjectTabId
  current: ProjectTabId
  onSelect: (t: ProjectTabId) => void
  children: ReactNode
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
        padding: '12px 0',
        fontFamily: 'var(--font-inter), Inter, sans-serif',
        fontSize: 13,
        color: active ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
        // Active-tab underline at 0.6 opacity of text-primary per Phase 2 lock.
        borderBottom: active
          ? '2px solid color-mix(in srgb, var(--color-text-primary) 60%, transparent)'
          : '2px solid transparent',
        cursor: 'pointer',
        marginBottom: -1,
      }}
    >
      {children}
    </button>
  )
}
