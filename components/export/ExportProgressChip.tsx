'use client'

/**
 * Phase 7.D — ExportProgressChip
 *
 * Bottom-right status chip per wireframe §05. Six states:
 *   queued / rendering / assembling / uploading / completed / failed / cancelled
 *
 * Subscribes to a single export_jobs row via useExportProgress.
 * Cancel button on running exports (destructive); Download / Retry /
 * Dismiss buttons per terminal state (neutral primary).
 *
 * NOT verdigris — Inviolable #2 use #7 family does not extend here.
 */

import { useState } from 'react'
import { useExportProgress, type ExportJob } from '@/lib/hooks/useExportJobs'

interface ExportProgressChipProps {
  exportJobId: string
  onDismiss: () => void
}

export function ExportProgressChip({ exportJobId, onDismiss }: ExportProgressChipProps) {
  const job = useExportProgress(exportJobId)
  const [cancelling, setCancelling] = useState(false)

  if (!job) return null

  const phase = job.progress.phase ?? job.status
  const current = job.progress.current_chapter ?? 0
  const total = job.progress.total_chapters ?? job.total_chapters ?? 0
  const remaining = job.progress.estimated_seconds_remaining

  // Visual state derived from phase
  const visual = deriveVisual(job)

  async function handleCancel() {
    setCancelling(true)
    try {
      await fetch(`/api/exports/${exportJobId}/cancel`, { method: 'POST' })
    } catch {
      // ignore network error; row state remains and chip stays
    } finally {
      setCancelling(false)
    }
  }

  async function handleRetry() {
    try {
      await fetch(`/api/exports/${exportJobId}/retry`, { method: 'POST' })
    } catch {
      // ignore network error
    }
    onDismiss()
  }

  function handleDownload() {
    if (job?.signed_url) {
      window.open(job.signed_url, '_blank', 'noopener,noreferrer')
    }
  }

  return (
    <div
      data-testid="export-progress-chip"
      data-phase={phase}
      style={{
        background: 'var(--color-bg-elevated)',
        border: '1px solid var(--color-border-default)',
        borderRadius: 6,
        padding: '10px 14px',
        width: 280,
        boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
        marginTop: 8,
      }}
    >
      <div style={{
        fontSize: 12, fontWeight: 500, color: 'var(--color-text-primary)',
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <span style={{
          width: 8, height: 8, borderRadius: '50%',
          background: visual.dotColor,
          animation: visual.pulse ? 'export-chip-pulse 2s ease-in-out infinite' : undefined,
          flexShrink: 0,
        }} />
        {visual.title}
        <style>{`
          @keyframes export-chip-pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.5; }
          }
        `}</style>
      </div>
      <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>
        {job.format.toUpperCase()}
      </div>

      {visual.showProgress && (
        <>
          <div style={{
            height: 3, background: 'var(--color-bg-surface)',
            borderRadius: 2, margin: '10px 0 4px', overflow: 'hidden',
          }}>
            <div style={{
              height: '100%', width: `${total > 0 ? Math.round((current / total) * 100) : 5}%`,
              background: 'var(--color-agent-running)',
              borderRadius: 2,
              transition: 'width 200ms ease',
            }} />
          </div>
          <div style={{ fontSize: 10, color: 'var(--color-text-muted)', display: 'flex', justifyContent: 'space-between' }}>
            <span>
              {job.progress.chapter_name
                ? `Chapter ${current} of ${total}: ${job.progress.chapter_name}`
                : visual.subtitle}
            </span>
            {remaining != null && remaining > 0 && (
              <span>~{remaining < 60 ? `${remaining}s` : `${Math.ceil(remaining / 60)} min`} remaining</span>
            )}
          </div>
        </>
      )}

      {phase === 'failed' && (
        <div style={{
          fontSize: 11, color: 'var(--color-error)',
          marginTop: 6, fontStyle: 'italic',
        }}>
          {job.error_message ?? 'Export failed'}
        </div>
      )}

      {phase === 'cancelled' && (
        <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 6 }}>
          Cancelled
          {job.progress.cancelled_at_chapter
            ? ` at chapter ${job.progress.cancelled_at_chapter} of ${total}`
            : ''
          }. No file was produced.
        </div>
      )}

      {phase === 'completed' && (
        <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 6 }}>
          {job.progress.output_size_bytes
            ? `${(job.progress.output_size_bytes / 1024 / 1024).toFixed(1)} MB · `
            : ''
          }
          expires in 7 days
        </div>
      )}

      <div style={{ marginTop: 8, display: 'flex', gap: 6 }}>
        {phase === 'completed' && (
          <>
            <button
              type="button"
              onClick={handleDownload}
              data-testid="export-download"
              style={primaryBtnStyle}
            >
              Download
            </button>
            <button type="button" onClick={onDismiss} style={ghostBtnStyle}>
              Dismiss
            </button>
          </>
        )}
        {phase === 'failed' && (
          <>
            <button
              type="button"
              onClick={handleRetry}
              data-testid="export-retry"
              style={primaryBtnStyle}
            >
              Retry
            </button>
            <button type="button" onClick={onDismiss} style={ghostBtnStyle}>
              Dismiss
            </button>
          </>
        )}
        {phase === 'cancelled' && (
          <button type="button" onClick={onDismiss} style={ghostBtnStyle}>
            Dismiss
          </button>
        )}
        {(phase === 'queued' || phase === 'planning' || phase === 'rendering'
          || phase === 'assembling' || phase === 'uploading') && (
          <button
            type="button"
            onClick={handleCancel}
            disabled={cancelling}
            data-testid="export-cancel"
            style={destructiveBtnStyle}
          >
            {cancelling ? 'Cancelling…' : 'Cancel'}
          </button>
        )}
      </div>
    </div>
  )
}

