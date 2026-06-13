// Spec: stelavox_component_specification_v2_0.md §4.2 (NodeRow)
//       stelavox_brand_identity_v2_0.md §5.1 (verdigris reservation #9)
//       stelavox_phase8_01_A_build_checklist_v1_0.md T-5 (44px universal +
//         bracketed LayerLabel prefix for structural nodes)
//
// Phase 8.01 wireframe-alignment round 2 (Brand Identity v2.4) — NodeRow
// redesigned to match `02_edit_mode_v2_iter3.html` tree rows. Adds:
//   1. Per-layer typographic hierarchy on the name
//      (Series 15px/600 → Beat 12px/300)
//   2. Per-row 46px word-count progress bar + monospace ratio
//   3. Status cluster (lifecycle pill / status badge / agent indicator)
//   4. Hover-actions strip restyled as a compact pill (preserves
//      Add child / Agent / More functional surface)
//
// Four states (Component Spec §4.2):
//   default — transparent bg, layer-typed text colour
//   hover   — bg-hover, hover-actions visible
//   active  — bg-active-node, 2px verdigris LEFT border (use #9)
//   focused — 1px inset border-strong (keyboard focus)
//
// Inviolable #2: `--color-accent` (or `--color-accent-hover`) appears
// in this file at exactly three places:
//   - active-state left border (use #9)
//   - mentioned-node left border (use #9 — second function under the
//     same use; no new category)
//   - `@` mention prefix (use #9 — same use, informational reuse)
// Plus on the word-count progress bar fill (NEW — use #6 family extension
// for "progress toward target" — same conceptual use as the WordCount
// component, just the per-row variant in the tree).

import { createContext, useCallback, useContext, useRef, useState } from 'react'
import { useLongPress } from '@/lib/touch/useLongPress'
import type { NodeRendererProps } from 'react-arborist'
import { NodeStatusBadge } from './NodeStatusBadge'
import { NodeLifecycleBadge, lifecycleFromJobStatus } from './NodeLifecycleBadge'
import { NodeLockIndicator } from './NodeLockIndicator'
import { LayerLabel, type LayerKind } from './LayerLabel'
import { useActiveJobForNode, useNodeHasRunningJob } from '@/lib/hooks/useAgentJobsRealtime'
import { useAiChangedFlag, markNodeAsViewed } from '@/lib/hooks/useAiChangedFlag'
import { useIsNodeMentioned } from '@/lib/stores/mentioned-nodes'

const STRUCTURAL_LAYER_KINDS: ReadonlySet<string> = new Set<LayerKind>([
  'series', 'book', 'act', 'chapter', 'scene', 'beat',
])

/** Per-layer typographic hierarchy on the name column. Pulled directly
 *  from `02_edit_mode_v2_iter3.html` .row-{layer} .row-name selectors.
 *  Exported for unit tests. */
