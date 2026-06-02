'use client'

// Phase 8.01.D T-6 — ProjectCard.
//
// Single card in the ProjectGrid. Reads ProjectAggregate from the
// per-project aggregates helper. Renders the SAMPLE badge when
// metadata.is_sample is true (OQ-3 lock).

import Link from 'next/link'
import type { ProjectAggregate } from '@/lib/dashboard/projectAggregates'

interface ProjectCardProps {
  aggregate: ProjectAggregate
}

function formatRelative(iso: string | null): string {
  if (!iso) return 'No activity yet'
  const then = new Date(iso).getTime()
  const now = Date.now()
  const deltaSec = Math.max(0, Math.round((now - then) / 1000))
  if (deltaSec < 60) return `Last: just now`
  if (deltaSec < 3600) return `Last: ${Math.floor(deltaSec / 60)}m ago`
  if (deltaSec < 86_400) return `Last: ${Math.floor(deltaSec / 3600)}h ago`
  const days = Math.floor(deltaSec / 86_400)
  return `Last: ${days} day${days === 1 ? '' : 's'} ago`
}

export function ProjectCard({ aggregate }: ProjectCardProps) {
  const pct =
    aggregate.wordsTarget > 0
      ? Math.min(100, Math.round((aggregate.wordsDrafted / aggregate.wordsTarget) * 100))
      : 0
  const fmt = new Intl.NumberFormat('en-US')
  return (
    <Link
      href={`/projects/${aggregate.projectId}`}
      data-testid="project-card"
      data-project-id={aggregate.projectId}
      data-is-sample={aggregate.isSample ? 'true' : 'false'}
      style={{
        display: 'block',
        background: 'var(--color-bg-elevated)',
        border: '1px solid var(--color-border-subtle)',
        borderRadius: 8,
        padding: 18,
        textDecoration: 'none',
        color: 'inherit',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
        <h3
          style={{
            fontFamily: 'var(--font-inter), Inter, sans-serif',
            fontWeight: 500,
            fontSize: 15,
            color: 'var(--color-text-primary)',
            margin: 0,
          }}
        >
          {aggregate.projectName}
        </h3>
        {aggregate.isSample && (
          <span
            data-testid="sample-badge"
            style={{
              fontFamily: 'ui-monospace, "JetBrains Mono", SFMono-Regular, Menlo, monospace',
              fontSize: 9.5,
              padding: '1px 4px',
              border: '1px solid var(--color-border-default)',
              borderRadius: 3,
              color: 'var(--color-text-muted)',
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
            }}
          >
            sample
          </span>
        )}
      </div>
      <div
        style={{
          fontFamily: 'ui-monospace, "JetBrains Mono", SFMono-Regular, Menlo, monospace',
          fontSize: 10.5,
          letterSpacing: '0.04em',
          color: 'var(--color-text-muted)',
          marginBottom: 12,
        }}
      >
        {aggregate.layerStackLabel}
      </div>
      <div
        style={{
          fontFamily: 'var(--font-inter), Inter, sans-serif',
          fontSize: 11.5,
          color: 'var(--color-text-secondary)',
          marginBottom: 4,
        }}
      >
        <strong style={{ color: 'var(--color-text-primary)', fontWeight: 500 }}>{pct}%</strong>
        {' drafted · '}
        {fmt.format(aggregate.wordsDrafted)} / {fmt.format(aggregate.wordsTarget)} words
      </div>
      <div
        style={{
          width: '100%',
          height: 4,
          background: 'var(--color-bg-base)',
          borderRadius: 2,
          overflow: 'hidden',
          marginBottom: 12,
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: '100%',
            background: 'var(--color-text-faint)',
          }}
        />
      </div>
      <div
        style={{
          display: 'flex',
          gap: 12,
          fontFamily: 'ui-monospace, "JetBrains Mono", SFMono-Regular, Menlo, monospace',
          fontSize: 10.5,
          color: 'var(--color-text-muted)',
        }}
      >
        <span>{aggregate.documentCount} doc{aggregate.documentCount === 1 ? '' : 's'}</span>
        <span>{formatRelative(aggregate.lastUpdatedAt)}</span>
      </div>
    </Link>
  )
}
