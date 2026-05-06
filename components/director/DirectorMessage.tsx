// Spec: stelavox_component_specification_v2_7.md §7.4 (DirectorMessage)
//       stelavox_phase5b_build_checklist_v1_0.md §3.14 T-14.3
//
// Renders one assistant message. Plan/Execution cards (T-15) mount as
// children — when an assistant message has an associated workflow, the
// caller passes a <PlanCard /> or <ExecutionCard /> as children.

import type { ReactNode } from 'react'

interface DirectorMessageProps {
  content: string
  createdAt: string
  isStreaming?: boolean
  children?: ReactNode
}

function formatTime(iso: string) {
  try {
    const d = new Date(iso)
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
}

// Minimal **bold** → <strong> transformer. Spec §7.4: bold within text is
// Inter 500 --color-text-primary. Anything outside the bold runs is the
// default secondary colour. Markdown is conservative: only `**...**` is
// recognised; backslash-escaped `\*\*` are passed through literally.
function renderInlineBold(text: string): ReactNode[] {
  const out: ReactNode[] = []
  const re = /\*\*([^*\n]+?)\*\*/g
  let last = 0
  let m: RegExpExecArray | null
  let key = 0
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(<span key={key++}>{text.slice(last, m.index)}</span>)
    out.push(
      <strong
        key={key++}
        style={{
          fontWeight: 500,
          color: 'var(--color-text-primary)',
        }}
      >
        {m[1]}
      </strong>,
    )
    last = m.index + m[0].length
  }
  if (last < text.length) out.push(<span key={key++}>{text.slice(last)}</span>)
  return out
}

export function DirectorMessage({
  content,
  createdAt,
  isStreaming = false,
  children,
}: DirectorMessageProps) {
  return (
    <div
      role="article"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        maxWidth: '90%',
        marginBottom: 16,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 8,
          marginBottom: 6,
        }}
      >
        <span
          style={{
            fontFamily: 'var(--font-inter), Inter, sans-serif',
            fontWeight: 500,
            fontSize: 10,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: 'var(--color-text-muted)',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
          }}
        >
          <span aria-hidden="true" style={{ color: 'var(--color-accent)' }}>◆</span>
          Director
        </span>
        <time
          dateTime={createdAt}
          style={{
            fontFamily: 'var(--font-inter), Inter, sans-serif',
            fontWeight: 300,
            fontSize: 10,
            color: 'var(--color-text-muted)',
          }}
        >
          {formatTime(createdAt)}
        </time>
      </div>
      <div
        aria-live={isStreaming ? 'polite' : undefined}
        style={{
          fontFamily: 'var(--font-inter), Inter, sans-serif',
          fontWeight: 400,
          fontSize: 12,
          lineHeight: 1.6,
          color: 'var(--color-text-secondary)',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        {renderInlineBold(content)}
      </div>
      {children ? <div style={{ marginTop: 12, width: '100%' }}>{children}</div> : null}
    </div>
  )
}
