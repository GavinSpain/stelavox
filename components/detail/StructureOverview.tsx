'use client'

// Phase 8.01.E T-4 — non-leaf "structure overview" body.
//
// Replaces the prose canvas (SummaryEditor + ProseEditor + NotesEditor +
// FocusModeButton + WordCount) when node.is_leaf === false. Mounts the
// existing SummaryEditor for the node's own summary, then a read-only
// immediate-children panel with bracketed labels, status pips, and
// row-click navigation. Per OQ-3 lock: no "Open in tree" affordance —
// child rows are tappable for the navigation.
//
// Inviolable #2: no verdigris in this component. NodeStatusBadge owns
// the existing status colour tokens (approved is verdigris use #5).

import { useEffect, useState } from 'react'

import { LayerLabel, type LayerKind } from '@/components/tree/LayerLabel'
import { NodeStatusBadge } from '@/components/tree/NodeStatusBadge'
import { createClient } from '@/lib/supabase/client'
import {
  getStructuralOverview,
  type StructuralOverview as Overview,
  type ChildSummary,
} from '@/lib/project/getStructuralOverview'

// V1 layer-kind set — matches the same guard the NodeRow uses for
// LayerLabel mounts. Anything outside this falls through to the title-
// case fallback inside LayerLabel.
const STRUCTURAL_LAYER_KINDS: ReadonlySet<string> = new Set<LayerKind>([
  'series', 'book', 'act', 'chapter', 'scene', 'beat',
])

interface StructureOverviewProps {
  nodeId: string
  /** Click handler — caller routes this to the existing tree-select callback. */
  onChildSelect: (childId: string) => void
}

export function StructureOverview({ nodeId, onChildSelect }: StructureOverviewProps) {
  const [data, setData] = useState<Overview | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const supabase = createClient()
    getStructuralOverview(supabase, nodeId)
      .then((result) => {
        if (cancelled) return
        setData(result)
      })
      .catch((e) => {
        if (cancelled) return
        setError(e instanceof Error ? e.message : 'Could not load children')
      })
    return () => {
      cancelled = true
    }
  }, [nodeId])

  // StructureOverview is JUST the children panel. The SummaryEditor mount
  // stays in NodeDetailPanel above this — keeping a single source of
  // truth for the editor-store wire-up.
  return (
    <div data-testid="structure-overview">
      <ChildrenPanel
        data={data}
        error={error}
        onSelect={onChildSelect}
      />
    </div>
  )
}

function ChildrenPanel({
  data,
  error,
  onSelect,
}: {
  data: Overview | null
  error: string | null
  onSelect: (childId: string) => void
}) {
  return (
    <section
      data-testid="children-panel"
      style={{
        background: 'var(--color-bg-elevated)',
        border: '1px solid var(--color-border-subtle)',
        borderRadius: 6,
        padding: '14px 16px',
      }}
    >
      <Header data={data} />
      {error ? (
        <ErrorRow message={error} />
      ) : data === null ? (
        <LoadingRow />
      ) : data.children.length === 0 ? (
        <EmptyRow />
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column' }}>
          {data.children.map((child) => (
            <ChildRow key={child.id} child={child} onSelect={onSelect} />
          ))}
        </ul>
      )}
    </section>
  )
}

function Header({ data }: { data: Overview | null }) {
  if (!data) return null
  return (
    <div
      style={{
        fontFamily: 'ui-monospace, "JetBrains Mono", SFMono-Regular, Menlo, monospace',
        fontSize: 10,
        color: 'var(--color-text-muted)',
        letterSpacing: '0.04em',
        marginBottom: 8,
      }}
    >
      {`// ${data.childCount} child${data.childCount === 1 ? '' : 'ren'}`}
      {data.draftedPct !== null && ` · ${data.draftedPct}% drafted`}
    </div>
  )
}

function LoadingRow() {
  return (
    <div
      style={{
        fontFamily: 'var(--font-inter), Inter, sans-serif',
        fontSize: 12,
        color: 'var(--color-text-muted)',
        padding: '8px 0',
      }}
    >
      Loading children…
    </div>
  )
}

function EmptyRow() {
  return (
    <div
      data-testid="children-empty"
      style={{
        fontFamily: 'var(--font-inter), Inter, sans-serif',
        fontSize: 12,
        color: 'var(--color-text-muted)',
        padding: '8px 0',
      }}
    >
      No children yet. Expand this node to add structure.
    </div>
  )
}

function ErrorRow({ message }: { message: string }) {
  return (
    <div
      data-testid="children-error"
      style={{
        fontFamily: 'var(--font-inter), Inter, sans-serif',
        fontSize: 12,
        color: 'var(--color-error)',
        padding: '8px 0',
      }}
    >
      {message}
    </div>
  )
}

function ChildRow({
  child,
  onSelect,
}: {
  child: ChildSummary
  onSelect: (childId: string) => void
}) {
  const showLayerLabel = STRUCTURAL_LAYER_KINDS.has(child.nodeType)
  return (
    <li>
      <button
        type="button"
        data-testid="children-row"
        data-child-id={child.id}
        data-status={child.status}
        onClick={() => onSelect(child.id)}
        style={{
          width: '100%',
          background: 'transparent',
          border: 0,
          padding: '8px 0',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          cursor: 'pointer',
          textAlign: 'left',
          fontFamily: 'var(--font-inter), Inter, sans-serif',
          fontSize: 12.5,
          color: 'var(--color-text-primary)',
        }}
      >
        {showLayerLabel ? (
          <LayerLabel
            layer={child.nodeType as LayerKind}
            position={child.order}
            style={{ marginRight: 4 }}
          />
        ) : (
          <span style={{ width: 0 }} />
        )}
        <span style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {child.name ?? '(untitled)'}
        </span>
        {child.wordCountTarget !== null && (
          <span
            style={{
              fontFamily: 'ui-monospace, "JetBrains Mono", SFMono-Regular, Menlo, monospace',
              fontSize: 10,
              color: 'var(--color-text-muted)',
            }}
          >
            {child.wordCountActual ?? 0} / {child.wordCountTarget}
          </span>
        )}
        <NodeStatusBadge status={child.status} />
      </button>
    </li>
  )
}
