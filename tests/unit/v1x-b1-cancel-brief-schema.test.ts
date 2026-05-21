/**
 * V1.x-B.1.1 — cancel_brief schema + tool registration unit tests.
 */

import { describe, expect, it } from 'vitest'

import {
  BriefCancellationProposalSchema,
  ToolInputSchemas,
  WRITE_TOOL_NAMES,
  isWriteTool,
} from '@/lib/director/schemas'

describe('BriefCancellationProposalSchema', () => {
  it('accepts a valid proposal', () => {
    const r = BriefCancellationProposalSchema.safeParse({
      brief_id: '11111111-1111-4111-8111-111111111111',
      reason: 'User requested cancellation.',
    })
    expect(r.success).toBe(true)
  })

  it('rejects missing brief_id', () => {
    const r = BriefCancellationProposalSchema.safeParse({
      reason: 'no id',
    })
    expect(r.success).toBe(false)
  })

  it('rejects non-uuid brief_id', () => {
    const r = BriefCancellationProposalSchema.safeParse({
      brief_id: 'not-a-uuid',
      reason: 'invalid id',
    })
    expect(r.success).toBe(false)
  })

  it('rejects empty reason', () => {
    const r = BriefCancellationProposalSchema.safeParse({
      brief_id: '11111111-1111-4111-8111-111111111111',
      reason: '',
    })
    expect(r.success).toBe(false)
  })

  it('rejects reason over 2000 characters', () => {
    const r = BriefCancellationProposalSchema.safeParse({
      brief_id: '11111111-1111-4111-8111-111111111111',
      reason: 'x'.repeat(2001),
    })
    expect(r.success).toBe(false)
  })
})

describe('cancel_brief tool registration', () => {
  it('appears in WRITE_TOOL_NAMES', () => {
    expect(WRITE_TOOL_NAMES).toContain('cancel_brief')
  })

  it('has an entry in ToolInputSchemas', () => {
    expect(ToolInputSchemas.cancel_brief).toBeDefined()
  })

  it('isWriteTool recognises cancel_brief', () => {
    expect(isWriteTool('cancel_brief')).toBe(true)
  })

  it('total write-tool count is 5 (post-2026-05-21 simplification)', () => {
    // Phase 2 (2026-05-19) removed the 7 create_*_step tools from
    // WRITE_TOOL_NAMES.
    // 2026-05-21 simplification: propose_brief_amendment dropped,
    // propose_workflow added for system-driven stage planning. Count
    // stays at 5: propose_brief, propose_profile_amendment,
    // cancel_brief, propose_workflow, report_capability_limit.
    expect(WRITE_TOOL_NAMES.length).toBe(5)
  })
})
