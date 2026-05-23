'use client'

// Spec: stelavox_component_specification_v2_10.md §17.3 (StageCard)
//
// Nested in BriefViewer (and, in V1.x-D, SchedulerPanel). One per Stage.
// Read-only in V1.x-A — the Approve button on `proposed` status is
// implemented but doesn't fire workflow dispatch (that lands with the
// scheduler in V1.x-B per V2 doc §8.4).
//
// Inviolable #2: the Approve button (when surfaced on a `proposed` stage)
// uses --color-accent as use #7 (affirmative-action trigger). No other
// accent uses in this file.

import type { BriefStageStatus, BriefStageTriggerType } from '@/lib/brief/types'

interface StageCardProps {
  order: number
  title: string
  description?: string | null
  trigger_type: BriefStageTriggerType
  status: BriefStageStatus
  is_current?: boolean
}

// 2026-05-21 simplification — narrowed status + trigger_type enums.
// 'proposing' renamed to 'planning' (system planning the stage's
// workflow). scheduled_at + compound trigger types dropped.
const STATUS_LABEL: Record<BriefStageStatus, string> = {
  planned: 'Planned',
  planning: 'Planning…',
  approved: 'Approved',
  scheduled: 'Scheduled',
  running: 'Running',
  completed: 'Completed',
  cancelled: 'Cancelled',
  skipped: 'Skipped',
}

const STATUS_COLOR: Record<BriefStageStatus, string> = {
  planned: 'var(--color-text-muted)',
  planning: 'var(--color-agent-running, var(--color-text-secondary))',
  approved: 'var(--color-text-primary)',
  scheduled: 'var(--color-text-primary)',
  running: 'var(--color-agent-running, var(--color-text-primary))',
  completed: 'var(--color-text-primary)',
  cancelled: 'var(--color-text-muted)',
  skipped: 'var(--color-text-muted)',
}

const TRIGGER_LABEL: Record<BriefStageTriggerType, string> = {
  after_stage: 'After previous stage',
  manual: 'Manual',
}

export function StageCard({
  order,
  title,
  description,
  trigger_type,
  status,
  is_current = false,
}: StageCardProps) {
  return (
    <li
      data-testid="stage-card"
      data-status={status}
      data-stage-order={order}
      style={{
        listStyle: 'none',
        padding: '10px 12px',
        borderRadius: 6,
        background: is_current
          ? 'var(--color-bg-elevated, rgba(255,255,255,0.04))'
          : 'transparent',
        border: '1px solid var(--color-border-subtle)',
        fontFamily: 'var(--font-inter), Inter, sans-serif',
      }}
    >
      <div style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
        <span
          aria-hidden
          style={{
            minWidth: 22,
            fontWeight: 400,
            fontSize: 12,
            color: 'var(--color-text-muted)',
          }}
        >
          {order}.
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontWeight: 500,
              fontSize: 13,
              color: 'var(--color-text-primary)',
              lineHeight: 1.3,
            }}
          >
            {title}
          </div>
          {description ? (
            <div
              style={{
                marginTop: 2,
                fontWeight: 300,
                fontSize: 12,
                color: 'var(--color-text-secondary)',
                lineHeight: 1.45,
              }}
            >
              {description}
            </div>
          ) : null}
          <div
            style={{
              marginTop: 4,
              fontSize: 10,
              fontWeight: 300,
              color: 'var(--color-text-muted)',
              display: 'flex',
              gap: 8,
              alignItems: 'center',
            }}
          >
            <span style={{ color: STATUS_COLOR[status] }}>{STATUS_LABEL[status]}</span>
            <span>·</span>
            <span>{TRIGGER_LABEL[trigger_type]}</span>
          </div>
        </div>
      </div>
    </li>
  )
}
