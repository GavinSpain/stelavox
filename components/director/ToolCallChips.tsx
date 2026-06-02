'use client'

// Spec: stelavox_component_specification_v2_10.md v2.21 §18.5.
//       stelavox_phase8_01_C_build_checklist_v1_0.md T-3.
//
// Compact monospace chips for the tool-call meta line under a Director
// response. Consecutive read-tool runs of ≥3 collapse into a grouped
// chip ("Looked at 5 nodes") that expands inline on tap.
//
// Inviolable #2: no verdigris. Chips use neutral bg-elevated + subtle border.
// A11y: grouped chip is a <button> with aria-expanded; individual chips
// are <span> (decorative — Director tool calls are not author-actionable).

import { useState } from 'react'
import {
  groupToolCalls,
  summarizeCall,
  summarizeGroup,
  type ToolCallChip,
  type ToolCallEntry,
} from '@/lib/director/groupToolCalls'

interface ToolCallChipsProps {
  calls: ToolCallEntry[]
}

const CHIP_BASE = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '3px 8px',
  background: 'var(--color-bg-elevated)',
  border: '1px solid var(--color-border-subtle)',
  borderRadius: 4,
  fontFamily: 'ui-monospace, "JetBrains Mono", SFMono-Regular, Menlo, monospace',
  fontSize: 11,
  color: 'var(--color-text-muted)',
  letterSpacing: '0.02em',
  whiteSpace: 'nowrap' as const,
}

export function ToolCallChips({ calls }: ToolCallChipsProps) {
  if (!calls || calls.length === 0) return null
  const chips = groupToolCalls(calls)
  return (
    <div
      data-testid="tool-call-chips"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        marginTop: 8,
        marginBottom: 8,
      }}
    >
      {chips.map((chip, i) => (
        <ChipRow key={i} chip={chip} />
      ))}
    </div>
  )
}

function ChipRow({ chip }: { chip: ToolCallChip }) {
  const [expanded, setExpanded] = useState(false)
  if (chip.kind === 'single') {
    return (
      <span
        data-testid="tool-call-chip"
        data-tool-name={chip.call.name}
        style={CHIP_BASE}
      >
        {summarizeCall(chip.call)}
      </span>
    )
  }
  // Grouped chip — expandable.
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <button
        type="button"
        data-testid="tool-call-group"
        data-count={chip.calls.length}
        data-state={expanded ? 'expanded' : 'collapsed'}
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
        style={{
          ...CHIP_BASE,
          cursor: 'pointer',
          // Buttons need explicit type styles.
          color: 'var(--color-text-muted)',
        }}
      >
        <span>{summarizeGroup(chip.calls)}</span>
        <span
          aria-hidden="true"
          style={{
            fontSize: 10,
            transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 150ms ease-out',
            display: 'inline-block',
          }}
        >
          ▾
        </span>
      </button>
      {expanded && (
        <div
          data-testid="tool-call-group-body"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
            paddingLeft: 12,
          }}
        >
          {chip.calls.map((call, j) => (
            <span
              key={j}
              data-testid="tool-call-chip"
              data-tool-name={call.name}
              style={CHIP_BASE}
            >
              {summarizeCall(call)}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
