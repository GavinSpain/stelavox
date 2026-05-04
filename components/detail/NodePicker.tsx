'use client'

// Spec: stelavox_component_specification_v2_5.md §3.3 (CommandPalette pattern reused),
//                                              §5.12 (ContextLinker)
//       stelavox_phase4_test_plan_v1_0.md TC-U-09, TC-U-10, TC-U-11, TC-U-12,
//                                          TC-V-05, TC-M-02, TC-AX-02
//       stelavox_phase4_build_checklist_v1_0.md §3.6 T-6.4
//
// Modal picker that lists the project's context nodes, filterable by
// search. Already-linked entries render at 0.5 opacity and are non-
// clickable (TC-V-05). Selecting a row invokes onSelect(node) — the
// parent (ContextLinker) issues the POST.

import { useEffect, useMemo, useRef, useState } from 'react'
import { Check } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { CONTEXT_NODE_TYPES_V1, isContextNodeType, type ContextNodeType } from '@/lib/context/types'
import { getContextLabel } from '@/lib/context/labels'
import { getContextIcon } from '@/lib/context/icons'

interface ContextNodeSummary {
  id:        string
  name:      string | null
  node_type: string
  scope:     'project' | 'document' | null
}

interface Props {
  open:             boolean
  projectId:        string
  documentId:       string | null
  alreadyLinkedIds: Set<string>
  onClose:          () => void
  onSelect:         (node: ContextNodeSummary) => void
}

export function NodePicker({
  open, projectId, documentId, alreadyLinkedIds, onClose, onSelect,
}: Props) {
  const [nodes, setNodes] = useState<ContextNodeSummary[]>([])
  const [filter, setFilter] = useState('')
  const [highlightedIndex, setHighlightedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    const url = documentId
      ? `/api/projects/${projectId}/context-nodes?limit=200&document_id=${documentId}`
      : `/api/projects/${projectId}/context-nodes?limit=200`
    fetch(url)
      .then(r => r.ok ? r.json() : null)
      .then(body => {
        if (cancelled || !body) return
        setNodes(body.context_nodes ?? [])
      })
      .catch(() => { /* silent */ })
    return () => { cancelled = true }
  }, [open, projectId, documentId])

  // Filter + group by node_type (alphabetical within group).
  const grouped = useMemo(() => {
    const term = filter.trim().toLowerCase()
    const out: Array<{ type: ContextNodeType; label: string; rows: ContextNodeSummary[] }> = []
    for (const t of CONTEXT_NODE_TYPES_V1) {
      const rows = nodes
        .filter(n => n.node_type === t)
        .filter(n => term === '' || (n.name ?? '').toLowerCase().includes(term))
        .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))
      if (rows.length > 0) out.push({ type: t, label: getContextLabel(t, true), rows })
    }
    return out
  }, [nodes, filter])

  // Flatten rows for keyboard navigation.
  const flatRows = useMemo(() => grouped.flatMap(g => g.rows), [grouped])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHighlightedIndex(0)
  }, [filter, nodes.length])

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlightedIndex(i => Math.min(i + 1, flatRows.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlightedIndex(i => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const target = flatRows[highlightedIndex]
      if (target && !alreadyLinkedIds.has(target.id)) {
        onSelect(target)
      }
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }

  return (
    <Dialog open={open} onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent style={{ background: 'var(--color-bg-elevated)', border: '1px solid var(--color-border-default)', maxWidth: 480 }}>
        <DialogHeader>
          <DialogTitle style={{ color: 'var(--color-text-primary)', fontSize: 'var(--text-base)', fontWeight: 500 }}>
            Link context node
          </DialogTitle>
        </DialogHeader>
        <input
          ref={inputRef}
          type="text"
          value={filter}
          onChange={e => setFilter(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Search context nodes…"
          autoFocus
          aria-label="Filter context nodes"
          style={{
            width: '100%',
            padding: 'var(--space-2) var(--space-3)',
            background: 'var(--color-bg-base)',
            border: '1px solid var(--color-border-default)',
            borderRadius: 4,
            color: 'var(--color-text-primary)',
            fontSize: 'var(--text-base)',
            outline: 'none',
            boxSizing: 'border-box',
            marginBottom: 'var(--space-3)',
          }}
        />
        <div
          role="listbox"
          aria-label="Context nodes"
          style={{
            maxHeight: 360,
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-2)',
          }}
        >
          {grouped.length === 0 ? (
            <p
              style={{
                fontSize: 'var(--text-sm)',
                color: 'var(--color-text-muted)',
                margin: 0,
                fontStyle: 'italic',
                padding: 'var(--space-2) 0',
              }}
            >
              {nodes.length === 0
                ? 'No context nodes in this project yet.'
                : 'No matches.'}
            </p>
          ) : (
            grouped.map(group => (
              <div key={group.type}>
                <div
                  style={{
                    fontSize: 'var(--text-xs)',
                    color: 'var(--color-text-muted)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    padding: '2px 0',
                  }}
                >
                  {group.label}
                </div>
                <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                  {group.rows.map((row) => {
                    const flatIndex = flatRows.indexOf(row)
                    const linked = alreadyLinkedIds.has(row.id)
                    const highlighted = !linked && flatIndex === highlightedIndex
                    const Icon = isContextNodeType(row.node_type) ? getContextIcon(row.node_type) : null
                    return (
                      <li key={row.id}>
                        <button
                          type="button"
                          role="option"
                          aria-selected={highlighted}
                          aria-disabled={linked}
                          onMouseEnter={() => !linked && setHighlightedIndex(flatIndex)}
                          onClick={() => !linked && onSelect(row)}
                          disabled={linked}
                          style={{
                            width: '100%',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            padding: '6px 10px',
                            background: highlighted ? 'var(--color-bg-hover)' : 'transparent',
                            border: 'none',
                            cursor: linked ? 'not-allowed' : 'pointer',
                            color: 'var(--color-text-secondary)',
                            fontFamily: 'var(--font-sans)',
                            fontSize: 'var(--text-sm)',
                            opacity: linked ? 0.5 : 1,
                            textAlign: 'left',
                            borderRadius: 4,
                          }}
                        >
                          {Icon && <Icon size={14} color="var(--color-text-muted)" style={{ flexShrink: 0 }} />}
                          <span
                            style={{
                              flex: 1,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {row.name ?? '(unnamed)'}
                          </span>
                          {row.scope === 'document' && (
                            <span
                              style={{
                                fontSize: 'var(--text-xs)',
                                color: 'var(--color-text-disabled)',
                                letterSpacing: '0.04em',
                                textTransform: 'uppercase',
                              }}
                            >
                              doc
                            </span>
                          )}
                          {linked && (
                            // Inviolable #2 — checkmark uses --color-text-muted,
                            // NEVER --color-accent (TC-V-05 contract).
                            <Check size={14} color="var(--color-text-muted)" />
                          )}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
