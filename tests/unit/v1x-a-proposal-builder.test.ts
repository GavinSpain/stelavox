/**
 * V1.x-A — proposalBuilder unit tests.
 *
 * Covers the full validation chain for propose_brief and
 * propose_brief_amendment tool calls: Zod schema → preferences shape →
 * stage order uniqueness → after_stage refs (existence, lower-order
 * only) → cycle detection.
 */

import { describe, expect, it } from 'vitest'

import {
  buildBriefProposal,
  buildBriefAmendmentProposal,
} from '@/lib/brief/proposalBuilder'

const VALID_PROPOSAL = {
  goal_text: 'Write a literary noir novel.',
  preferences: {
    voice: 'dry, sardonic',
    constraints: ['no flashbacks before chapter 4'],
    decisions: ['protagonist: Marcus Holt'],
  },
  stages: [
    { order: 1, title: 'Premise', trigger_type: 'manual' },
    {
      order: 2,
      title: 'Act structure',
      trigger_type: 'after_stage',
      trigger_config: { after_stage_order: 1 },
    },
    {
      order: 3,
      title: 'Chapter expansion',
      trigger_type: 'after_stage',
      trigger_config: { after_stage_order: 2 },
    },
  ],
}

describe('buildBriefProposal', () => {
  it('builds a valid proposal artefact', () => {
    const result = buildBriefProposal(VALID_PROPOSAL)
    expect(result.goal_text).toBe(VALID_PROPOSAL.goal_text)
    expect(result.stages).toHaveLength(3)
    expect(result.preferences.voice).toBe('dry, sardonic')
  })

  it('rejects missing goal_text', () => {
    expect(() => buildBriefProposal({ ...VALID_PROPOSAL, goal_text: '' })).toThrow()
  })

  it('rejects empty stages', () => {
    expect(() => buildBriefProposal({ ...VALID_PROPOSAL, stages: [] })).toThrow()
  })

  it('rejects duplicate stage orders', () => {
    const bad = {
      ...VALID_PROPOSAL,
      stages: [
        { order: 1, title: 'A', trigger_type: 'manual' },
        { order: 1, title: 'B', trigger_type: 'manual' },
      ],
    }
    expect(() => buildBriefProposal(bad)).toThrow(/duplicate_stage_order/)
  })

  it('rejects after_stage references to non-existent stages', () => {
    const bad = {
      ...VALID_PROPOSAL,
      stages: [
        { order: 1, title: 'A', trigger_type: 'manual' },
        {
          order: 2,
          title: 'B',
          trigger_type: 'after_stage',
          trigger_config: { after_stage_order: 99 },
        },
      ],
    }
    expect(() => buildBriefProposal(bad)).toThrow(/dangling_after_stage_ref/)
  })

  it('rejects after_stage references to higher-or-equal orders (forward refs)', () => {
    const bad = {
      ...VALID_PROPOSAL,
      stages: [
        {
          order: 1,
          title: 'A',
          trigger_type: 'after_stage',
          trigger_config: { after_stage_order: 2 },
        },
        { order: 2, title: 'B', trigger_type: 'manual' },
      ],
    }
    expect(() => buildBriefProposal(bad)).toThrow(/forward_after_stage_ref/)
  })

  it('rejects an after_stage missing after_stage_order in trigger_config', () => {
    const bad = {
      ...VALID_PROPOSAL,
      stages: [
        { order: 1, title: 'A', trigger_type: 'manual' },
        {
          order: 2,
          title: 'B',
          trigger_type: 'after_stage',
          trigger_config: {},
        },
      ],
    }
    expect(() => buildBriefProposal(bad)).toThrow(/invalid_trigger_config/)
  })
})

describe('buildBriefAmendmentProposal', () => {
  it('builds a valid update_voice amendment', () => {
    const result = buildBriefAmendmentProposal({
      amendment_type: 'update_voice',
      target_path: 'preferences.voice',
      after: 'cold and clinical',
      reason: 'Author requested in chapter-2 conversation.',
    })
    expect(result.amendment_type).toBe('update_voice')
    expect(result.after).toBe('cold and clinical')
  })

  it('builds a valid update_goal_text amendment (no target_path)', () => {
    const result = buildBriefAmendmentProposal({
      amendment_type: 'update_goal_text',
      after: 'A refined goal description.',
      reason: 'Author refined intent.',
    })
    expect(result.amendment_type).toBe('update_goal_text')
    expect(result.target_path).toBeUndefined()
  })

  it('rejects non-update_goal_text amendments without target_path', () => {
    expect(() =>
      buildBriefAmendmentProposal({
        amendment_type: 'add_constraint',
        after: ['no contractions'],
        reason: 'New rule.',
      }),
    ).toThrow(/target_path_required/)
  })

  it('rejects invalid amendment_type', () => {
    expect(() =>
      buildBriefAmendmentProposal({
        amendment_type: 'insert_stage',
        target_path: 'stages',
        after: { title: 'Foo' },
        reason: 'Out of scope.',
      }),
    ).toThrow()
  })

  it('rejects oversized goal_text in update_goal_text', () => {
    expect(() =>
      buildBriefAmendmentProposal({
        amendment_type: 'update_goal_text',
        after: 'x'.repeat(6000),
        reason: 'Too long.',
      }),
    ).toThrow()
  })
})
