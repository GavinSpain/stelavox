'use client'

/**
 * Phase 9.E (DR-043) — BulkUnlockConfirmModal
 *
 * When a node was locked as part of a bulk "Lock all descendants"
 * operation, unlocking offers two scopes:
 *   - Unlock the whole batch (every node sharing the bulk_operation_id)
 *   - Unlock just this one node
 *
 * Single-node locks (no bulk_operation_id) never reach this modal —
 * NodeMoreMenu unlocks them directly. The bulk-release endpoint is
 * DELETE /api/nodes/[id]/lock/bulk-operation/[bulkOpId]; the single
 * release is DELETE /api/nodes/[id]/lock.
 *
 * Inviolables: Inter only; no verdigris. Unlock is a neutral primary
 * action (releasing a lock is not an affirmative agent-action trigger).
 */

import { useState } from 'react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'

interface BulkUnlockConfirmModalProps {
  open: boolean
  nodeId: string
  nodeName: string
  bulkOperationId: string
  /** Total nodes locked under this bulk operation (incl. this one). */
  bulkCount: number
  onClose: () => void
  /** Called after a successful release (either scope) so the tree refreshes. */
  onUnlocked: () => void
}

export function BulkUnlockConfirmModal({
  open, nodeId, nodeName, bulkOperationId, bulkCount, onClose, onUnlocked,
}: BulkUnlockConfirmModalProps) {
  const [busy, setBusy] = useState<'bulk' | 'single' | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function release(scope: 'bulk' | 'single') {
    setBusy(scope)
    setError(null)
    try {
      const url =
        scope === 'bulk'
          ? `/api/nodes/${nodeId}/lock/bulk-operation/${bulkOperationId}`
          : `/api/nodes/${nodeId}/lock`
      const r = await fetch(url, { method: 'DELETE' })
      if (r.ok) {
        onUnlocked()
        onClose()
        return
      }
      const body = (await r.json().catch(() => null)) as { message?: string; error?: string } | null
      setError(body?.message ?? body?.error ?? `Unlock failed (${r.status})`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error')
    } finally {
      setBusy(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && busy === null) onClose() }}>
      <DialogContent
        data-testid="bulk-unlock-modal"
        style={{
          background: 'var(--color-bg-elevated)',
          border: '1px solid var(--color-border-default)',
          maxWidth: 520,
        }}
      >
        <DialogHeader>
          <DialogTitle style={{ color: 'var(--color-text-primary)', fontSize: 'var(--text-lg)' }}>
            Unlock — this node is part of a batch
          </DialogTitle>
        </DialogHeader>
        <div style={{ marginTop: 'var(--space-2)' }}>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', lineHeight: 1.55 }}>
            &quot;{nodeName}&quot; was locked together with{' '}
            <strong style={{ color: 'var(--color-text-primary)' }}>
              {bulkCount === 1 ? '1 node' : `${bulkCount} nodes`}
            </strong>{' '}
            in a single &quot;Lock all descendants&quot; operation. Choose how much to unlock.
          </p>

          {error ? (
            <div
              role="alert"
              data-testid="bulk-unlock-error"
              style={{
                marginTop: 'var(--space-3)',
                padding: 'var(--space-2) var(--space-3)',
                background: 'rgba(184,48,48,0.08)',
                border: '1px solid rgba(184,48,48,0.25)',
                borderRadius: 4,
                fontSize: 'var(--text-sm)',
                color: 'var(--color-text-primary)',
              }}
            >
              {error}
            </div>
          ) : null}

          <div style={{
            display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end',
            marginTop: 'var(--space-4)', flexWrap: 'wrap',
          }}>
            <button
              type="button"
              onClick={onClose}
              disabled={busy !== null}
              style={ghostBtn}
            >
              Cancel
            </button>
            <button
              type="button"
              data-testid="bulk-unlock-single"
              onClick={() => void release('single')}
              disabled={busy !== null}
              style={ghostBtn}
            >
              {busy === 'single' ? 'Unlocking…' : 'Unlock just this one'}
            </button>
            <button
              type="button"
              data-testid="bulk-unlock-all"
              onClick={() => void release('bulk')}
              disabled={busy !== null}
              style={primaryBtn}
            >
              {busy === 'bulk' ? 'Unlocking…' : `Unlock all ${bulkCount}`}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

const ghostBtn: React.CSSProperties = {
  padding: 'var(--space-2) var(--space-4)',
  background: 'transparent',
  color: 'var(--color-text-secondary)',
  border: '1px solid var(--color-border-default)',
  borderRadius: 3,
  fontSize: 'var(--text-sm)',
  cursor: 'pointer',
  fontFamily: 'var(--font-inter), Inter, sans-serif',
}

const primaryBtn: React.CSSProperties = {
  padding: 'var(--space-2) var(--space-4)',
  background: 'var(--color-bg-selected)',
  color: 'var(--color-text-primary)',
  border: '1px solid var(--color-border-strong)',
  borderRadius: 3,
  fontSize: 'var(--text-sm)',
  cursor: 'pointer',
  fontWeight: 500,
  fontFamily: 'var(--font-inter), Inter, sans-serif',
}
