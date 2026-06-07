'use client'

// Phase 8.01.D T-10 — Dashboard client shell.
//
// Branches between populated + first-time shapes based on the project
// count. Server component fetches the data; this client component
// wraps the layout because the SampleNovelImportModal needs client-
// side state to open/close.

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import { DashboardSidebar, type SidebarCounts } from '@/components/dashboard/DashboardSidebar'
import { ResumeWritingHero } from '@/components/dashboard/ResumeWritingHero'
import { NeedsAttentionStrip } from '@/components/dashboard/NeedsAttentionStrip'
import { ProjectGrid } from '@/components/dashboard/ProjectGrid'
import { PhilosophyStrip } from '@/components/dashboard/PhilosophyStrip'
import { SampleNovelImportModal } from '@/components/dashboard/SampleNovelImportModal'
import NewProjectDialog from '@/components/projects/NewProjectDialog'

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
  // Phase 8.3 — onboarding fix. The dashboard hoists the New Project
  // dialog state so both EmptyCanvas's "Get started" CTA (previously
  // a no-op preventDefault link) and PopulatedCanvas's new "+ New
  // project" affordance can open the same dialog, and the parent can
  // route the user into the new project on creation.
  const [newProjectOpen, setNewProjectOpen] = useState(false)
  const openImport = () => setImportOpen(true)
  const closeImport = () => setImportOpen(false)
  const openNewProject = () => setNewProjectOpen(true)
  const handleImported = (r: { projectId: string; documentId: string }) => {
    router.push(`/projects/${r.projectId}/documents/${r.documentId}`)
  }
  const handleProjectCreated = (r: { projectId: string }) => {
    // After creating a project, route the user to it. They land on
    // the project page where they can create their first document.
    router.push(`/projects/${r.projectId}`)
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
            <PopulatedCanvas
              resumeTarget={resumeTarget}
              aggregates={aggregates}
              onNewProject={openNewProject}
            />
          ) : (
            <EmptyCanvas onTrySample={openImport} onGetStarted={openNewProject} />
          )}
        </main>
      </div>
      <SampleNovelImportModal open={importOpen} onClose={closeImport} onImported={handleImported} />
      <NewProjectDialog
        open={newProjectOpen}
        onOpenChange={setNewProjectOpen}
        onCreated={handleProjectCreated}
      />
    </>
  )
}

function PopulatedCanvas({
  resumeTarget,
  aggregates,
  onNewProject,
}: {
  resumeTarget: ResumeWritingTarget | null
  aggregates: ProjectAggregate[]
  onNewProject: () => void
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
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 16 }}>
          {/* Phase 8.3 — affordance to create another project from the
              populated dashboard. The empty dashboard has its own
              verdigris "Get started" hero CTA; this is the smaller
              recurring entry point. */}
          <button
            type="button"
            data-testid="dashboard-new-project"
            onClick={onNewProject}
            style={{
              background: 'transparent',
              border: '1px solid var(--color-border-strong)',
              borderRadius: 4,
              padding: '5px 12px',
              color: 'var(--color-text-primary)',
              fontFamily: 'var(--font-inter), Inter, sans-serif',
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            + New project
          </button>
          <span style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>
            {aggregates.length} {aggregates.length === 1 ? 'project' : 'projects'}
          </span>
        </div>
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

function EmptyCanvas({ onTrySample, onGetStarted }: { onTrySample: () => void; onGetStarted: () => void }) {
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
        {/* Phase 8.3 — Get Started now opens the New Project dialog.
            Previously this was a Link with preventDefault — the
            primary onboarding CTA was a no-op since 8.01.D. */}
        <button
          type="button"
          onClick={onGetStarted}
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
            cursor: 'pointer',
          }}
        >
          Get started
        </button>
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
