'use client'

/**
 * Phase 6.C — RestoreConfirmModal
 *
 * Confirmation modal shown after the user clicks Restore on a
 * VersionHistory row. Per wireframe §05:
 *   - Explanatory copy teaches the additive history model
 *   - Two-line preserved-vs-rewritten breakdown
 *   - Destructive token on the primary action (NOT verdigris) — D9
 *   - Primary action labels the target version ("Restore to v7") — D9
 */

import { useState } from 'react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'

interface RestoreConfirmModalProps {
  open: boolean
  nodeId: string
  nodeName: string
  targetVersion: number
  targetVersionMeta?: { changedAt: string; changeReason: string | null }
  expectedVersion: number
  onClose: () => void
  onRestored: (newVersion: number) => void
  onVersionConflict: () => void
}

export function RestoreConfirmModal({
  open, nodeId, nodeName, targetVersion, targetVersionMeta,
  expectedVersion, onClose, onRestored, onVersionConflict,
}: RestoreConfirmModalProps) {
  const [busy, setBusy] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  async function submit() {
    setBusy(true)
    setErrorMsg(null)
    try {
      const res = await fetch(`/api/nodes/${nodeId}/versions/${targetVersion}/restore`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ expected_version: expectedVersion }),
      })
      if (res.ok) {
        const body = await res.json()
        onRestored(body.new_version)
        onClose()
        return
      }
      if (res.status === 409) {
        onVersionConflict()
        onClose()
        return
      }
      const body = await res.json().catch(() => ({}))
      if (res.status === 423) {
        setErrorMsg(body.error === 'node_in_use'
          ? 'Another author is editing this node. Try again when they finish.'
          : body.error === 'node_in_progress'
            ? 'An agent operation is in progress on this node. Try again when it finishes.'
            : 'This node is locked. Unlock it before restoring.')
      } else {
        setErrorMsg(`Restore failed (status ${res.status}).`)
      }
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Network error.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!busy && !o) onClose() }}>
      <DialogContent
        data-testid="restore-confirm-modal"
        style={{
          background: 'var(--color-bg-elevated)',
          border: '1px solid var(--color-border-default)',
          maxWidth: 480,
        }}
      >
        <DialogHeader>
          <DialogTitle style={{ color: 'var(--color-text-primary)', fontSize: 'var(--text-lg)' }}>
            Restore &quot;{nodeName}&quot; to version {targetVersion}?
          </DialogTitle>
        </DialogHeader>
        <div style={{ marginTop: 'var(--space-2)' }}>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', lineHeight: 1.55 }}>
            Your current content (version {expectedVersion}) won&apos;t be lost — it stays in the
            version history. You can restore back to v{expectedVersion} any time from this same list.
          </p>
          <div style={{
            background: 'var(--color-bg-surface)',
            borderRadius: 3,
            padding: 'var(--space-2) var(--space-3)',
            margin: 'var(--space-3) 0',
          }}>
            <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-primary)' }}>
              <strong>v{targetVersion}</strong>
              {targetVersionMeta?.changedAt && ` — ${new Date(targetVersionMeta.changedAt).toLocaleString()}`}
              {targetVersionMeta?.changeReason && ` · ${targetVersionMeta.changeReason}`}
            </div>
            <div style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-xs)', marginTop: 4 }}>
              Restores: summary, prose, notes, metadata.
            </div>
            <div style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-xs)' }}>
              Unchanged: name, tags, structure, status, lock.
            </div>
          </div>

          {errorMsg && (
            <div style={{
              padding: 'var(--space-2) var(--space-3)',
              background: 'var(--color-bg-surface)',
              borderLeft: '2px solid var(--color-error)',
              borderRadius: 3,
              fontSize: 'var(--text-sm)',
              color: 'var(--color-text-secondary)',
              marginBottom: 'var(--space-2)',
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
              style={{
                padding: 'var(--space-2) var(--space-4)',
                background: 'transparent',
                color: 'var(--color-text-secondary)',
                border: '1px solid var(--color-border-default)',
                borderRadius: 3, fontSize: 'var(--text-sm)', cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={busy}
              data-testid="restore-confirm"
              style={{
                padding: 'var(--space-2) var(--space-4)',
                // D9: destructive token (NOT verdigris).
                background: 'var(--color-error)',
                color: '#fff',
                border: 'none',
                borderRadius: 3, fontSize: 'var(--text-sm)', fontWeight: 500, cursor: 'pointer',
              }}
            >
              {busy ? 'Restoring…' : `Restore to v${targetVersion}`}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
