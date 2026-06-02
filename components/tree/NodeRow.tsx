// Spec: stelavox_component_specification_v2_0.md §4.2 (NodeRow)
//       stelavox_brand_identity_v2_0.md §5.1 (verdigris reservation #9)
//       stelavox_phase2_build_checklist_v1_0.md v1.1 §3.4 T-4.3
//       stelavox_phase8_01_A_build_checklist_v1_0.md T-5 (44px universal +
//         bracketed LayerLabel prefix for structural nodes)
//
// Phase 8.01.A T-5: row height moves from "36px desktop, 44px tablet" to
// **44px universal** per Component Spec v2.21 §4.2 wireframe lock (desktop
// loses no functional density, gains tap-friendliness). Structural rows
// now carry a bracketed monospace LayerLabel prefix sourced from the
// node's `node_type` + `order`.
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

import { createContext, useContext, useRef, useState } from 'react'
import { useLongPress } from '@/lib/touch/useLongPress'
import type { NodeRendererProps } from 'react-arborist'
import { NodeStatusBadge } from './NodeStatusBadge'
import { NodeLifecycleBadge, lifecycleFromJobStatus } from './NodeLifecycleBadge'
import { NodeLockIndicator } from './NodeLockIndicator'
import { LayerLabel, type LayerKind } from './LayerLabel'
import { useActiveJobForNode, useNodeHasRunningJob } from '@/lib/hooks/useAgentJobsRealtime'
import { useAiChangedFlag, markNodeAsViewed } from '@/lib/hooks/useAiChangedFlag'
import { useIsNodeMentioned } from '@/lib/stores/mentioned-nodes'

