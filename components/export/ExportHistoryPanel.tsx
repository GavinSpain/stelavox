'use client'

/**
 * Phase 7.D — ExportHistoryPanel
 *
 * Per-document export history per wireframe §07. Lists past exports
 * with Download / Re-run / Retry actions. Persists past signed-URL
 * expiry (row stays; Download becomes Re-run). Failed exports stay
 * with their error_message + a Retry action.
 *
 * Subscribes to export_jobs filtered by document_id via Realtime.
 */

import { useState } from 'react'
import { useExportHistory, type ExportJob } from '@/lib/hooks/useExportJobs'

interface ExportHistoryPanelProps {
  documentId: string
  documentName: string
}

function formatIcon(format: ExportJob['format']): string {
  switch (format) {
    case 'docx': return '📄'
    case 'epub': return '📚'
    case 'json': return '{ }'
    case 'outline': return '📋'
  }
}

function timeAgo(iso: string): string {
  const created = new Date(iso).getTime()
  const now = Date.now()
  const seconds = Math.floor((now - created) / 1000)
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)} hours ago`
  return `${Math.floor(seconds / 86_400)} days ago`
}

export function ExportHistoryPanel({ documentId, documentName }: ExportHistoryPanelProps) {
  const exports = useExportHistory(documentId)
  const [busyId, setBusyId] = useState<string | null>(null)
  // History rows render with a captured "now" for expiry comparison.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now()

  async function handleRetry(jobId: string) {
    setBusyId(jobId)
    try {
      await fetch(`/api/exports/${jobId}/retry`, { method: 'POST' })
    } finally {
      setBusyId(null)
    }
  }

  if (exports.length === 0) {
    return (
      <div style={{
        padding: 'var(--space-4)',
        color: 'var(--color-text-muted)',
        fontSize: 12,
        fontStyle: 'italic',
      }}>
        No exports yet for &quot;{documentName}&quot;.
      </div>
    )
  }

  return (
    <div
      data-testid="export-history-panel"
      style={{
        background: 'var(--color-bg-elevated)',
        border: '1px solid var(--color-border-subtle)',
        borderRadius: 6,
      }}
    >
      <div style={{
        padding: '12px 16px',
        fontSize: 10, fontWeight: 500, letterSpacing: '.22em',
        textTransform: 'uppercase', color: 'var(--color-text-muted)',
        borderBottom: '1px solid var(--color-border-subtle)',
      }}>
        Export history — {documentName}
      </div>
      {exports.map((job) => {
        const expired = job.signed_url_expires_at
          ? new Date(job.signed_url_expires_at).getTime() < now
          : false
        const isFailed = job.status === 'failed'
        const isCompleted = job.status === 'completed' && !expired

        return (
          <div
            key={job.id}
            data-testid={`export-history-row-${job.id}`}
            style={{
              padding: '10px 16px',
              display: 'grid',
              gridTemplateColumns: '32px 1fr auto',
              alignItems: 'center',
              gap: 12,
              borderBottom: '1px solid var(--color-border-subtle)',
            }}
          >
            <div style={{ fontSize: 14, textAlign: 'center', color: 'var(--color-text-secondary)' }}>
              {formatIcon(job.format)}
            </div>
            <div>
              <div style={{ fontSize: 12, color: 'var(--color-text-primary)' }}>
                {job.format.toUpperCase()}
                {job.attempt_count > 1 ? ` · attempt ${job.attempt_count}` : ''}
              </div>
              <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginTop: 2 }}>
                {timeAgo(job.created_at)}
                {job.progress.output_size_bytes
                  ? ` · ${(job.progress.output_size_bytes / 1024 / 1024).toFixed(1)} MB`
                  : ''}
                {isCompleted && job.signed_url_expires_at && ' · download available'}
                {expired && job.status === 'completed' && (
                  <span style={{ fontStyle: 'italic', marginLeft: 6 }}>URL expired</span>
                )}
                {isFailed && job.error_message && (
                  <span style={{ color: 'var(--color-error)', fontStyle: 'italic', marginLeft: 6 }}>
                    Failed: {job.error_message}
                  </span>
                )}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              {isCompleted && job.signed_url && (
                <a
                  href={job.signed_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={ghostActionStyle}
                >
                  Download
                </a>
              )}
              {(expired || isFailed) && (
                <button
                  type="button"
                  disabled={busyId === job.id}
                  onClick={() => handleRetry(job.id)}
                  style={ghostActionStyle}
                >
                  {busyId === job.id ? '…' : isFailed ? 'Retry' : 'Re-run'}
                </button>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

const ghostActionStyle: React.CSSProperties = {
  fontSize: 10,
  padding: '4px 10px',
  borderRadius: 3,
  border: '1px solid var(--color-border-default)',
  background: 'transparent',
  color: 'var(--color-text-secondary)',
  cursor: 'pointer',
  textDecoration: 'none',
  display: 'inline-block',
}
