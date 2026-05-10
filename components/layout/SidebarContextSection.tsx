'use client'

// Spec: stelavox_component_specification_v2_5.md §2.3 (Sidebar — Context library)
//       stelavox_phase4_test_plan_v1_0.md TC-V-01..TC-V-03, TC-AX-01, TC-AX-06, TC-M-04
//       stelavox_phase4_build_checklist_v1_0.md §3.4 T-4.2
//
// One collapsible section per V1 context type. Renders a header
// (chevron + label + count + optional [+] button) and a list of rows
// when expanded. The parent Sidebar manages the expanded-state map
// and the data-fetch.

import { type LucideIcon, ChevronDown, ChevronRight, Plus } from 'lucide-react'
import type { ContextNodeType } from '@/lib/context/types'

interface ContextNodeSummary {
  id:      string
  name:    string | null
  scope:   'project' | 'document'
}

interface Props {
  type:           ContextNodeType
  label:          string                  // pluralised label per §2.3
  Icon:           LucideIcon              // Lucide component for the row icon
  expanded:       boolean
  nodes:          ContextNodeSummary[]
  onToggle:       () => void
  onCreateClick:  () => void
  onSelect:       (nodeId: string) => void
}

export function SidebarContextSection({
  type, label, Icon, expanded, nodes, onToggle, onCreateClick, onSelect,
}: Props) {
  const sectionId = `sidebar-section-${type}`
  const Chevron = expanded ? ChevronDown : ChevronRight

  return (
    <div data-testid={`sidebar-section-${type}`}>
      {/* Header — TC-AX-01: a real <button> for the toggle so screen readers
          and axe nested-interactive accept it. The create-+ button sits as a
          sibling, not a descendant, to avoid nested interactive controls. */}
      <div
        className="sidebar-section-header"
        style={{ display: 'flex', alignItems: 'center', borderRadius: '4px' }}
      >
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-controls={sectionId}
          style={{
            display: 'flex',
            alignItems: 'center',
            flex: 1,
            padding: '4px 6px',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            textAlign: 'left',
            font: 'inherit',
            color: 'inherit',
          }}
        >
          <Chevron
            size={12}
            color="var(--color-text-muted)"
            style={{
              flexShrink: 0,
              transition: 'transform var(--duration-fast) var(--easing-smooth)',
            }}
          />
          <span
            style={{
              marginLeft: 6,
              fontSize: 'var(--text-xs)',
              color: 'var(--color-text-muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              flex: 1,
            }}
          >
            {label}
            <span style={{ marginLeft: 6 }}>
              ({nodes.length})
            </span>
          </span>
        </button>
        {/* + button — only visible on hover via CSS sibling rule below */}
        <button
          type="button"
          onClick={onCreateClick}
          aria-label={`Create new ${label.toLowerCase().replace(/s$/, '')}`}
          className="sidebar-section-create"
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--color-text-muted)',
            padding: 2,
            marginRight: 6,
            display: 'flex',
            alignItems: 'center',
            opacity: 0,
            transition: 'opacity var(--duration-fast)',
          }}
        >
          <Plus size={12} />
        </button>
      </div>

      {expanded && (
        <ul
          id={sectionId}
          role="list"
          style={{
            listStyle: 'none',
            margin: 0,
            padding: '2px 0 6px 18px',
            display: 'flex',
            flexDirection: 'column',
            gap: 1,
          }}
        >
          {nodes.length === 0 && (
            <li
              style={{
                fontSize: 'var(--text-xs)',
                color: 'var(--color-text-muted)',
                padding: '4px 6px',
                fontStyle: 'italic',
              }}
            >
              No {label.toLowerCase()} yet.
            </li>
          )}
          {nodes.map(n => (
            <li key={n.id}>
              <button
                type="button"
                onClick={() => onSelect(n.id)}
                style={{
                  width: '100%',
                  background: 'none',
                  border: 'none',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '4px 6px',
                  cursor: 'pointer',
                  borderRadius: 4,
                  color: 'var(--color-text-secondary)',
                  fontFamily: 'var(--font-sans)',
                  fontSize: 'var(--text-xs)',
                  fontWeight: 400,
                  textAlign: 'left',
                }}
                className="sidebar-context-row"
              >
                <Icon
                  size={14}
                  color="var(--color-text-muted)"
                  style={{ flexShrink: 0 }}
                />
                <span
                  style={{
                    flex: 1,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {n.name ?? '(unnamed)'}
                </span>
                {n.scope === 'document' && (
                  <span
                    style={{
                      fontSize: 'var(--text-xs)',
                      color: 'var(--color-text-muted)',
                      letterSpacing: '0.05em',
                    }}
                    title="Document-scoped"
                  >
                    doc
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
