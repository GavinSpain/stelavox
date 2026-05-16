'use client'

/**
 * Phase 6.B — LockConflictModal
 *
 * Surfaces when a lock request hits pending/running agent work per D3.
 * Lists the conflicts. No "lock anyway" path — author cancels the
 * conflicting jobs in the Scheduler, or waits, or abandons the lock.
 *
 * Wireframe §04.
 */

import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import type { LockConflictJob } from '@/lib/locking/authorLock'

interface LockConflictModalProps {
  open: boolean
  nodeName: string
  conflicts: LockConflictJob[]
  schedulerHref?: string  // optional deep-link target
  onClose: () => void
}

function describeStatus(job: LockConflictJob): string {
  if (job.queue_status === 'running' || job.status === 'running') return 'running'
  if (job.queue_status === 'queued' || job.status === 'pending') return 'queued'
  if (job.queue_status === 'dispatched') return 'starting'
  if (job.status === 'completed') return 'completed (awaiting review)'
  return job.status
}

export function LockConflictModal({
  open, nodeName, conflicts, schedulerHref, onClose,
}: LockConflictModalProps) {
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent style={{
        background: 'var(--color-bg-elevated)',
        border: '1px solid var(--color-border-default)',
        maxWidth: 560,
      }}>
        <DialogHeader>
          <DialogTitle style={{ color: 'var(--color-text-primary)', fontSize: 'var(--text-lg)' }}>
            Can&apos;t lock — agent work is pending
          </DialogTitle>
        </DialogHeader>
        <div style={{ marginTop: 'var(--space-2)' }}>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', lineHeight: 1.55 }}>
            Locking &quot;{nodeName}&quot; would conflict with{' '}
            {conflicts.length === 1 ? '1 active or scheduled agent operation' : `${conflicts.length} active or scheduled agent operations`}.
            Resolve the conflict, then try again.
          </p>

          <div style={{ marginTop: 'var(--space-3)' }}>
            {conflicts.map(job => (
              <div
                key={job.job_id}
                data-testid="lock-conflict-job"
                style={{
                  background: 'var(--color-bg-surface)',
                  border: '1px solid var(--color-border-subtle)',
                  borderLeft: '2px solid var(--color-status-review)',
                  borderRadius: 3,
                  padding: 'var(--space-2) var(--space-3)',
                  margin: 'var(--space-1) 0',
                }}
              >
                <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-primary)', fontWeight: 500 }}>
                  {job.operation_type} — {describeStatus(job)}
                </div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginTop: 2 }}>
                  started {new Date(job.started_at).toLocaleString()}
                </div>
              </div>
            ))}
          </div>

          <p style={{ marginTop: 'var(--space-3)', fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>
            <strong style={{ color: 'var(--color-text-primary)' }}>Your options:</strong>
          </p>
          <ul style={{
            fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)',
            paddingLeft: 20, marginTop: 'var(--space-1)', lineHeight: 1.7,
          }}>
            <li>Cancel the jobs in the Scheduler, then re-attempt the lock</li>
            <li>Wait for them to finish</li>
            <li>Cancel this lock request</li>
          </ul>

          <div style={{
            display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end',
            marginTop: 'var(--space-3)',
          }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: 'var(--space-2) var(--space-4)',
                background: 'transparent',
                color: 'var(--color-text-secondary)',
                border: '1px solid var(--color-border-default)',
                borderRadius: 3, fontSize: 'var(--text-sm)', cursor: 'pointer',
              }}
            >
              Cancel lock request
            </button>
            {schedulerHref && (
              <a
                href={schedulerHref}
                style={{
                  padding: 'var(--space-2) var(--space-4)',
                  background: 'transparent',
                  color: 'var(--color-text-secondary)',
                  border: '1px solid var(--color-border-default)',
                  borderRadius: 3, fontSize: 'var(--text-sm)',
                  textDecoration: 'none', display: 'inline-block',
                }}
              >
                Open Scheduler
              </a>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
