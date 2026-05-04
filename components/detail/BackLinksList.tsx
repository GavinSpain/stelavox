'use client'

// Spec: stelavox_phase4_api_contract_v1_0.md §3.6 (back-links)
//       stelavox_phase4_build_checklist_v1_0.md §3.6 T-6.6 (delete modal)
//
// Read-only list shown on the Context tab when the active node is a
// context node. Surfaces the structural nodes that link to this
// context node, grouped by document. Powers the user's mental model
// when they're about to delete the context node (the delete-
// confirmation dialog uses the same data).

import { useEffect, useState } from 'react'

interface BackLinkRow {
  structural_node: {
    id:            string
    name:          string | null
    node_type:     string
    depth:         number | null
    document_id:   string | null
    document_name: string | null
  }
  link: { id: string; created_at: string }
}

interface Props {
  nodeId: string
}

export function BackLinksList({ nodeId }: Props) {
  const [rows, setRows] = useState<BackLinkRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true)
    fetch(`/api/nodes/${nodeId}/back-links`)
      .then(r => r.ok ? r.json() : null)
      .then(body => {
        if (cancelled) return
        setRows(body?.back_links ?? [])
        setLoading(false)
      })
      .catch(() => {
        if (cancelled) return
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [nodeId])

  // Group by document_name.
  const groups = (() => {
    const out = new Map<string, BackLinkRow[]>()
    for (const r of rows) {
      const key = r.structural_node.document_name ?? '(no document)'
      const arr = out.get(key) ?? []
      arr.push(r)
      out.set(key, arr)
    }
    return out
  })()

  return (
    <div style={{ padding: 'var(--space-4) var(--space-5)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <div
        style={{
          fontSize: 'var(--text-xs)',
          fontWeight: 500,
          color: 'var(--color-text-muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
        }}
      >
        Linked from {rows.length} structural {rows.length === 1 ? 'node' : 'nodes'}
      </div>
      {loading && (
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', margin: 0, fontStyle: 'italic' }}>
          Loading…
        </p>
      )}
      {!loading && rows.length === 0 && (
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', margin: 0, fontStyle: 'italic' }}>
          Not linked from any structural node yet.
        </p>
      )}
      {!loading && rows.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {Array.from(groups.entries()).map(([docName, group]) => (
            <div key={docName}>
              <div
                style={{
                  fontSize: 'var(--text-xs)',
                  color: 'var(--color-text-muted)',
                  fontWeight: 500,
                  marginBottom: 4,
                }}
              >
                {docName}
              </div>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                {group.map(r => (
                  <li
                    key={r.link.id}
                    style={{
                      padding: '6px 10px',
                      background: 'var(--color-bg-base)',
                      border: '1px solid var(--color-border-subtle)',
                      borderRadius: 4,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      fontSize: 'var(--text-sm)',
                      color: 'var(--color-text-primary)',
                    }}
                  >
                    <span
                      style={{
                        fontSize: 'var(--text-xs)',
                        color: 'var(--color-text-muted)',
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                      }}
                    >
                      {r.structural_node.node_type}
                    </span>
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {r.structural_node.name ?? '(unnamed)'}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
