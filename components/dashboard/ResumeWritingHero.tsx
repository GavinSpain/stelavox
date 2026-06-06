'use client'

// Phase 8.01.D T-3 — Resume Writing hero.
//
// Spec: Component Spec v2.21 §18.4 Dashboard populated shape.
//       Wireframe iter4 Section 01 ("RESUME WRITING" card).
//
// Inviolable #2: no verdigris. "Continue writing →" is neutral ghost
// (passive return action, NOT use #7 affirmative-action category — that
// category is for committing user-driven action against agent proposals).

import Link from 'next/link'
import { LayerLabel } from '@/components/tree/LayerLabel'
import type { ResumeWritingTarget } from '@/lib/dashboard/resumeWriting'

interface ResumeWritingHeroProps {
  target: ResumeWritingTarget
}

export function ResumeWritingHero({ target }: ResumeWritingHeroProps) {
  // OQ-5: deep-link with ?selectedNode={nodeId} per Phase 8.01.D lock.
  const href = `/projects/${target.projectId}/documents/${target.documentId}?selectedNode=${target.nodeId}`
  const fullChain = [...target.layerChain, target.leafLayer]
  return (
    <div
      data-testid="resume-writing-hero"
      style={{
        background: 'var(--color-bg-elevated)',
        border: '1px solid var(--color-border-subtle)',
        borderRadius: 8,
        padding: '18px 20px',
      }}
    >
      <div
        style={{
          fontFamily: 'ui-monospace, "JetBrains Mono", SFMono-Regular, Menlo, monospace',
          fontSize: 10.5,
          letterSpacing: '0.06em',
          color: 'var(--color-text-muted)',
          marginBottom: 8,
        }}
      >
        RESUME WRITING
      </div>
      <div
        style={{
          fontFamily: 'var(--font-inter), Inter, sans-serif',
          fontWeight: 500,
          fontSize: 17,
          color: 'var(--color-text-primary)',
          marginBottom: 6,
        }}
      >
        {target.projectName}
      </div>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 6,
          alignItems: 'center',
          marginBottom: 12,
        }}
      >
        {fullChain.map((seg, i) => (
          <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <LayerLabel layer={seg.layer} position={seg.position} />
            {i < fullChain.length - 1 && (
              <span style={{ color: 'var(--color-text-faint)', fontSize: 11 }}>·</span>
            )}
          </span>
        ))}
      </div>
      {/* Phase 8.01 wireframe-alignment round 3 — label set in caps
          mono per wireframe `.hero-current .last-beat-label`. */}
      <div
        data-testid="resume-writing-last-beat-label"
        style={{
          fontFamily: 'ui-monospace, "JetBrains Mono", SFMono-Regular, Menlo, monospace',
          fontSize: 10,
          color: 'var(--color-text-muted)',
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          marginBottom: 6,
        }}
      >
        LAST BEAT{target.nodeName ? ` · ${target.nodeName}` : ''}
      </div>
      <div
        data-testid="resume-writing-prose"
        style={{
          fontFamily: 'var(--font-lora), Lora, Georgia, serif',
          fontSize: 14,
          lineHeight: 1.7,
          color: 'var(--color-text-primary)',
          padding: '12px 14px',
          background: 'var(--color-bg-base)',
          border: '1px solid var(--color-border-subtle)',
          borderRadius: 6,
          margin: '8px 0 12px',
        }}
      >
        {target.proseExcerpt}
      </div>
      <Link
        href={href}
        data-testid="resume-writing-continue"
        style={{
          display: 'inline-block',
          background: 'transparent',
          border: '1px solid var(--color-border-strong)',
          borderRadius: 6,
          padding: '8px 14px',
          color: 'var(--color-text-primary)',
          fontFamily: 'var(--font-inter), Inter, sans-serif',
          fontSize: 12,
          textDecoration: 'none',
        }}
      >
        Continue writing →
      </Link>
    </div>
  )
}
