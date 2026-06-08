'use client'

// Phase 8.5b B.3 — Detail panel loading skeleton.
//
// Shown while a node's single-record query is loading. Mirrors the
// detail-panel's header strip + summary + content block layout.
//
// Refs: docs/stelavox_document_load_architecture_v1_0.md §3.7.1
//       components/detail/NodeDetailPanel.tsx (target layout)

export function DetailPanelSkeleton() {
  return (
    <div
      data-testid="detail-panel-skeleton"
      role="status"
      aria-label="Loading node"
      style={{
        display: 'flex',
        flexDirection: 'column',
        padding: '20px 28px',
        gap: 16,
      }}
    >
      {/* Header strip — name + status chip */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <Bar width="40%" height={20} />
        <Bar width={60} height={16} />
      </div>
      {/* Meta strip — short description */}
      <Bar width="65%" height={11} />
      {/* Summary block */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
        <Bar width="100%" height={11} />
        <Bar width="92%" height={11} />
        <Bar width="74%" height={11} />
      </div>
      {/* Content block */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
        <Bar width="100%" height={11} />
        <Bar width="95%" height={11} />
        <Bar width="98%" height={11} />
        <Bar width="80%" height={11} />
      </div>
      <style jsx>{`
        @keyframes detail-skeleton-pulse {
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

function Bar({ width, height }: { width: string | number; height: number }) {
  return (
    <div
      style={{
        width: typeof width === 'number' ? `${width}px` : width,
        height,
        borderRadius: 2,
        background: 'var(--color-bg-elevated)',
        animation: 'detail-skeleton-pulse 1.6s ease-in-out infinite',
      }}
    />
  )
}