// V1 layer-stack canonical structural types — the abbreviation map in
// LayerLabel covers exactly these. Anything not in this set falls through
// to LayerLabel's defensive title-case fallback. Phase 14 (post-V1)
// replaces this guard with layer_stack-driven type validation.
const STRUCTURAL_LAYER_KINDS: ReadonlySet<string> = new Set<LayerKind>([
  'series', 'book', 'act', 'chapter', 'scene', 'beat',
])

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
  // Phase 3 v1.1: server-derived per API Contract §2.12 / TA v1.6 H-15.
  // Hides the `+ Add child` button so the UI mirrors the database's
  // move_node layer_violation refusal. Optional for backwards compat with
  // any caller that hasn't been re-fetched against the v1.1 API.
  is_leaf?: boolean
  // V1.x-D.2 (Migration 142) — set by accept_agent_job when AI content
  // replaces the node. NodeRow compares this to localStorage's
  // last-viewed-at per node to surface the AI-changed flag.
  last_ai_change_at?: string | null
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
  // SU-J12-4 (Mars-drive 2026-05-09): the chevron must reflect the
  // server-derived layer-stack leaf-ness (`data.is_leaf`), not react-
  // arborist's structural `node.isLeaf` which is purely a function of
  // currently-loaded children. A Book with zero Acts is still a parent
  // layer, and authors must see the chevron to know they can expand.
  // H-15: leaf-ness is a layer-stack property, never inferred from
  // child count. Falls back to node.isLeaf for backwards compat with
  // any data path that hasn't supplied is_leaf yet.
  const isLeaf  = data.is_leaf ?? node.isLeaf
  const isOpen  = node.isOpen
  const active  = node.isSelected
  const focused = node.isFocused
  const locked  = data.locked
  // Phase 8.01.C T-8 — mentioned-node highlight. Reuses Inviolable #2
  // use #9 (active-node left border) via the same verdigris token; this
  // is a second function under the existing use, NO new use category.
  // Active state takes precedence over mentioned (active node always wins
  // the bg + bold + border treatment).
  const isMentioned = useIsNodeMentioned(data.id)

  // Background priority: active > hover > default. Focused state
  // overlays a 1px inset border, doesn't change bg.
  const background = active
    ? 'var(--color-bg-active-node)'
    : hovered
    ? 'var(--color-bg-hover)'
    : 'transparent'

  const textColour = active ? 'var(--color-text-primary)' : 'var(--color-text-secondary)'
  const fontWeight = active ? 500 : 400

  // Phase 8.01.F T-9 — touch long-press → row More menu.
  // The 800ms context-menu timer opens the same menu the desktop "More"
  // (⋯) button opens. The 350ms drag timer is wired but react-arborist's
  // drag mechanism is mouse-based; touch-initiated drag falls back to
  // long-press → context-menu → use the existing menu actions. Real
  // touch-drag is a Phase 8.x polish item.
  const didLongPressRef = useRef(false)
  const rowElRef = useRef<HTMLDivElement | null>(null)
  const longPressHandlers = useLongPress({
    onContextMenu: () => {
      didLongPressRef.current = true
      const el = rowElRef.current
      if (el && actions.onMore) {
        actions.onMore(data.id, el)
      }
    },
  })

  // Note: react-arborist's outer wrapper already supplies
  // role="treeitem" / aria-expanded / aria-level / aria-selected.
  // We only attach aria-label here to avoid duplicate ARIA.
  return (
    <div
      ref={(el) => {
        // Capture both refs — react-arborist's drag handle + our own for
        // anchoring the context menu on touch long-press.
        if (typeof dragHandle === 'function') dragHandle(el)
        else if (dragHandle) (dragHandle as { current: HTMLDivElement | null }).current = el
        rowElRef.current = el
      }}
      aria-label={`${data.name ?? '(untitled)'}, ${data.status}`}
      onClick={() => {
        // Phase 8.01.F T-9: ignore the synthetic click that fires after
        // a long-press → context-menu sequence.
        if (didLongPressRef.current) {
          didLongPressRef.current = false
          return
        }
        // V1.x-D.2: any interaction with the row counts as a view —
        // clears the AI-changed dot (read-receipt model). Behaviour
        // unchanged for internal vs leaf node selection.
        markNodeAsViewed(data.id)
        if (node.isInternal) {
          node.toggle()
        } else {
          node.select()
        }
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onPointerDown={longPressHandlers.onPointerDown}
      onPointerMove={longPressHandlers.onPointerMove}
      onPointerUp={longPressHandlers.onPointerUp}
      onPointerCancel={longPressHandlers.onPointerCancel}
      style={{
        ...style,
        // Phase 8.01.A T-5: 44px universal (was "36px desktop, 44px tablet").
        // Component Spec v2.21 §4.2 wireframe lock.
        height: '44px',
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
        // Phase 8.01.C T-8 — mentioned-node also paints the verdigris
        // left border (same verdigris use #9; second function under the
        // existing use category; no Inviolable broadening). Active wins
        // when both are true (visual priority).
        boxShadow: active
          ? 'inset 2px 0 0 var(--color-accent)'
          : isMentioned
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
          User lock: 🔒 in --color-text-muted (existing convention).
          V1.x-D.2: auto-lock — when an agent_job is queued or running
          on this node, show 🔒 in --color-info with a small clock
          overlay to disambiguate from user-lock (Component Spec §17.8). */}
      <NodeLockIndicator nodeId={data.id} userLocked={locked} />

      {/* Phase 8.01.A T-5.1: bracketed monospace LayerLabel prefix for
          structural nodes. Context nodes (characters, locations, themes,
          etc.) render without a label — they have no canonical position
          in the hierarchy. */}
      {data.node_category === 'structural' && STRUCTURAL_LAYER_KINDS.has(data.node_type) && (
        <LayerLabel
          layer={data.node_type as LayerKind}
          position={data.order}
          style={{ marginRight: '2px' }}
        />
      )}

      {/* Name — flex 1, truncate. Phase 8.01.C T-8: `@` prefix when this
          node is referenced by an active mention in DirectorInput.
          The prefix uses --color-accent (verdigris use #9 — same use as
          the active-node left border and the mentioned-node left border;
          informational reuse, no new use category). */}
      <span
        style={{
          flex: 1,
          minWidth: 0,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {isMentioned && (
          <span
            aria-hidden="true"
            data-testid="node-row-mention-prefix"
            style={{
              color: 'var(--color-accent)',
              marginRight: 4,
              fontFamily: 'var(--font-inter), Inter, sans-serif',
              fontSize: 11,
            }}
          >
            @
          </span>
        )}
        {data.name ?? '(untitled)'}
      </span>

      {/* V1.x-D.2 — AI-changed flag. Small dot in --color-info when the
          node has been AI-changed since the author last viewed it on
          this device (Component Spec §17.8). */}
      <NodeAiChangedDot nodeId={data.id} lastAiChangeAt={data.last_ai_change_at ?? null} />

      {/* V1.x-D.2 — Lifecycle badge for active or completed-pending agent_jobs
          (Component Spec §17.8). Renders alongside the status badge below. */}
      <NodeLifecycle nodeId={data.id} />

      {/* Status badge — replaced by AgentActivityIndicator-styled spinner
          when a pending/running agent job targets this node (Phase 5,
          Component Spec §4.4). */}
      <NodeWithAgentBadge nodeId={data.id} status={data.status} />

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
        {/* `+ Add child` is hidden on leaves so the UI mirrors the DB's
            move_node layer_violation refusal (Migration 021). Component
            Spec v2.2 §4.2 + TA v1.6 H-15. */}
        {!data.is_leaf && (
          <RowActionButton
            aria-label="Add child"
            onClick={(e) => { e.stopPropagation(); actions.onAddChild?.(data.id) }}
            disabled={locked}
            glyph="+"
          />
        )}
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

/**
 * Wrapper that swaps NodeStatusBadge for the AgentActivityIndicator pulse
 * when an agent job is actively running on this node. Per Component Spec
 * §4.4: type icon (proxied here by the status badge container) opacity
 * pulses 1 → 0.4 → 1 over 2s ease-in-out infinite.
 *
 * Falls through to the standard NodeStatusBadge when no job is active.
 */
function NodeWithAgentBadge({ nodeId, status }: { nodeId: string; status: string }) {
  const hasRunningJob = useNodeHasRunningJob(nodeId)
  if (hasRunningJob) {
    return (
      <span
        aria-label="agent running on this node"
        className="agent-activity-pulse"
        style={{
          display: 'inline-block',
          width: '8px',
          height: '8px',
          borderRadius: '50%',
          background: 'var(--color-agent-running)',
          flexShrink: 0,
        }}
      />
    )
  }
  return <NodeStatusBadge status={status} />
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

/**
 * V1.x-D.2 — small dot rendered before the status badge when the node
 * has been AI-changed since the author last viewed it on this device.
 * Uses --color-info (neutral teal — attention without alarm).
 * Component Spec §17.8. Cleared by markNodeAsViewed() on row click.
 */
function NodeAiChangedDot({
  nodeId,
  lastAiChangeAt,
}: {
  nodeId: string
  lastAiChangeAt: string | null
}) {
  const aiChanged = useAiChangedFlag(nodeId, lastAiChangeAt)
  if (!aiChanged) return null
  return (
    <span
      data-testid="node-ai-changed"
      aria-label="AI changed this node since you last viewed it"
      title="AI changed this node since you last viewed it"
      style={{
        display: 'inline-block',
        width: 6,
        height: 6,
        borderRadius: '50%',
        background: 'var(--color-info)',
        flexShrink: 0,
        marginRight: 2,
      }}
    />
  )
}

/**
 * V1.x-D.2 — Lifecycle badge mounted in NodeRow when the node has an
 * active or recently-completed agent_job. See NodeLifecycleBadge.tsx
 * for the visual spec.
 */
function NodeLifecycle({ nodeId }: { nodeId: string }) {
  const job = useActiveJobForNode(nodeId)
  const lifecycle = lifecycleFromJobStatus(job?.status)
  return <NodeLifecycleBadge state={lifecycle} />
}
