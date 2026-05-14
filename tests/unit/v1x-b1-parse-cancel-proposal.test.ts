/**
 * V1.x-B.1.1 — parse-message-proposals: brief cancellation extraction.
 */

import { describe, expect, it } from 'vitest'

import { findProposalInToolCalls } from '@/lib/director/parse-message-proposals'

const BRIEF_ID = '11111111-1111-4111-8111-111111111111'

describe('findProposalInToolCalls — cancel_brief', () => {
  it('extracts a valid cancel artefact', () => {
    const toolCalls = [
      {
        id: 'call_001',
        name: 'cancel_brief',
        arguments: { brief_id: BRIEF_ID, reason: 'pivot' },
        validation_result: 'allowed',
        executed_at: new Date().toISOString(),
        result_summary: 'cancel proposal',
        proposal_artefact: {
          brief_id: BRIEF_ID,
          reason: 'pivot',
          brief_status_at_proposal: 'active',
          cascade_preview: {
            pending_stages: 2,
            completed_stages: 1,
            queued_brief_will_promote: true,
          },
        },
      },
    ]

    const result = findProposalInToolCalls(toolCalls)
    expect(result.briefCancellationProposal).not.toBeNull()
    expect(result.briefCancellationProposal?.brief_id).toBe(BRIEF_ID)
    expect(result.briefCancellationProposal?.cascade_preview.pending_stages).toBe(2)
    expect(result.briefCancellationProposal?.cascade_preview.queued_brief_will_promote).toBe(true)
    expect(result.briefProposal).toBeNull()
    expect(result.profileAmendmentProposal).toBeNull()
  })

  it('returns null when no cancel_brief tool call is present', () => {
    const toolCalls = [
      {
        id: 'call_002',
        name: 'get_brief_state',
        arguments: {},
        validation_result: 'allowed',
        executed_at: new Date().toISOString(),
        result_summary: 'returned data',
      },
    ]
    const result = findProposalInToolCalls(toolCalls)
    expect(result.briefCancellationProposal).toBeNull()
  })

  it('returns null when proposal_artefact is missing', () => {
    const toolCalls = [
      {
        id: 'call_003',
        name: 'cancel_brief',
        arguments: { brief_id: BRIEF_ID, reason: 'pivot' },
        validation_result: 'allowed',
        executed_at: new Date().toISOString(),
        result_summary: 'cancel proposal',
        // proposal_artefact intentionally absent
      },
    ]
    const result = findProposalInToolCalls(toolCalls)
    expect(result.briefCancellationProposal).toBeNull()
  })

  it('returns null when proposal_artefact is malformed (missing cascade_preview)', () => {
    const toolCalls = [
      {
        id: 'call_004',
        name: 'cancel_brief',
        arguments: { brief_id: BRIEF_ID, reason: 'pivot' },
        validation_result: 'allowed',
        executed_at: new Date().toISOString(),
        result_summary: 'cancel proposal',
        proposal_artefact: {
          brief_id: BRIEF_ID,
          reason: 'pivot',
          // brief_status_at_proposal + cascade_preview missing
        },
      },
    ]
    const result = findProposalInToolCalls(toolCalls)
    expect(result.briefCancellationProposal).toBeNull()
  })

  it('returns the most recent of multiple cancel_brief calls', () => {
    const toolCalls = [
      {
        id: 'call_005',
        name: 'cancel_brief',
        arguments: { brief_id: BRIEF_ID, reason: 'first attempt' },
        validation_result: 'allowed',
        executed_at: new Date(Date.now() - 1000).toISOString(),
        result_summary: 'cancel proposal',
        proposal_artefact: {
          brief_id: BRIEF_ID,
          reason: 'first attempt',
          brief_status_at_proposal: 'active',
          cascade_preview: { pending_stages: 1, completed_stages: 0, queued_brief_will_promote: false },
        },
      },
      {
        id: 'call_006',
        name: 'cancel_brief',
        arguments: { brief_id: BRIEF_ID, reason: 'revised reason' },
        validation_result: 'allowed',
        executed_at: new Date().toISOString(),
        result_summary: 'cancel proposal',
        proposal_artefact: {
          brief_id: BRIEF_ID,
          reason: 'revised reason',
          brief_status_at_proposal: 'active',
          cascade_preview: { pending_stages: 1, completed_stages: 0, queued_brief_will_promote: false },
        },
      },
    ]
    const result = findProposalInToolCalls(toolCalls)
    expect(result.briefCancellationProposal?.reason).toBe('revised reason')
  })

  it('handles non-array tool_calls gracefully', () => {
    const result = findProposalInToolCalls('not an array')
    expect(result.briefCancellationProposal).toBeNull()
    expect(result.briefProposal).toBeNull()
    expect(result.profileAmendmentProposal).toBeNull()
  })

  it('handles null tool_calls gracefully', () => {
    const result = findProposalInToolCalls(null)
    expect(result.briefCancellationProposal).toBeNull()
  })
})
