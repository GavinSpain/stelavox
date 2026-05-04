'use client'

// Spec: stelavox_phase4_api_contract_v1_0.md §3.4 / §2.11 invariant 11
//                                            (cannot_delete_with_back_links + ?force=true)
//       stelavox_phase4_test_plan_v1_0.md TC-U-17, TC-U-18
//       stelavox_phase4_build_checklist_v1_0.md §3.6 T-6.6
//
// Delete-confirmation modal for a context node. On open, fetches
// /api/nodes/[id]/back-links to populate the linked-from list. The
// destructive button calls DELETE /api/nodes/[id]?force=true to cascade
// the unlinks (FK ON DELETE CASCADE handles the link removal).

import { useEffect, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

interface BackLinkRow {
  structural_node: {
    id:            string
    name:          string | null
    node_type:     string
    document_name: string | null
  }
  link: { id: string; created_at: string }
}

interface Props {
  open:           boolean
  contextNodeId:  string
  contextName:    string | null
  onClose:        () => void
  onDeleted:      () => void
}

export function DeleteContextNodeModal({
  open, contextNodeId, contextName, onClose, onDeleted,
}: Props) {
  const [rows, setRows] = useState<BackLinkRow[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true)
    fetch(`/api/nodes/${contextNodeId}/back-links`)
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
  }, [open, contextNodeId])

  async function handleDelete() {
    setSubmitting(true)
    setError(null)
    const r = await fetch(`/api/nodes/${contextNodeId}?force=true`, {
      method: 'DELETE',
    })
    setSubmitting(false)
    if (!r.ok) {
      const body = await r.json().catch(() => ({}))
      setError(body.message ?? body.error ?? 'Failed to delete.')
      return
    }
    onDeleted()
  }

  return (
    <Dialog open={open} onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent style={{ background: 'var(--color-bg-elevated)', border: '1px solid var(--color-border-default)', maxWidth: 520 }}>
        <DialogHeader>
          <DialogTitle style={{ color: 'var(--color-text-primary)', fontSize: 'var(--text-lg)' }}>
            Delete {contextName ?? 'context node'}?
          </DialogTitle>
        </DialogHeader>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', marginTop: 'var(--space-3)' }}>
          {loading && (
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', margin: 0, fontStyle: 'italic' }}>
              Checking links…
            </p>
          )}
          {!loading && rows.length === 0 && (
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', margin: 0 }}>
              This node has no incoming links and will be deleted permanently.
            </p>
          )}
          {!loading && rows.length > 0 && (
            <>
              <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', margin: 0 }}>
                This node is linked from {rows.length} structural {rows.length === 1 ? 'node' : 'nodes'}:
              </p>
              <ul
                style={{
                  listStyle: 'none',
                  margin: 0,
                  padding: 'var(--space-2) var(--space-3)',
                  background: 'var(--color-bg-base)',
                  border: '1px solid var(--color-border-subtle)',
                  borderRadius: 4,
                  maxHeight: 200,
                  overflowY: 'auto',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                }}
              >
                {rows.map(r => (
                  <li
                    key={r.link.id}
                    style={{
                      fontSize: 'var(--text-sm)',
                      color: 'var(--color-text-primary)',
                      display: 'flex',
                      alignItems: 'baseline',
                      gap: 6,
                    }}
                  >
                    <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      {r.structural_node.node_type}
                    </span>
                    <span style={{ flex: 1 }}>
                      {r.structural_node.name ?? '(unnamed)'}
                    </span>
                    {r.structural_node.document_name && (
                      <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
                        ({r.structural_node.document_name})
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}

          {error && <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-error)' }} role="alert">{error}</p>}

          <div style={{ display: 'flex', gap: 'var(--space-3)', justifyContent: 'flex-end' }}>
            <button type="button" onClick={onClose} style={secondaryButtonStyle}>Cancel</button>
            <button
              type="button"
              onClick={handleDelete}
              disabled={submitting || loading}
              style={destructiveButtonStyle}
            >
              {submitting ? 'Deleting…' : (rows.length > 0 ? 'Delete and unlink everywhere' : 'Delete')}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

const destructiveButtonStyle: React.CSSProperties = {
  padding: 'var(--space-2) var(--space-4)',
  background: 'var(--color-error, #dc2626)',
  color: '#fff',
  border: 'none',
  borderRadius: '4px',
  fontSize: 'var(--text-sm)',
  fontWeight: 500,
  cursor: 'pointer',
}

const secondaryButtonStyle: React.CSSProperties = {
  padding: 'var(--space-2) var(--space-4)',
  background: 'none',
  color: 'var(--color-text-secondary)',
  border: '1px solid var(--color-border-default)',
  borderRadius: '4px',
  fontSize: 'var(--text-sm)',
  cursor: 'pointer',
}
