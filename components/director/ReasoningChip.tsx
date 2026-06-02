'use client'

// Spec: stelavox_component_specification_v2_10.md v2.21 §18.5.
//       stelavox_phase8_01_C_build_checklist_v1_0.md T-2.
//
// Replaces visible <plan>...</plan> blocks in Director responses with a
// collapsed-by-default chip showing "Reasoning · N lines". Tap to expand
// inline; tap again to collapse. Per-message local state — collapsing one
// chip does not affect others.
//
// Inviolable #2: no verdigris. Chip uses neutral border + bg-elevated.
// Inviolable #4: tags + chip use monospace (neither Inter nor Lora — the
//   chip is metadata, not prose, and not structural chrome).

import { useId, useState } from 'react'

interface ReasoningChipProps {
  /** Raw plan body extracted by parseMessageProposals. Already trimmed. */
  text: string
}

function countLines(text: string): number {
  if (!text) return 0
  return text.split('\n').filter((l) => l.length > 0).length
}

export function ReasoningChip({ text }: ReasoningChipProps) {
  const [expanded, setExpanded] = useState(false)
  const panelId = useId()
  const lineCount = countLines(text)
  if (lineCount === 0) return null

  return (
    <div
      data-testid="reasoning-chip"
      data-state={expanded ? 'expanded' : 'collapsed'}
      data-line-count={lineCount}
      style={{
        marginBottom: 10,
        display: expanded ? 'block' : 'inline-flex',
        alignItems: expanded ? undefined : 'center',
      }}
    >
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={() => setExpanded((v) => !v)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '3px 9px',
          background: 'var(--color-bg-elevated)',
          border: '1px solid var(--color-border-subtle)',
          borderRadius: 12,
          fontFamily: 'ui-monospace, "JetBrains Mono", SFMono-Regular, Menlo, monospace',
          fontSize: 11,
          letterSpacing: '0.02em',
          color: 'var(--color-text-muted)',
          cursor: 'pointer',
          // Inherit width but stay compact when collapsed.
        }}
      >
        <span>Reasoning · {lineCount} {lineCount === 1 ? 'line' : 'lines'}</span>
        <span
          aria-hidden="true"
          style={{
            color: 'var(--color-text-muted)',
            transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 150ms ease-out',
            display: 'inline-block',
            fontSize: 10,
          }}
        >
          ▾
        </span>
      </button>
      {expanded && (
        <div
          id={panelId}
          data-testid="reasoning-chip-body"
          style={{
            marginTop: 6,
            padding: '10px 12px',
            background: 'var(--color-bg-elevated)',
            border: '1px solid var(--color-border-subtle)',
            borderRadius: 4,
            fontFamily: 'ui-monospace, "JetBrains Mono", SFMono-Regular, Menlo, monospace',
            fontSize: 12,
            color: 'var(--color-text-muted)',
            lineHeight: 1.5,
            whiteSpace: 'pre-wrap',
          }}
        >
          {text}
        </div>
      )}
    </div>
  )
}