function deriveVisual(job: ExportJob): {
  title: string
  subtitle: string
  dotColor: string
  pulse: boolean
  showProgress: boolean
} {
  const phase = job.progress.phase ?? job.status
  switch (phase) {
    case 'queued':
      return {
        title: 'Export queued',
        subtitle: 'Planning…',
        dotColor: 'var(--color-text-muted)',
        pulse: true,
        showProgress: true,
      }
    case 'planning':
      return {
        title: 'Planning export…',
        subtitle: 'Counting chapters',
        dotColor: 'var(--color-agent-running)',
        pulse: true,
        showProgress: true,
      }
    case 'rendering':
      return {
        title: 'Exporting…',
        subtitle: 'Rendering',
        dotColor: 'var(--color-agent-running)',
        pulse: true,
        showProgress: true,
      }
    case 'assembling':
      return {
        title: 'Assembling…',
        subtitle: 'Finalising structure',
        dotColor: 'var(--color-agent-running)',
        pulse: true,
        showProgress: true,
      }
    case 'uploading':
      return {
        title: 'Uploading…',
        subtitle: 'Almost ready',
        dotColor: 'var(--color-agent-running)',
        pulse: true,
        showProgress: true,
      }
    case 'completed':
      return {
        title: 'Export ready',
        subtitle: '',
        dotColor: 'var(--color-accent)',
        pulse: false,
        showProgress: false,
      }
    case 'failed':
      return {
        title: 'Export failed',
        subtitle: '',
        dotColor: 'var(--color-error)',
        pulse: false,
        showProgress: false,
      }
    case 'cancelled':
      return {
        title: 'Export cancelled',
        subtitle: '',
        dotColor: 'var(--color-text-muted)',
        pulse: false,
        showProgress: false,
      }
    default:
      return {
        title: 'Export',
        subtitle: '',
        dotColor: 'var(--color-text-muted)',
        pulse: false,
        showProgress: false,
      }
  }
}

const primaryBtnStyle: React.CSSProperties = {
  fontSize: 10,
  padding: '4px 10px',
  borderRadius: 3,
  border: '1px solid var(--color-text-primary)',
  background: 'var(--color-text-primary)',
  color: 'var(--color-bg-base)',
  fontWeight: 500,
  cursor: 'pointer',
}

const ghostBtnStyle: React.CSSProperties = {
  fontSize: 10,
  padding: '4px 10px',
  borderRadius: 3,
  border: '1px solid var(--color-border-default)',
  background: 'transparent',
  color: 'var(--color-text-secondary)',
  cursor: 'pointer',
}

const destructiveBtnStyle: React.CSSProperties = {
  fontSize: 10,
  padding: '4px 10px',
  borderRadius: 3,
  border: '1px solid var(--color-error)',
  background: 'transparent',
  color: 'var(--color-error)',
  cursor: 'pointer',
}
