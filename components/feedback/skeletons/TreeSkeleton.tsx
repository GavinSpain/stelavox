'use client'

// Phase 8.5b B.3 — Tree loading skeleton.
//
// Shown while the document's nodes query is loading. Renders N greyed
// rows that visually match the NodeTree's row height + indent rhythm.
//
// Refs: docs/stelavox_document_load_architecture_v1_0.md §3.7.1
//
// Honour prefers-reduced-motion — animation suppressed for users with
// that preference (the rows render in their idle low-contrast state).

interface TreeSkeletonProps {
  /** How many placeholder rows to show. Defaults to 12 (one screenful). */
  rows?: number
}

export function TreeSkeleton({ rows = 12 }: TreeSkeletonProps) {
  return (
    <div
      data-testid="tree-skeleton"
      role="status"
      aria-label="Loading tree"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        padding: '12px 16px',
      }}
    >
      {Array.from({ length: rows }).map((_, i) => (
        <Row key={i} index={i} />
      ))}
    </div>
  )
}

function Row({ index }: { index: number }) {
  // Alternate indentation to suggest tree depth visually.
  const indent = (index % 4) * 16
  const widthPct = 70 - (index % 4) * 8
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        height: 26,
        paddingLeft: indent,
      }}
    >
      <div
        style={{
          width: 6,
          height: 6,
          borderRadius: 1,
          background: 'var(--color-border-default)',
          opacity: 0.6,
        }}
      />
      <div
        style={{
          width: `${widthPct}%`,
          height: 10,
          borderRadius: 2,
          background: 'var(--color-bg-elevated)',
          animation: 'tree-skeleton-pulse 1.6s ease-in-out infinite',
          animationDelay: `${(index % 4) * 0.1}s`,
        }}
      />
      <style jsx>{`
        @keyframes tree-skeleton-pulse {
          0%   { opacity: 0.4; }
          50%  { opacity: 0.7; }
          100% { opacity: 0.4; }
        }
        @media (prefers-reduced-motion: reduce) {
          div { animation: none !important; }
        }
      `}</style>
    </div>
  )
}
