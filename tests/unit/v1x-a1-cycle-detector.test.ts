/**
 * V1.x-A.1 — cycleDetector unit tests.
 *
 * H-19 mitigation: stage trigger cycles detected at proposal-validation
 * time. V1.x-A.1 doesn't fire triggers automatically (that's V1.x-B), but
 * the cycle check prevents the V1.x-B scheduler from inheriting a cyclic
 * Brief.
 */

import { describe, expect, it } from 'vitest'

import { detectStageTriggerCycles } from '@/lib/brief/cycleDetector'
import type { BriefProposalStageInput } from '@/lib/brief/types'

function stage(
  order: number,
  trigger_type: BriefProposalStageInput['trigger_type'],
  trigger_config: BriefProposalStageInput['trigger_config'] = {},
): BriefProposalStageInput {
  return { order, title: `Stage ${order}`, trigger_type, trigger_config, workflow: null }
}

describe('detectStageTriggerCycles (V1.x-A.1)', () => {
  it('accepts a linear after_stage chain', () => {
    const stages = [
      stage(1, 'manual'),
      stage(2, 'after_stage', { after_stage_order: 1 }),
      stage(3, 'after_stage', { after_stage_order: 2 }),
    ]
    expect(detectStageTriggerCycles(stages)).toEqual({ ok: true })
  })

  it('accepts a DAG with shared dependency', () => {
    const stages = [
      stage(1, 'manual'),
      stage(2, 'after_stage', { after_stage_order: 1 }),
      stage(3, 'after_stage', { after_stage_order: 1 }),
      stage(4, 'compound', {
        conditions: [
          { type: 'after_stage', after_stage_order: 2 },
          { type: 'after_stage', after_stage_order: 3 },
        ],
      }),
    ]
    expect(detectStageTriggerCycles(stages)).toEqual({ ok: true })
  })

  it('detects a 2-stage cycle', () => {
    const stages = [
      stage(1, 'after_stage', { after_stage_order: 2 }),
      stage(2, 'after_stage', { after_stage_order: 1 }),
    ]
    const result = detectStageTriggerCycles(stages)
    expect(result.ok).toBe(false)
  })

  it('detects a 3-stage cycle', () => {
    const stages = [
      stage(1, 'after_stage', { after_stage_order: 3 }),
      stage(2, 'after_stage', { after_stage_order: 1 }),
      stage(3, 'after_stage', { after_stage_order: 2 }),
    ]
    const result = detectStageTriggerCycles(stages)
    expect(result.ok).toBe(false)
  })

  it('detects a cycle via compound trigger', () => {
    const stages = [
      stage(1, 'manual'),
      stage(2, 'compound', {
        conditions: [
          { type: 'after_stage', after_stage_order: 3 },
          { type: 'scheduled_at', scheduled_at: '2026-06-01T00:00:00Z' },
        ],
      }),
      stage(3, 'after_stage', { after_stage_order: 2 }),
    ]
    const result = detectStageTriggerCycles(stages)
    expect(result.ok).toBe(false)
  })

  it('treats scheduled_at and manual stages as cycle-free', () => {
    const stages = [
      stage(1, 'manual'),
      stage(2, 'scheduled_at', { scheduled_at: '2026-06-01T00:00:00Z' }),
    ]
    expect(detectStageTriggerCycles(stages)).toEqual({ ok: true })
  })
})