export const LAYER_NAME_TYPOGRAPHY: Record<LayerKind, {
  fontSize: number
  fontWeight: number
  color: string
  letterSpacing?: string
}> = {
  series:  { fontSize: 15,   fontWeight: 600, color: 'var(--color-text-primary)',   letterSpacing: '-0.005em' },
  book:    { fontSize: 14.5, fontWeight: 600, color: 'var(--color-text-primary)',   letterSpacing: '-0.005em' },
  act:     { fontSize: 13.5, fontWeight: 500, color: 'var(--color-text-primary)' },
  chapter: { fontSize: 13,   fontWeight: 500, color: 'var(--color-text-primary)' },
  scene:   { fontSize: 12.5, fontWeight: 400, color: 'var(--color-text-secondary)' },
  beat:    { fontSize: 12,   fontWeight: 300, color: 'var(--color-text-secondary)' },
}

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
  is_leaf?: boolean
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

  const data = node.data.data
  const isLeaf = data.is_leaf ?? node.isLeaf
  const isOpen = node.isOpen
  const active = node.isSelected
  const focused = node.isFocused
  const locked = data.locked
  const isMentioned = useIsNodeMentioned(data.id)

  const background = active
    ? 'var(--color-bg-active-node)'
    : hovered
    ? 'var(--color-bg-hover)'
    : 'transparent'

  // Per-layer typography on the name column.
  const layerKind: LayerKind | null =
    data.node_category === 'structural' && STRUCTURAL_LAYER_KINDS.has(data.node_type)
      ? (data.node_type as LayerKind)
      : null
  const nameTypo = layerKind ? LAYER_NAME_TYPOGRAPHY[layerKind] : {
    fontSize: 12.5,
    fontWeight: 400 as number,
    color: 'var(--color-text-secondary)',
    letterSpacing: undefined as string | undefined,
  }
  // Active state always uses text-primary + weight 500 minimum.
  const nameColor = active ? 'var(--color-text-primary)' : nameTypo.color
  const nameWeight = active ? Math.max(500, nameTypo.fontWeight) : nameTypo.fontWeight

  const didLongPressRef = useRef(false)
  const rowElRef = useRef<HTMLDivElement | null>(null)

  // Merge react-arborist's dragHandle ref with our own rowElRef. Memoised
  // so the ref work isn't analysed as a render-time side effect (the
  // callback only runs at commit). react-arborist types dragHandle as a
  // callback ref — `(el) => void` — so there's no mutable-ref-object case.
  const setRowRef = useCallback(
    (el: HTMLDivElement | null) => {
      dragHandle?.(el)
      rowElRef.current = el
    },
    [dragHandle],
  )

  const longPressHandlers = useLongPress({
    onContextMenu: () => {
      didLongPressRef.current = true
      const el = rowElRef.current
      if (el && actions.onMore) {
        actions.onMore(data.id, el)
      }
    },
  })

  return (
    <div
      ref={setRowRef}
      aria-label={`${data.name ?? '(untitled)'}, ${data.status}`}
      onClick={() => {
        if (didLongPressRef.current) {
          didLongPressRef.current = false
          return
        }
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
        height: '44px',
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        paddingRight: '8px',
        background,
        cursor: 'pointer',
        boxShadow: active
          ? 'inset 2px 0 0 var(--color-accent)'
          : isMentioned
          ? 'inset 2px 0 0 var(--color-accent)'
          : focused
          ? 'inset 0 0 0 1px var(--color-border-strong)'
          : 'none',
      }}
    >
      {/* Chevron */}
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
          flexShrink: 0,
        }}
      >
        ▾
      </span>

      <NodeLockIndicator nodeId={data.id} userLocked={locked} />

      {/* Bracketed monospace LayerLabel prefix for structural nodes. */}
      {layerKind && (
        <LayerLabel
          layer={layerKind}
          position={data.order}
          style={{ marginRight: '2px', flexShrink: 0 }}
        />
      )}

      {/* Name — flex 1, truncate. Per-layer typography. */}
      <span
        data-testid="node-row-name"
        style={{
          flex: 1,
          minWidth: 0,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          fontFamily: 'var(--font-inter), Inter, sans-serif',
          fontSize: `${nameTypo.fontSize}px`,
          fontWeight: nameWeight,
          color: nameColor,
          letterSpacing: nameTypo.letterSpacing,
        }}
      >
        {isMentioned && (
          <span
            aria-hidden="true"
            data-testid="node-row-mention-prefix"
            style={{
              color: 'var(--color-accent)',
              marginRight: 4,
              fontSize: 11,
            }}
          >
            @
          </span>
        )}
        {data.name ?? '(untitled)'}
      </span>

      {/* Word-count column — 46px progress bar + monospace ratio.
          Only rendered when target is set; otherwise nothing (the
          column collapses). */}
      <NodeRowWordCount
        actual={data.word_count_actual ?? 0}
        target={data.word_count_target ?? 0}
      />

      <NodeAiChangedDot nodeId={data.id} lastAiChangeAt={data.last_ai_change_at ?? null} />

      {/* Status cluster — lifecycle badge for active agent jobs +
          status badge for the node itself. */}
      <NodeLifecycle nodeId={data.id} />
      <NodeWithAgentBadge nodeId={data.id} status={data.status} />

      {/* Hover actions — visible on row hover regardless of lock state.
          Wireframe shows Expand / Refine / Comment / Lock; the live
          functional surface is Add child / Agent (Phase 5+) / More.
          Restyled to match the wireframe's compact pill aesthetic.

          Lock-gating is per-button, not per-strip: Add child is
          destructive (mutates structure) so it disables when locked.
          More (⋯) stays enabled when locked because it contains the
          Unlock affordance — gating the whole strip on `!locked`
          would trap the user with no way out via mouse. (Touch
          long-press already bypassed the strip.) */}
      <span
        data-testid="node-row-actions"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 0,
          padding: 2,
          background: hovered ? 'var(--color-bg-selected)' : 'transparent',
          border: hovered
            ? '1px solid var(--color-border-strong)'
            : '1px solid transparent',
          borderRadius: 4,
          opacity: hovered ? 1 : 0,
          pointerEvents: hovered ? 'auto' : 'none',
          transition: 'opacity var(--duration-fast) ease',
          flexShrink: 0,
        }}
      >
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
        height: '20px',
        minWidth: '22px',
        padding: '0 6px',
        border: 0,
        background: 'transparent',
        color: 'var(--color-text-secondary)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        fontSize: '11px',
        lineHeight: 1,
        borderRadius: 2,
      }}
    >
      {glyph}
    </button>
  )
}

