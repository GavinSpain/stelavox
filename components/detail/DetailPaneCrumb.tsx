'use client'

// Phase 8.01.E T-6 — Detail pane crumb (closes 8.01.A T-7 deferral).
//
// Spec: Component Spec v2.21 §5.2 (tappable bracketed crumb in detail
//       header) + §18.1 (bracketed monospace label vocabulary).
//
// Mounted in the NodeDetailPanel header (T-7). Renders root→parent
// segments as tappable buttons; the final segment (the active node's
// own bracketed label) is non-tappable per Phase 8.01.E lock.
//
// OQ-2 lock: root nodes (empty ancestor chain) still render their own
// single bracketed segment for orientation.
// OQ-4 lock: context nodes (no ancestor chain) render a single bracketed
// `[Character]` / `[Location]` / etc. label as a non-clickable
// orientation marker. node_type provides the bracket text directly.
//
// Inviolable #2: no verdigris. Tappable segments are transparent buttons
// wrapping the existing LayerLabel; navigation is read-only, not
// affirmative-action — does NOT fall under use #7.

import { useEffect, useState } from 'react'

import { LayerLabel, type LayerKind, LAYER_ABBR } from '@/components/tree/LayerLabel'
import { getAncestorChain } from '@/lib/nodes/getAncestorChain'
import type { FocusBreadcrumbSegment } from '@/components/focus/FocusBreadcrumb'
import { createClient } from '@/lib/supabase/client'

interface DetailPaneCrumbProps {
  /** The node currently displayed in the panel. Provides the leaf segment. */
  node: {
    id: string
    node_type: string
    node_category: 'structural' | 'context'
    order?: number | null
  }
  /** Click handler for tappable ancestor segments. */
  onSelectAncestor: (ancestorId: string) => void
}

const STRUCTURAL_LAYER_KINDS: ReadonlySet<string> = new Set<LayerKind>([
  'series', 'book', 'act', 'chapter', 'scene', 'beat',
])

interface ResolvedSegment {
  layer: LayerKind | string
  position?: number
  /** When set, the segment is tappable and navigates to this node id. */
  ancestorId?: string
}

export function DetailPaneCrumb({ node, onSelectAncestor }: DetailPaneCrumbProps) {
  const [ancestors, setAncestors] = useState<FocusBreadcrumbSegment[]>([])
  const [ancestorIds, setAncestorIds] = useState<string[]>([])

  useEffect(() => {
    let cancelled = false
    const supabase = createClient()
    Promise.all([
      getAncestorChain(supabase, node.id),
      fetchAncestorIds(supabase, node.id),
    ])
      .then(([chain, ids]) => {
        if (cancelled) return
        setAncestors(chain)
        setAncestorIds(ids)
      })
      .catch(() => {
        if (cancelled) return
        setAncestors([])
        setAncestorIds([])
      })
    return () => {
      cancelled = true
    }
  }, [node.id])

  // Compose the final segment array.
  const segments: ResolvedSegment[] = []

  if (node.node_category === 'context') {
    // OQ-4 lock — single bracketed `[Character]` (or other context type).
    segments.push({ layer: node.node_type })
  } else {
    // Structural: render ancestors (tappable) + this node's own bracket
    // (non-tappable). Empty ancestors (root) → just the leaf segment.
    for (let i = 0; i < ancestors.length; i++) {
      const seg = ancestors[i]
      segments.push({
        layer: seg.layer,
        position: seg.position,
        ancestorId: ancestorIds[i],
      })
    }
    if (STRUCTURAL_LAYER_KINDS.has(node.node_type)) {
      segments.push({
        layer: node.node_type,
        position: node.order ?? undefined,
      })
    }
  }

  if (segments.length === 0) return null

  return (
    <div
      data-testid="detail-crumb"
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 6,
        marginBottom: 8,
      }}
    >
      {segments.map((seg, i) => (
        <Segment
          key={i}
          seg={seg}
          last={i === segments.length - 1}
          isLastBeforeSeparator={i < segments.length - 1}
          onSelectAncestor={onSelectAncestor}
        />
      ))}
    </div>
  )
}

function Segment({
  seg,
  last,
  isLastBeforeSeparator,
  onSelectAncestor,
}: {
  seg: ResolvedSegment
  last: boolean
  isLastBeforeSeparator: boolean
  onSelectAncestor: (id: string) => void
}) {
  // Render an unknown layer kind by falling back to the literal node_type
  // text inside a bracket — LayerLabel handles this via its title-case fallback.
  const knownLayer = STRUCTURAL_LAYER_KINDS.has(seg.layer) || seg.layer === 'series'
  const label = knownLayer ? (
    <LayerLabel layer={seg.layer as LayerKind} position={seg.position} />
  ) : (
    <span
      style={{
        fontFamily: 'ui-monospace, "JetBrains Mono", SFMono-Regular, Menlo, monospace',
        fontSize: 10.5,
        padding: '1px 5px',
        border: '1px solid var(--color-border-default)',
        borderRadius: 3,
        color: 'var(--color-text-primary)',
        letterSpacing: '0.02em',
      }}
    >
      [{LAYER_ABBR[seg.layer as LayerKind] ?? toTitle(seg.layer)}]
    </span>
  )

  const segmentEl = seg.ancestorId && !last ? (
    <button
      type="button"
      onClick={() => onSelectAncestor(seg.ancestorId!)}
      data-testid="detail-crumb-segment"
      data-layer={seg.layer}
      data-position={seg.position ?? ''}
      data-tappable="true"
      style={{
        background: 'transparent',
        border: 0,
        padding: 0,
        cursor: 'pointer',
        minWidth: 32,
        minHeight: 32,
        display: 'inline-flex',
        alignItems: 'center',
      }}
    >
      {label}
    </button>
  ) : (
    <span
      data-testid="detail-crumb-segment"
      data-layer={seg.layer}
      data-position={seg.position ?? ''}
      data-tappable="false"
      style={{ display: 'inline-flex', alignItems: 'center' }}
    >
      {label}
    </span>
  )

  return (
    <>
      {segmentEl}
      {isLastBeforeSeparator && (
        <span style={{ color: 'var(--color-text-faint)', fontSize: 11 }}>·</span>
      )}
    </>
  )
}

function toTitle(s: string): string {
  if (!s) return s
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()
}

async function fetchAncestorIds(
  supabase: ReturnType<typeof createClient>,
  nodeId: string,
): Promise<string[]> {
  // Walk parent_id chain to capture the ids matching the FocusBreadcrumbSegment
  // ancestors returned by getAncestorChain (root-first, excluding the input).
  const ids: string[] = []
  let cursor: string | null = await fetchParentId(supabase, nodeId)
  let hops = 0
  while (cursor !== null && hops < 20) {
    ids.unshift(cursor)
    cursor = await fetchParentId(supabase, cursor)
    hops += 1
  }
  return ids
}

async function fetchParentId(
  supabase: ReturnType<typeof createClient>,
  id: string,
): Promise<string | null> {
  const { data } = await supabase
    .from('nodes')
    .select('parent_id')
    .eq('id', id)
    .maybeSingle<{ parent_id: string | null }>()
  return data?.parent_id ?? null
}
