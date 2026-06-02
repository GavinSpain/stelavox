'use client'

// Phase 8.01.D T-10 — Dashboard client shell.
//
// Branches between populated + first-time shapes based on the project
// count. Server component fetches the data; this client component
// wraps the layout because the SampleNovelImportModal needs client-
// side state to open/close.

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

import { DashboardSidebar, type SidebarCounts } from '@/components/dashboard/DashboardSidebar'
import { ResumeWritingHero } from '@/components/dashboard/ResumeWritingHero'
import { NeedsAttentionStrip } from '@/components/dashboard/NeedsAttentionStrip'
import { ProjectGrid } from '@/components/dashboard/ProjectGrid'
import { PhilosophyStrip } from '@/components/dashboard/PhilosophyStrip'
import { SampleNovelImportModal } from '@/components/dashboard/SampleNovelImportModal'

import type { ResumeWritingTarget } from '@/lib/dashboard/resumeWriting'
import type { ProjectAggregate } from '@/lib/dashboard/projectAggregates'
import type { QuickStartCompletion } from '@/lib/dashboard/quickStartCompletion'

interface DashboardClientProps {
  shape: 'populated' | 'first-time'
  resumeTarget: ResumeWritingTarget | null
  aggregates: ProjectAggregate[]
  sidebarCounts: SidebarCounts
  quickStart: QuickStartCompletion
}

export function DashboardClient({
  shape,
  resumeTarget,
  aggregates,
  sidebarCounts,
  quickStart,
}: DashboardClientProps) {
  const router = useRouter()
  const [importOpen, setImportOpen] = useState(false)
  const openImport = () => setImportOpen(true)
  const closeImport = () => setImportOpen(false)
  const handleImported = (r: { projectId: string; documentId: string }) => {
    router.push(`/projects/${r.projectId}/documents/${r.documentId}`)
  }

  return (
    <>
      <div
        style={{
          display: 'flex',
          flex: 1,
          minHeight: 0,
          width: '100%',
        }}
      >
        <DashboardSidebar
          shape={shape}
          counts={sidebarCounts}
          quickStart={quickStart}
          onTrySample={openImport}
        />
        <main
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '28px 32px',
            display: 'flex',
            flexDirection: 'column',
            gap: 24,
          }}
        >
          {shape === 'populated' ? (
            <PopulatedCanvas resumeTarget={resumeTarget} aggregates={aggregates} />
          ) : (
            <EmptyCanvas onTrySample={openImport} />
          )}
        </main>
      </div>
      <SampleNovelImportModal open={importOpen} onClose={closeImport} onImported={handleImported} />
    </>
  )
}

function PopulatedCanvas({
  resumeTarget,
  aggregates,
}: {
  resumeTarget: ResumeWritingTarget | null
  aggregates: ProjectAggregate[]
}) {
  return (
    <>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
        }}
      >
        <h2
          style={{
            fontFamily: 'var(--font-inter), Inter, sans-serif',
            fontWeight: 500,
            fontSize: 22,
            color: 'var(--color-text-primary)',
            margin: 0,
            letterSpacing: '-0.01em',
          }}
        >
          All projects
        </h2>
        <span style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>
          {aggregates.length} {aggregates.length === 1 ? 'project' : 'projects'}
        </span>
      </div>
      {(resumeTarget || true) && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1fr) 320px',
            gap: 20,
          }}
        >
          {resumeTarget ? (
            <ResumeWritingHero target={resumeTarget} />
          ) : (
            <div /> // empty placeholder cell so the grid stays even
          )}
          <NeedsAttentionStrip />
        </div>
      )}
      <ProjectGrid aggregates={aggregates} />
    </>
  )
}

function EmptyCanvas({ onTrySample }: { onTrySample: () => void }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '36px 32px',
      }}
    >
      <div
        data-testid="empty-hero"
        style={{
          maxWidth: 640,
          textAlign: 'center',
          marginTop: 16,
          marginBottom: 24,
        }}
      >
        <h1
          style={{
            fontFamily: 'var(--font-inter), Inter, sans-serif',
            fontWeight: 400,
            fontSize: 26,
            color: 'var(--color-text-primary)',
            margin: '0 0 12px',
            letterSpacing: '-0.02em',
          }}
        >
          Welcome to Stelavox.
        </h1>
        <p
          style={{
            fontFamily: 'var(--font-lora), Lora, Georgia, serif',
            fontSize: 15,
            fontStyle: 'italic',
            color: 'var(--color-text-secondary)',
            lineHeight: 1.55,
            margin: 0,
          }}
        >
          A hierarchical writing workspace where structure stays in your hands and AI helps where you ask it to.
        </p>
      </div>
      <div style={{ display: 'flex', gap: 14, margin: '18px 0 28px' }}>
        <Link
          href="/dashboard"
          data-testid="empty-get-started"
          style={{
            background: 'var(--color-accent)',
            border: 0,
            borderRadius: 6,
            padding: '12px 22px',
            color: 'var(--color-bg-base)',
            fontFamily: 'var(--font-inter), Inter, sans-serif',
            fontSize: 13.5,
            fontWeight: 500,
            textDecoration: 'none',
          }}
          onClick={(e) => {
            // For V1 the "Get started" CTA opens the New Project dialog. Until
            // we wire that here, fall back to a no-op (the link still routes
            // to /dashboard which is the current page) so the button is
            // never broken.
            e.preventDefault()
          }}
        >
          Get started
        </Link>
        <button
          type="button"
          onClick={onTrySample}
          data-testid="empty-try-sample"
          style={{
            background: 'transparent',
            border: '1px solid var(--color-border-strong)',
            borderRadius: 6,
            padding: '11px 22px',
            color: 'var(--color-text-primary)',
            fontFamily: 'var(--font-inter), Inter, sans-serif',
            fontSize: 13.5,
            fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          Try the sample novel
        </button>
      </div>
      <PhilosophyStrip />
    </div>
  )
}
