/**
 * V1.x-B.3 — brief amendment validator unit tests.
 *
 * Source: stelavox_v1x_b_3_build_checklist_v1_0.md §6 +
 *         lib/brief/amendments.ts:validateBriefAmendmentProposal.
 */

import { describe, expect, it } from 'vitest'

import { validateBriefAmendmentProposal } from '@/lib/brief/amendments'

const briefId = '11111111-1111-1111-1111-111111111111'

describe('validateBriefAmendmentProposal — goal_text', () => {
  it('accepts a valid goal_text amendment', () => {
    expect(() => validateBriefAmendmentProposal({
      brief_id: briefId,
      amendment_type: 'goal_text',
      after: { goal_text: 'tighter scope' },
      reason: 'narrowing the focus',
    })).not.toThrow()
  })
  it('rejects empty goal_text', () => {
    expect(() => validateBriefAmendmentProposal({
      brief_id: briefId,
      amendment_type: 'goal_text',
      after: { goal_text: '' },
      reason: 'r',
    })).toThrow(/cannot be empty/)
  })
  it('rejects missing goal_text', () => {
    expect(() => validateBriefAmendmentProposal({
      brief_id: briefId,
      amendment_type: 'goal_text',
      after: {},
      reason: 'r',
    })).toThrow(/required string/)
  })
  it('rejects goal_text over 4096 chars', () => {
    expect(() => validateBriefAmendmentProposal({
      brief_id: briefId,
      amendment_type: 'goal_text',
      after: { goal_text: 'x'.repeat(4097) },
      reason: 'r',
    })).toThrow(/exceeds 4096/)
  })
})

describe('validateBriefAmendmentProposal — preferences', () => {
  it('accepts a non-empty preferences object', () => {
    expect(() => validateBriefAmendmentProposal({
      brief_id: briefId,
      amendment_type: 'preferences',
      after: { voice_rules: ['less adverbs'] },
      reason: 'r',
    })).not.toThrow()
  })
})

describe('validateBriefAmendmentProposal — add_stage', () => {
  it('accepts a valid add_stage', () => {
    expect(() => validateBriefAmendmentProposal({
      brief_id: briefId,
      amendment_type: 'add_stage',
      after: { order: 2, title: 'Stage 2', trigger_type: 'after_stage' },
      reason: 'r',
    })).not.toThrow()
  })
  it('rejects missing title', () => {
    expect(() => validateBriefAmendmentProposal({
      brief_id: briefId,
      amendment_type: 'add_stage',
      after: { order: 2 },
      reason: 'r',
    })).toThrow(/title/)
  })
  it('rejects negative order', () => {
    expect(() => validateBriefAmendmentProposal({
      brief_id: briefId,
      amendment_type: 'add_stage',
      after: { order: -1, title: 'x' },
      reason: 'r',
    })).toThrow(/order/)
  })
  it('rejects unknown trigger_type', () => {
    expect(() => validateBriefAmendmentProposal({
      brief_id: briefId,
      amendment_type: 'add_stage',
      after: { order: 2, title: 'x', trigger_type: 'bogus' },
      reason: 'r',
    })).toThrow(/trigger_type/)
  })
})

describe('validateBriefAmendmentProposal — modify/remove_pending_stage', () => {
  it('rejects modify_pending_stage without target_path', () => {
    expect(() => validateBriefAmendmentProposal({
      brief_id: briefId,
      amendment_type: 'modify_pending_stage',
      after: { title: 'x' },
      reason: 'r',
    })).toThrow(/target_path/)
  })
  it('rejects remove_pending_stage without target_path', () => {
    expect(() => validateBriefAmendmentProposal({
      brief_id: briefId,
      amendment_type: 'remove_pending_stage',
      after: {},
      reason: 'r',
    })).toThrow(/target_path/)
  })
  it('accepts modify_pending_stage with target_path', () => {
    expect(() => validateBriefAmendmentProposal({
      brief_id: briefId,
      amendment_type: 'modify_pending_stage',
      target_path: '22222222-2222-2222-2222-222222222222',
      after: { title: 'Renamed' },
      reason: 'r',
    })).not.toThrow()
  })
})

describe('validateBriefAmendmentProposal — common', () => {
  it('rejects empty reason', () => {
    expect(() => validateBriefAmendmentProposal({
      brief_id: briefId,
      amendment_type: 'goal_text',
      after: { goal_text: 'x' },
      reason: '',
    })).toThrow(/reason/)
  })
  it('rejects missing brief_id', () => {
    expect(() => validateBriefAmendmentProposal({
      brief_id: '',
      amendment_type: 'goal_text',
      after: { goal_text: 'x' },
      reason: 'r',
    })).toThrow(/brief_id/)
  })
})
