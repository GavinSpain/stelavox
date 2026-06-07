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
 *
 * 2026-06-07 update — now also renders in-flight rows (queued / planning /
 * rendering / assembling / uploading / cancellation_requested) with a
 * status pill, chapter progress when known, and a Cancel action. This
 * panel is now the single entry point: users trigger an export from
 * here and watch it move through its states without leaving the page.
 * The bottom-right ExportProgressStack was removed in the same change.
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

/** In-flight statuses — the export is still being produced. */
const IN_FLIGHT_STATUSES = new Set<ExportJob['status']>([
  'queued', 'pending', 'planning', 'rendering', 'assembling',
  'uploading', 'cancellation_requested',
])

/** User-facing label for each non-terminal status. */
function inFlightLabel(status: ExportJob['status']): string {
  switch (status) {
    case 'queued':                 return 'Queued'
    case 'pending':                return 'Queued'
    case 'planning':               return 'Planning'
    case 'rendering':              return 'Rendering'
    case 'assembling':             return 'Assembling'
    case 'uploading':              return 'Uploading'
    case 'cancellation_requested': return 'Cancelling…'
    default:                       return status
  }
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

  async function handleCancel(jobId: string) {
    setBusyId(jobId)
    try {
      await fetch(`/api/exports/${jobId}/cancel`, { method: 'POST' })
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
        const isCancelled = job.status === 'cancelled'
        const isCompleted = job.status === 'completed' && !expired
        const isInFlight = IN_FLIGHT_STATUSES.has(job.status)
        const canCancel = isInFlight && job.status !== 'cancellation_requested'
        // Chapter progress when the runner has reported it. total_chapters
        // lives on the row itself; current_chapter lives in progress JSONB.
        const cur = job.progress.current_chapter
        const tot = job.total_chapters ?? job.progress.total_chapters ?? null
        const progressFraction =
          cur != null && tot != null && tot > 0
            ? Math.max(0, Math.min(1, cur / tot))
            : null

        return (
          <div
            key={job.id}
            data-testid={`export-history-row-${job.id}`}
            data-status={job.status}
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
              <div style={{ fontSize: 12, color: 'var(--color-text-primary)', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span>
                  {job.format.toUpperCase()}
                  {job.attempt_count > 1 ? ` · attempt ${job.attempt_count}` : ''}
                </span>
                {isInFlight && (
                  <span
                    data-testid="export-status-pill"
                    style={{
                      fontSize: 9.5,
                      fontWeight: 500,
                      letterSpacing: '0.04em',
                      textTransform: 'uppercase',
                      padding: '1px 6px',
                      borderRadius: 3,
                      border: '1px solid color-mix(in srgb, var(--color-info) 50%, transparent)',
                      color: 'var(--color-info)',
                      background: 'color-mix(in srgb, var(--color-info) 8%, transparent)',
                    }}
                  >
                    {inFlightLabel(job.status)}
                  </span>
                )}
                {isCancelled && (
                  <span
                    data-testid="export-status-pill"
                    style={{
                      fontSize: 9.5, fontWeight: 500, letterSpacing: '0.04em',
                      textTransform: 'uppercase', padding: '1px 6px', borderRadius: 3,
                      border: '1px solid var(--color-border-default)',
                      color: 'var(--color-text-muted)',
                    }}
                  >
                    Cancelled
                  </span>
                )}
              </div>
              <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginTop: 2 }}>
                {timeAgo(job.created_at)}
                {job.progress.output_size_bytes
                  ? ` · ${(job.progress.output_size_bytes / 1024 / 1024).toFixed(1)} MB`
                  : ''}
                {isInFlight && progressFraction != null && (
                  <span style={{ marginLeft: 6 }}>· chapter {cur}/{tot}</span>
                )}
                {isInFlight && job.progress.chapter_name && (
                  <span style={{ marginLeft: 6, fontStyle: 'italic' }}>{job.progress.chapter_name}</span>
                )}
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
              {isInFlight && progressFraction != null && (
                <div
                  data-testid="export-progress-bar"
                  style={{
                    marginTop: 6,
                    height: 3,
                    width: '100%',
                    background: 'var(--color-bg-base)',
                    borderRadius: 2,
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      height: '100%',
                      width: `${progressFraction * 100}%`,
                      background: 'var(--color-info)',
                      transition: 'width 200ms ease-out',
                    }}
                  />
                </div>
              )}
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
              {canCancel && (
                <button
                  type="button"
                  disabled={busyId === job.id}
                  onClick={() => handleCancel(job.id)}
                  style={ghostActionStyle}
                >
                  {busyId === job.id ? '…' : 'Cancel'}
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
