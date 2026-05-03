// Spec: stelavox_component_specification_v2_0.md §4.2 (NodeRow)
//       stelavox_brand_identity_v2_0.md §5.1 (verdigris reservation #9)
//       stelavox_phase2_build_checklist_v1_0.md v1.1 §3.4 T-4.3
//
// 36px row (44px tablet — Phase 2 desktop only). Indent comes from
// react-arborist's `style.paddingLeft`; we MUST NOT override it.
//
// Four states per Component Spec §4.2:
//   default — transparent bg, text-secondary
//   hover   — bg-hover, text-secondary
//   active  — bg-active-node, text-primary Inter 500, 2px LEFT border
//             var(--color-accent) — verdigris reservation #9
//   focused — 1px inset border-strong (keyboard focus)
//
// Hover actions trio — visible only on row hover (opacity transition).
//   - Add child (+)
//   - Agent (⚡) — disabled in Phase 2 (agents arrive Phase 5)
//   - More (⋯)
// Action callbacks come through NodeActionsContext, populated by
// NodeTree in T-4.6/T-4.7.
//
// Locked node: a 🔒 glyph displays at the start of the row instead of
// the chevron's typical position. Drag handle would be hidden in
// drag-and-drop wiring (T-5.x). Per spec, reading is permitted; the
// hover actions are also disabled.
//
// Inviolable #2: `--color-accent` appears in this file at exactly one
// location (the active-state left border). No other usage permitted.

import { createContext, useContext, useState } from 'react'
import type { NodeRendererProps } from 'react-arborist'
import { NodeStatusBadge } from './NodeStatusBadge'

export interface NodeActions {
  onAddChild?: (parentId: string) => void
  onMore?: (nodeId: string, anchor: HTMLElement) => void
}

const NodeActionsContext = createContext<NodeActions>({})
export const NodeActionsProvider = NodeActionsContext.Provider

export interface NodeData {
  id: string
  parent_id: string | null
  document_id: string | null
  project_id: string
  organisation_id: string
  order: number
  depth: number
  layer_index: number | null
  node_type: string
  node_category: string
  name: string | null
  short_description: string | null
  status: string
  locked: boolean
  word_count_target: number | null
  word_count_actual: number | null
  version: number
}

export interface ArboristNode {
  id: string
  name: string
  data: NodeData
  children?: ArboristNode[]
}

export function NodeRow({ node, style, dragHandle }: NodeRendererProps<ArboristNode>) {
  const actions = useContext(NodeActionsContext)
  const [hovered, setHovered] = useState(false)

  const data    = node.data.data
  const isLeaf  = node.isLeaf
  const isOpen  = node.isOpen
  const active  = node.isSelected
  const focused = node.isFocused
  const locked  = data.locked

  // Background priority: active > hover > default. Focused state
  // overlays a 1px inset border, doesn't change bg.
  const background = active
    ? 'var(--color-bg-active-node)'
    : hovered
    ? 'var(--color-bg-hover)'
    : 'transparent'

  const textColour = active ? 'var(--color-text-primary)' : 'var(--color-text-secondary)'
  const fontWeight = active ? 500 : 400

  // Note: react-arborist's outer wrapper already supplies
  // role="treeitem" / aria-expanded / aria-level / aria-selected.
  // We only attach aria-label here to avoid duplicate ARIA.
  return (
    <div
      ref={dragHandle}
      aria-label={`${data.name ?? '(untitled)'}, ${data.status}`}
      onClick={() => node.isInternal ? node.toggle() : node.select()}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        ...style,
        height: '36px',
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        paddingRight: '8px',
        background,
        color: textColour,
        fontSize: 'var(--text-sm)',
        fontWeight,
        cursor: 'pointer',
        // Active state: 2px verdigris left border (reservation #9).
        // Use box-shadow inset so it doesn't shift the row content.
        boxShadow: active
          ? 'inset 2px 0 0 var(--color-accent)'
          : focused
          ? 'inset 0 0 0 1px var(--color-border-strong)'
          : 'none',
      }}
    >
      {/* Chevron — hidden (opacity 0) for leaves to preserve alignment */}
      <span
        aria-hidden="true"
        style={{
          width: '8px',
          textAlign: 'center',
          color: 'var(--color-text-muted)',
          opacity: isLeaf ? 0 : 1,
          transition: 'transform var(--duration-fast)',
          transform: isOpen ? 'rotate(0deg)' : 'rotate(-90deg)',
          fontSize: '10px',
        }}
      >
        ▾
      </span>

      {/* Locked glyph or type-icon placeholder.
          Phase 2 stub: a small dot for unlocked, lock glyph for locked. */}
      <span
        aria-hidden="true"
        style={{
          width: '14px',
          textAlign: 'center',
          color: 'var(--color-text-muted)',
          fontSize: '11px',
          flexShrink: 0,
        }}
      >
        {locked ? '🔒' : '·'}
      </span>

      {/* Name — flex 1, truncate */}
      <span
        style={{
          flex: 1,
          minWidth: 0,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {data.name ?? '(untitled)'}
      </span>

      {/* Status badge */}
      <NodeStatusBadge status={data.status} />

      {/* Hover actions — visible on row hover; disabled when locked.
          opacity transition keeps layout space stable. */}
      <span
        style={{
          display: 'flex',
          gap: '4px',
          opacity: hovered && !locked ? 1 : 0,
          transition: 'opacity var(--duration-fast)',
          flexShrink: 0,
        }}
      >
        <RowActionButton
          aria-label="Add child"
          onClick={(e) => { e.stopPropagation(); actions.onAddChild?.(data.id) }}
          disabled={locked}
          glyph="+"
        />
        <RowActionButton
          aria-label="Agent — available in Phase 5"
          disabled
          glyph="⚡"
        />
        <RowActionButton
          aria-label="More"
          onClick={(e) => { e.stopPropagation(); actions.onMore?.(data.id, e.currentTarget) }}
          disabled={locked}
          glyph="⋯"
        />
      </span>
    </div>
  )
}

interface RowActionButtonProps {
  glyph: string
  disabled?: boolean
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void
  'aria-label': string
}

function RowActionButton({ glyph, disabled, onClick, ...rest }: RowActionButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-label={rest['aria-label']}
      style={{
        height: '22px',
        minWidth: '22px',
        padding: '0 6px',
        border: '1px solid var(--color-border-subtle)',
        borderRadius: '3px',
        background: 'transparent',
        color: 'var(--color-text-muted)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        fontSize: '11px',
        lineHeight: 1,
      }}
    >
      {glyph}
    </button>
  )
}
