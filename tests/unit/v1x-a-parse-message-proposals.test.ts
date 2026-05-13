/**
 * V1.x-A — parseMessageProposals unit tests.
 *
 * Verifies that proposal blocks are extracted from persisted message
 * content (the read-time mirror of executor.ts's suppression/parse).
 */

import { describe, expect, it } from 'vitest'

import { parseMessageProposals } from '@/lib/director/parse-message-proposals'

describe('parseMessageProposals', () => {
  it('returns content unchanged when no block is present', () => {
    const content = 'A plain message with no proposal block.'
    const result = parseMessageProposals(content)
    expect(result.cleanedContent).toBe(content)
    expect(result.workflowProposal).toBeNull()
    expect(result.briefProposal).toBeNull()
    expect(result.briefAmendmentProposal).toBeNull()
  })

  it('extracts a workflow_proposal block', () => {
    const json = JSON.stringify({
      title: 'Test workflow',
      steps: [
        {
          operation_type: 'comment',
          target_node_id: '00000000-0000-0000-0000-000000000000',
          description: 'Test',
          estimated_duration_seconds: 1,
          parameters: { comment_type: 'note', content: 'hi' },
        },
      ],
    })
    const content = `Some preamble.\n<workflow_proposal>${json}</workflow_proposal>\nTrailing text.`
    const result = parseMessageProposals(content)
    expect(result.workflowProposal).not.toBeNull()
    expect(result.workflowProposal?.title).toBe('Test workflow')
    expect(result.cleanedContent).not.toContain('<workflow_proposal>')
    expect(result.cleanedContent).toContain('preamble')
    expect(result.cleanedContent).toContain('Trailing text')
  })

  it('extracts a brief_proposal block', () => {
    const json = JSON.stringify({
      goal_text: 'Write a thing',
      preferences: { voice: 'crisp' },
      stages: [
        { order: 1, title: 'Stage 1', trigger_type: 'manual' },
      ],
    })
    const content = `Here is the Brief I propose.\n<brief_proposal>${json}</brief_proposal>`
    const result = parseMessageProposals(content)
    expect(result.briefProposal).not.toBeNull()
    expect(result.briefProposal?.goal_text).toBe('Write a thing')
    expect(result.cleanedContent).not.toContain('<brief_proposal>')
  })

  it('extracts a brief_amendment_proposal block', () => {
    const json = JSON.stringify({
      amendment_type: 'add_constraint',
      target_path: 'preferences.constraints',
      after: ['no contractions'],
      reason: 'Author rule.',
    })
    const content = `Adding a constraint.\n<brief_amendment_proposal>${json}</brief_amendment_proposal>`
    const result = parseMessageProposals(content)
    expect(result.briefAmendmentProposal).not.toBeNull()
    expect(result.briefAmendmentProposal?.amendment_type).toBe('add_constraint')
    expect(result.cleanedContent).not.toContain('<brief_amendment_proposal>')
  })

  it('returns nulls on malformed JSON inside a block', () => {
    const content = '<brief_proposal>{ not valid json }</brief_proposal>'
    const result = parseMessageProposals(content)
    expect(result.briefProposal).toBeNull()
  })

  it('handles a tolerant trailing-block without close tag', () => {
    const json = JSON.stringify({
      goal_text: 'truncated',
      preferences: {},
      stages: [{ order: 1, title: 'S', trigger_type: 'manual' }],
    })
    const content = `Preamble.\n<brief_proposal>${json}`
    const result = parseMessageProposals(content)
    expect(result.briefProposal?.goal_text).toBe('truncated')
    expect(result.cleanedContent).toBe('Preamble.')
  })
})
