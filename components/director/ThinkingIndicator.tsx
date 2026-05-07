// Spec: stelavox_component_specification_v2_7.md §7.5 (ThinkingIndicator)
//       stelavox_phase5b_build_checklist_v1_0.md §3.14 T-14.4

const dotStyle: React.CSSProperties = {
  width: 5,
  height: 5,
  borderRadius: '50%',
  background: 'var(--color-text-muted)',
  display: 'inline-block',
}

export function ThinkingIndicator({ label = 'Thinking' }: { label?: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={`${label}…`}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 0',
        fontFamily: 'var(--font-inter), Inter, sans-serif',
        fontWeight: 300,
        fontStyle: 'italic',
        fontSize: 12,
        color: 'var(--color-text-muted)',
      }}
    >
      <span aria-hidden="true" style={{ color: 'var(--color-accent)' }}>◆</span>
      <span>{label}</span>
      <span aria-hidden="true" style={{ display: 'inline-flex', gap: 4, marginLeft: 2 }}>
        <span className="sv-thinking-dot" style={{ ...dotStyle, animationDelay: '0s' }} />
        <span className="sv-thinking-dot" style={{ ...dotStyle, animationDelay: '0.2s' }} />
        <span className="sv-thinking-dot" style={{ ...dotStyle, animationDelay: '0.4s' }} />
      </span>
      <style>{`
        @keyframes sv-thinking-pulse {
          0%, 100% { opacity: 0.3; }
          50%      { opacity: 1; }
        }
        .sv-thinking-dot {
          opacity: 0.3;
          animation: sv-thinking-pulse 1.2s ease-in-out infinite;
        }
        @media (prefers-reduced-motion: reduce) {
          .sv-thinking-dot {
            animation: none;
            opacity: 0.6;
          }
        }
      `}</style>
    </div>
  )
}
