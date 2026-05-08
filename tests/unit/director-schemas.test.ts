// SU-44 — TC-D-02 / TC-D-03 unit tests for the Director's workflow-proposal
// schemas. These were mode-skipped in tests/director/api.spec.ts because
// Playwright cannot dynamic-import the project's ESM lib/ modules.
//
// Vitest is the V1 launch tool for these and any future unit-level tests
// that need direct ESM imports of lib/* code.

import { describe, expect, it } from 'vitest'

import { parseWorkflowProposal } from '@/lib/director/executor'
import {
  WorkflowProposalSchema,
  WorkflowStepProposalSchema,
} from '@/lib/director/schemas'

const validRefineStep = {
  operation_type: 'refine',
  target_node_id: 'a7f3c1e2-4d5b-4f6a-9c8e-1b2a3d4e5f60',
  description: 'Tighten Ch 3 Sc 2 reflection.',
  estimated_duration_seconds: 45,
  parameters: {
    target_field: 'summary',
    instruction: 'Make the reflection briefer and tied to external action.',
  },
}

describe('TC-D-02 — parseWorkflowProposal rejects malformed JSON', () => {
  it('returns null when the proposal block contains invalid JSON', () => {
    const text = `Here is my plan.\n\n<workflow_proposal>\n{ this is not JSON\n</workflow_proposal>`
    expect(parseWorkflowProposal(text)).toBeNull()
  })

  it('returns null when no <workflow_proposal> block is present', () => {
    expect(parseWorkflowProposal('Some prose with no proposal at all.')).toBeNull()
  })

  it('returns null when the JSON is valid but the schema fails', () => {
    // Schema requires `title` and `steps`; this object has neither.
    const text = `<workflow_proposal>\n{"foo": "bar"}\n</workflow_proposal>`
    expect(parseWorkflowProposal(text)).toBeNull()
  })

  it('parses a well-formed proposal block', () => {
    const text = `Plan below.\n\n<workflow_proposal>\n${JSON.stringify({
      title: 'Test',
      steps: [validRefineStep],
    })}\n</workflow_proposal>`
    const result = parseWorkflowProposal(text)
    expect(result).not.toBeNull()
    expect(result?.title).toBe('Test')
    expect(result?.steps).toHaveLength(1)
  })

  it('parses proposals wrapped in fenced ```json blocks', () => {
    const text = `<workflow_proposal>\n\`\`\`json\n${JSON.stringify({
      title: 'Fenced',
      steps: [validRefineStep],
    })}\n\`\`\`\n</workflow_proposal>`
    const result = parseWorkflowProposal(text)
    expect(result?.title).toBe('Fenced')
  })
})

describe('TC-D-03 — WorkflowStepProposalSchema rejects missing required fields', () => {
  it('rejects a refine step with no target_node_id', () => {
    const stepWithout = { ...validRefineStep } as Partial<typeof validRefineStep>
    delete stepWithout.target_node_id
    const result = WorkflowStepProposalSchema.safeParse(stepWithout)
    expect(result.success).toBe(false)
  })

  it('rejects a refine step with missing parameters.target_field', () => {
    const result = WorkflowStepProposalSchema.safeParse({
      ...validRefineStep,
      parameters: { instruction: 'foo' }, // target_field missing
    })
    expect(result.success).toBe(false)
  })

  it('rejects a step with an unknown operation_type', () => {
    const result = WorkflowStepProposalSchema.safeParse({
      ...validRefineStep,
      operation_type: 'fabricated_op',
    })
    expect(result.success).toBe(false)
  })

  it('rejects a node_reorder step with missing parameters.new_order', () => {
    const result = WorkflowStepProposalSchema.safeParse({
      operation_type: 'node_reorder',
      target_node_id: 'a7f3c1e2-4d5b-4f6a-9c8e-1b2a3d4e5f60',
      description: 'Move it.',
      estimated_duration_seconds: 30,
      parameters: {},
    })
    expect(result.success).toBe(false)
  })

  it('accepts a well-formed refine step', () => {
    const result = WorkflowStepProposalSchema.safeParse(validRefineStep)
    expect(result.success).toBe(true)
  })

  it('rejects a workflow proposal with zero steps', () => {
    const result = WorkflowProposalSchema.safeParse({
      title: 'Empty',
      steps: [],
    })
    expect(result.success).toBe(false)
  })

  it('rejects a workflow proposal missing the title', () => {
    const result = WorkflowProposalSchema.safeParse({
      steps: [validRefineStep],
    })
    expect(result.success).toBe(false)
  })
})
