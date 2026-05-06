'use client'

// Spec: stelavox_component_specification_v2_7.md §7.9 (DirectorInput @ mention)
//       stelavox_phase5b_build_checklist_v1_0.md §3.16 T-16.2
//
// Searchable popover that opens beneath the cursor on @ keypress in
// DirectorInput. Lists current document's structural + context nodes.
// Filter by case-insensitive substring match against node name.
// Keyboard nav: ↑/↓ to move, Enter to select, Esc to close.

import { useEffect, useMemo, useRef, useState } from 'react'

export interface NodePickerItem {
  id: string
  name: string
  node_type: string
  node_category: 'structural' | 'context'
}

interface NodePickerProps {
  documentId: string
  query: string
  open: boolean
  onSelect: (node: NodePickerItem) => void
  onClose: () => void
  /** Anchor coordinates relative to the viewport. */
  anchor?: { left: number; bottom: number } | null
}

const MAX_RESULTS = 8

type NodeRow = NodePickerItem

function nodeTypeIcon(type: string): string {
  switch (type) {
    case 'book':       return '⛁'
    case 'act':        return '§'
    case 'chapter':    return '◧'
    case 'scene':      return '◇'
    case 'beat':       return '·'
    case 'character':  return '◉'
    case 'location':   return '⌂'
    case 'organisation': return '◆'
    case 'theme':      return '✻'
    case 'plot_thread':return '⌇'
    case 'world':      return '⊛'
    default:           return '○'
  }
}

export function NodePicker({
  documentId,
  query,
  open,
  onSelect,
  onClose,
  anchor,
}: NodePickerProps) {
  const [allNodes, setAllNodes] = useState<NodeRow[]>([])
  const [loading, setLoading] = useState(false)
  const [highlight, setHighlight] = useState(0)
  const popoverRef = useRef<HTMLDivElement | null>(null)

  // Lazy-load the document's node list when the picker first opens.
  useEffect(() => {
    if (!open || !documentId) return
    if (allNodes.length > 0) return
    let cancelled = false
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true)
    void (async () => {
      try {
        const res = await fetch(
          `/api/documents/${documentId}/nodes?node_category=all`,
          { cache: 'no-store' },
        )
        if (!res.ok) return
        const json = (await res.json()) as { nodes: NodeRow[] }
        if (cancelled) return
        setAllNodes(json.nodes ?? [])
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, documentId, allNodes.length])

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    const filtered = q
      ? allNodes.filter((n) => n.name.toLowerCase().includes(q))
      : allNodes
    return filtered.slice(0, MAX_RESULTS)
  }, [allNodes, query])

  // Reset highlight when results change.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHighlight(0)
  }, [query, matches.length])

  // Keyboard navigation (window-level so the textarea retains focus).
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setHighlight((h) => Math.min(h + 1, Math.max(0, matches.length - 1)))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setHighlight((h) => Math.max(0, h - 1))
      } else if (e.key === 'Enter') {
        const m = matches[highlight]
        if (m) {
          e.preventDefault()
          onSelect(m)
        }
      } else if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, matches, highlight, onSelect, onClose])

  if (!open) return null

  const left = anchor?.left ?? 24
  const bottom = anchor?.bottom ?? 80

  return (
    <div
      ref={popoverRef}
      role="listbox"
      aria-label="Mention a node"
      style={{
        position: 'fixed',
        left,
        bottom,
        background: 'var(--color-bg-elevated)',
        border: '1px solid var(--color-border-default)',
        borderRadius: 6,
        boxShadow: 'var(--shadow-md, 0 4px 12px rgba(0,0,0,0.3))',
        minWidth: 240,
        maxWidth: 360,
        maxHeight: 240,
        overflowY: 'auto',
        zIndex: 1000,
        padding: 4,
        fontFamily: 'var(--font-inter), Inter, sans-serif',
      }}
    >
      {loading ? (
        <div
          style={{
            padding: '8px 12px',
            fontSize: 11,
            color: 'var(--color-text-muted)',
            fontStyle: 'italic',
          }}
        >
          Loading nodes…
        </div>
      ) : matches.length === 0 ? (
        <div
          style={{
            padding: '8px 12px',
            fontSize: 11,
            color: 'var(--color-text-muted)',
            fontStyle: 'italic',
          }}
        >
          No matching nodes.
        </div>
      ) : (
        matches.map((n, i) => (
          <button
            key={n.id}
            type="button"
            role="option"
            aria-selected={i === highlight}
            onMouseEnter={() => setHighlight(i)}
            onMouseDown={(e) => {
              // Use mousedown to fire before the textarea blurs.
              e.preventDefault()
              onSelect(n)
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              width: '100%',
              padding: '6px 10px',
              border: 'none',
              borderRadius: 4,
              background:
                i === highlight ? 'var(--color-bg-selected)' : 'transparent',
              color: 'var(--color-text-primary)',
              fontFamily: 'inherit',
              fontWeight: 400,
              fontSize: 12,
              cursor: 'pointer',
              textAlign: 'left',
            }}
          >
            <span
              aria-hidden="true"
              style={{
                width: 14,
                color: 'var(--color-text-muted)',
                fontSize: 11,
              }}
            >
              {nodeTypeIcon(n.node_type)}
            </span>
            <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {n.name}
            </span>
            <span
              style={{
                fontSize: 10,
                color: 'var(--color-text-muted)',
                textTransform: 'capitalize',
              }}
            >
              {n.node_type.replace('_', ' ')}
            </span>
          </button>
        ))
      )}
    </div>
  )
}
