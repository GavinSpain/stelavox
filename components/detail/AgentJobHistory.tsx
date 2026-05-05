'use client'

/**
 * AgentJobHistory — document-level agent-job history list.
 *
 * Source: stelavox_phase5_api_contract_v1_0.md v1.2 §3.9
 *         stelavox_phase5_test_plan_v1_0.md TC-U-18, TC-U-27..TC-U-29, TC-V-07
 * Build Checklist T-14.1, T-14.2.
 *
 * Lists agent_jobs for a document, newest-first. Powered by the
 * useAgentJobsForDocument selector (real-time). Status filter +
 * operation-type filter. Click a row → opens that node.
 */

import { useState } from 'react'
import {
  useAgentJobsForDocument,
  type AgentJob,
} from '@/lib/hooks/useAgentJobsRealtime'

interface Props {
  documentId: string
}

const STATUS_FILTER_OPTIONS = [
  { value: '', label: 'all' },
  { value: 'pending', label: 'pending' },
  { value: 'running', label: 'running' },
  { value: 'completed', label: 'completed (review)' },
  { value: 'accepted', label: 'accepted' },
  { value: 'dismissed', label: 'dismissed' },
  { value: 'cancelled', label: 'cancelled' },
  { value: 'failed', label: 'failed' },
]

const OP_FILTER_OPTIONS = [
  { value: '', label: 'all' },
  { value: 'expand', label: 'expand' },
  { value: 'synthesise', label: 'synthesise' },
  { value: 'refine', label: 'refine' },
  { value: 'generate_context', label: 'generate context' },
]

const STATUS_ICON: Record<AgentJob['status'], string> = {
  pending: '◌',
  running: '⟳',
  completed: '◐',
  accepted: '✓',
  dismissed: '○',
  cancelled: '⊘',
  failed: '✗',
}

const STATUS_COLOUR: Record<AgentJob['status'], string> = {
  pending: 'var(--color-text-muted)',
  running: 'var(--color-agent-running)',
  completed: 'var(--color-text-primary)',
  accepted: 'var(--color-accent)',
  dismissed: 'var(--color-text-muted)',
  cancelled: 'var(--color-text-muted)',
  failed: 'var(--color-error)',
}

export function AgentJobHistory({ documentId }: Props) {
  const allJobs = useAgentJobsForDocument(documentId)
  const [statusFilter, setStatusFilter] = useState('')
  const [opFilter, setOpFilter] = useState('')

  const jobs = allJobs.filter((j) => {
    if (statusFilter && j.status !== statusFilter) return false
    if (opFilter && j.operation_type !== opFilter) return false
    return true
  })

  return (
    <div style={{ padding: 'var(--space-5)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          style={filterSelectStyle}
          aria-label="Filter by status"
        >
          {STATUS_FILTER_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <select
          value={opFilter}
          onChange={(e) => setOpFilter(e.target.value)}
          style={filterSelectStyle}
          aria-label="Filter by operation type"
        >
          {OP_FILTER_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      {jobs.length === 0 && (
        <div style={{ color: 'var(--color-text-muted)', fontSize: '12px' }}>
          No agent jobs match the current filters.
        </div>
      )}

      {jobs.map((j) => (
        <div
          key={j.id}
          style={{
            padding: '8px 10px',
            background: 'var(--color-bg-base)',
            border: '1px solid var(--color-border-subtle)',
            borderRadius: '4px',
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-3)',
          }}
        >
          <span
            aria-label={`status ${j.status}`}
            style={{ fontSize: '14px', color: STATUS_COLOUR[j.status], width: '20px' }}
          >
            {STATUS_ICON[j.status]}
          </span>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            <div
              style={{
                fontFamily: 'var(--font-inter), Inter, sans-serif',
                fontSize: '12px',
                color: 'var(--color-text-primary)',
              }}
            >
              {j.operation_type} · <span style={{ color: STATUS_COLOUR[j.status] }}>{j.status}</span>
              {j.cost_usd != null && (
                <span style={{ color: 'var(--color-text-muted)' }}>
                  {' · $'}
                  {j.cost_usd.toFixed(4)}
                </span>
              )}
            </div>
            <div
              style={{
                fontFamily: 'var(--font-inter), Inter, sans-serif',
                fontSize: '10px',
                fontWeight: 300,
                color: 'var(--color-text-muted)',
                marginTop: '2px',
              }}
            >
              {new Date(j.created_at).toLocaleString()}
              {j.model_id && (
                <>
                  {' · '}
                  {j.model_id}
                </>
              )}
              {j.error_message && (
                <span style={{ color: 'var(--color-error)' }}> · {j.error_message}</span>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

const filterSelectStyle: React.CSSProperties = {
  fontFamily: 'var(--font-inter), Inter, sans-serif',
  fontSize: '11px',
  padding: '4px 8px',
  background: 'var(--color-bg-base)',
  color: 'var(--color-text-primary)',
  border: '1px solid var(--color-border-subtle)',
  borderRadius: '4px',
}
