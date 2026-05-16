'use client'

/**
 * Phase 6.B — LockReasonModal
 *
 * Confirmation modal shown when the author clicks "Lock this node…"
 * in NodeMoreMenu. Per wireframe §03:
 *   - Optional reason input + clickable suggestions
 *   - Optional "Lock all descendants" toggle (count comes from caller)
 *   - Neutral primary "Lock" button (NOT verdigris)
 *
 * On submit, POSTs to /api/nodes/[id]/lock. If the server returns
 * a 423 with `conflicts`, the caller renders LockConflictModal.
 */

import { useEffect, useState } from 'react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import type { LockConflictJob } from '@/lib/locking/authorLock'

interface LockReasonModalProps {
  open: boolean
  nodeId: string
  nodeName: string
  descendantIds?: string[]   // precomputed by the caller from the tree
  descendantCount?: number   // for the toggle label
  reasonSuggestions: string[]
  onClose: () => void
  onLocked: () => void
  onConflict: (conflicts: LockConflictJob[]) => void
}

export function LockReasonModal({
  open,
  nodeId,
  nodeName,
  descendantIds = [],
  descendantCount,
  reasonSuggestions,
  onClose,
  onLocked,
  onConflict,
}: LockReasonModalProps) {
  const [reason, setReason] = useState('')
  const [withDescendants, setWithDescendants] = useState(false)
  const [busy, setBusy] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  // Reset state each time the modal reopens.
  useEffect(() => {
    if (open) {
      setReason('')
      setWithDescendants(false)
      setBusy(false)
      setErrorMsg(null)
    }
  }, [open])

  async function submit() {
    setBusy(true)
    setErrorMsg(null)
    try {
      const res = await fetch(`/api/nodes/${nodeId}/lock`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          reason: reason.trim() || null,
          with_descendants: withDescendants,
          descendant_ids: withDescendants ? descendantIds : undefined,
        }),
      })
      if (res.ok) {
        onLocked()
        onClose()
        return
      }
      if (res.status === 423) {
        const body = await res.json()
        if (Array.isArray(body.conflicts) && body.conflicts.length > 0) {
          onConflict(body.conflicts as LockConflictJob[])
          onClose()
          return
        }
        setErrorMsg(body.message ?? 'Lock blocked.')
      } else {
        setErrorMsg(`Lock failed (status ${res.status}).`)
      }
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Network error.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!busy && !o) onClose() }}>
      <DialogContent style={{
        background: 'var(--color-bg-elevated)',
        border: '1px solid var(--color-border-default)',
        maxWidth: 480,
      }}>
        <DialogHeader>
          <DialogTitle style={{ color: 'var(--color-text-primary)', fontSize: 'var(--text-lg)' }}>
            Lock &quot;{nodeName}&quot;
          </DialogTitle>
        </DialogHeader>

        <div style={{ marginTop: 'var(--space-2)' }}>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', lineHeight: 1.55 }}>
            While locked, no content, structure, or status changes can be
            made — by you, by other authors, or by agents. Unlock anytime
            from the More menu.
          </p>

          <div style={{ marginTop: 'var(--space-3)' }}>
            <label style={{
              display: 'block',
              fontSize: 'var(--text-xs)',
              fontWeight: 500,
              letterSpacing: '.14em',
              textTransform: 'uppercase',
              color: 'var(--color-text-muted)',
              marginBottom: 'var(--space-1)',
            }}>
              Reason (optional)
            </label>
            <input
              type="text"
              value={reason}
              onChange={e => setReason(e.target.value)}
              maxLength={1000}
              placeholder="What does this lock protect?"
              data-testid="lock-reason-input"
              style={{
                width: '100%',
                padding: 'var(--space-2) var(--space-3)',
                background: 'var(--color-bg-base)',
                border: '1px solid var(--color-border-default)',
                borderRadius: 3,
                color: 'var(--color-text-primary)',
                fontSize: 'var(--text-sm)',
                outline: 'none',
                fontFamily: 'inherit',
              }}
            />
            {reasonSuggestions.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-1)', marginTop: 'var(--space-2)' }}>
                {reasonSuggestions.map(s => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setReason(s)}
                    style={{
                      fontSize: 'var(--text-xs)',
                      color: 'var(--color-text-muted)',
                      background: 'var(--color-bg-surface)',
                      padding: '3px 8px',
                      borderRadius: 10,
                      border: '1px solid var(--color-border-subtle)',
                      cursor: 'pointer',
                    }}
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>

          {descendantCount !== undefined && descendantCount > 0 && (
            <label style={{
              display: 'flex', alignItems: 'flex-start', gap: 'var(--space-2)',
              padding: 'var(--space-2) var(--space-3)',
              background: 'var(--color-bg-surface)',
              borderRadius: 4, marginTop: 'var(--space-3)', cursor: 'pointer',
            }}>
              <input
                type="checkbox"
                checked={withDescendants}
                onChange={e => setWithDescendants(e.target.checked)}
                data-testid="lock-with-descendants"
                style={{ marginTop: 2 }}
              />
              <div style={{ flex: 1, fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>
                Also lock all {descendantCount} descendants
                <div style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-xs)', marginTop: 2 }}>
                  Each descendant gets its own lock — unlock individually later,
                  or release all at once from the bulk lock.
                </div>
              </div>
            </label>
          )}

          {errorMsg && (
            <div style={{
              marginTop: 'var(--space-2)',
              padding: 'var(--space-2) var(--space-3)',
              background: 'var(--color-bg-surface)',
              borderLeft: '2px solid var(--color-error)',
              borderRadius: 3,
              fontSize: 'var(--text-sm)',
              color: 'var(--color-text-secondary)',
            }}>
              {errorMsg}
            </div>
          )}

          <div style={{
            display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end',
            marginTop: 'var(--space-3)',
          }}>
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              style={ghostButtonStyle}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={busy}
              data-testid="lock-confirm"
              style={primaryButtonStyle}
            >
              {busy ? 'Locking…' : 'Lock'}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

const ghostButtonStyle: React.CSSProperties = {
  padding: 'var(--space-2) var(--space-4)',
  background: 'transparent',
  color: 'var(--color-text-secondary)',
  border: '1px solid var(--color-border-default)',
  borderRadius: 3,
  fontSize: 'var(--text-sm)',
  cursor: 'pointer',
}

// Phase 6 callout 10: neutral primary, NOT verdigris.
const primaryButtonStyle: React.CSSProperties = {
  padding: 'var(--space-2) var(--space-4)',
  background: 'var(--color-text-primary)',
  color: 'var(--color-bg-base)',
  border: 'none',
  borderRadius: 3,
  fontSize: 'var(--text-sm)',
  fontWeight: 500,
  cursor: 'pointer',
}