/** Per-row 46px word-count progress bar + monospace ratio.
 *  Verdigris-gradient fill (use #4/#6 family — progress toward target,
 *  same conceptual use as WordCount component; per-row variant).
 *
 *  Phase 8.01 round-3 follow-up — no amber over-target colour. Going
 *  over target is often the author's intent (a beat may legitimately
 *  run long); the orange read as "something's wrong" when nothing was.
 *  Bar fill stays verdigris-gradient and ratio text stays neutral
 *  whether or not the actual exceeds the target.
 */
function NodeRowWordCount({ actual, target }: { actual: number; target: number }) {
  if (!target || target <= 0) {
    return <span style={{ width: 130, flexShrink: 0 }} aria-hidden />
  }
  const pct = Math.min(100, Math.round((actual / target) * 100))
  const fmt = new Intl.NumberFormat('en-US')
  return (
    <span
      data-testid="node-row-wc"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        minWidth: 130,
        flexShrink: 0,
      }}
    >
      <span
        data-testid="node-row-wc-bar"
        style={{
          width: 46,
          height: 4,
          background: 'var(--color-border-subtle)',
          borderRadius: 2,
          overflow: 'hidden',
        }}
      >
        <span
          style={{
            display: 'block',
            width: `${pct}%`,
            height: '100%',
            background:
              'linear-gradient(90deg, var(--color-accent) 0%, var(--color-accent-hover) 100%)',
            borderRadius: 2,
          }}
        />
      </span>
      <span
        data-testid="node-row-wc-ratio"
        style={{
          fontFamily: 'ui-monospace, "JetBrains Mono", SFMono-Regular, Menlo, monospace',
          fontSize: 10,
          color: 'var(--color-text-muted)',
          fontVariantNumeric: 'tabular-nums',
          whiteSpace: 'nowrap',
        }}
      >
        {fmt.format(actual)} / {fmt.format(target)}
      </span>
    </span>
  )
}

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

function NodeLifecycle({ nodeId }: { nodeId: string }) {
  const job = useActiveJobForNode(nodeId)
  const lifecycle = lifecycleFromJobStatus(job?.status)
  return <NodeLifecycleBadge state={lifecycle} />
}
