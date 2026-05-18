/**
 * V1.x-F.1 — report_capability_limit tool unit tests.
 *
 * Source: stelavox_v1x_f_build_checklist_v1_1.md §5 F.1 +
 *         lib/director/tools/write.ts:execReportCapabilityLimit +
 *         lib/director/parse-message-proposals.ts:findProposalInToolCalls
 *         (V1.x-F.1 extension with capabilityLimitProposal).
 *
 * H-08 invariant: write tools never execute DB writes. The executor
 * returns a capability_limit_proposal artefact; the UI surfaces a
 * CapabilityLimitCard; the user reformulates manually.
 */

import { describe, expect, it } from 'vitest'

import { execReportCapabilityLimit } from '@/lib/director/tools/write'
import { findProposalInToolCalls } from '@/lib/director/parse-message-proposals'
import { isWriteTool, WRITE_TOOL_NAMES, ToolInputSchemas } from '@/lib/director/schemas'

const session = {
  conversation_id: '00000000-0000-0000-0000-000000000001',
  document_id: '00000000-0000-0000-0000-000000000002',
  organisation_id: '00000000-0000-0000-0000-000000000003',
  user_id: '00000000-0000-0000-0000-000000000004',
}

describe('execReportCapabilityLimit (V1.x-F.1)', () => {
  it('returns capability_limit_proposal on valid args', async () => {
    const r = await execReportCapabilityLimit(
      {
        detected_limit: 'per_iteration_cap',
        suggested_alternative: 'Plan chapters 1-10 in the first workflow.',
        reason: 'Per-iteration cap is 30 nodes; you asked for ~150.',
      },
      session,
    )
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.capability_limit_proposal).toBeDefined()
      expect(r.capability_limit_proposal?.detected_limit).toBe('per_iteration_cap')
      expect(r.capability_limit_proposal?.suggested_alternative).toMatch(/chapters 1-10/)
    }
  })

  it('rejects unknown detected_limit', async () => {
    const r = await execReportCapabilityLimit(
      {
        detected_limit: 'bogus_limit',
        suggested_alternative: 'x',
        reason: 'y',
      },
      session,
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('invalid_detected_limit')
  })

  it('rejects empty suggested_alternative', async () => {
    const r = await execReportCapabilityLimit(
      {
        detected_limit: 'token_budget',
        suggested_alternative: '   ',
        reason: 'over budget',
      },
      session,
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('invalid_suggested_alternative')
  })

  it('rejects empty reason', async () => {
    const r = await execReportCapabilityLimit(
      {
        detected_limit: 'tool_count',
        suggested_alternative: 'use fewer tools',
        reason: '',
      },
      session,
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('invalid_reason')
  })

  it('returns capability_limit_proposal for "other" detected_limit', async () => {
    const r = await execReportCapabilityLimit(
      {
        detected_limit: 'other',
        suggested_alternative: 'Try a smaller scope first.',
        reason: 'This pattern doesn\'t fit cleanly in one workflow.',
      },
      session,
    )
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.capability_limit_proposal?.detected_limit).toBe('other')
  })
})

describe('report_capability_limit registry wiring (V1.x-F.1)', () => {
  it('is registered as a write tool', () => {
    expect(isWriteTool('report_capability_limit')).toBe(true)
  })

  it('appears in WRITE_TOOL_NAMES (12 total post-M-179: V1.x-F.1 11 + create_rename_step)', () => {
    expect(WRITE_TOOL_NAMES).toContain('report_capability_limit')
    expect(WRITE_TOOL_NAMES.length).toBe(12)
  })

  it('zod schema accepts a valid artefact', () => {
    const r = ToolInputSchemas.report_capability_limit.safeParse({
      detected_limit: 'per_iteration_cap',
      suggested_alternative: 'x',
      reason: 'y',
    })
    expect(r.success).toBe(true)
  })

  it('zod schema rejects extra keys (strict)', () => {
    const r = ToolInputSchemas.report_capability_limit.safeParse({
      detected_limit: 'per_iteration_cap',
      suggested_alternative: 'x',
      reason: 'y',
      extra: 'should be rejected',
    })
    expect(r.success).toBe(false)
  })
})

describe('findProposalInToolCalls — capabilityLimitProposal (V1.x-F.1)', () => {
  it('extracts capability_limit_proposal artefact from tool_calls', () => {
    const toolCalls = [
      {
        name: 'report_capability_limit',
        proposal_artefact: {
          detected_limit: 'per_iteration_cap' as const,
          suggested_alternative: 'Plan in batches.',
          reason: 'cap is 30',
        },
      },
    ]
    const result = findProposalInToolCalls(toolCalls)
    expect(result.capabilityLimitProposal).not.toBeNull()
    expect(result.capabilityLimitProposal?.detected_limit).toBe('per_iteration_cap')
  })

  it('returns null when proposal_artefact is malformed', () => {
    const toolCalls = [
      {
        name: 'report_capability_limit',
        proposal_artefact: {
          detected_limit: 'bogus_value',
          suggested_alternative: '',
          reason: 'x',
        },
      },
    ]
    const result = findProposalInToolCalls(toolCalls)
    expect(result.capabilityLimitProposal).toBeNull()
  })

  it('returns null shape with all 5 fields when no tool_calls', () => {
    const result = findProposalInToolCalls(null)
    expect(result).toEqual({
      briefProposal: null,
      briefProposalConcurrentEdit: null,
      profileAmendmentProposal: null,
      briefCancellationProposal: null,
      capabilityLimitProposal: null,
    })
  })
})
