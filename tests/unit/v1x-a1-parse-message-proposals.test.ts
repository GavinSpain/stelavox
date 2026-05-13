/**
 * V1.x-A.1 — parseMessageProposals unit tests.
 */

import { describe, expect, it } from 'vitest'

import { parseMessageProposals } from '@/lib/director/parse-message-proposals'

describe('parseMessageProposals (V1.x-A.1)', () => {
  it('returns content unchanged when no block is present', () => {
    const content = 'A plain message with no proposal block.'
    const result = parseMessageProposals(content)
    expect(result.cleanedContent).toBe(content)
    expect(result.workflowProposal).toBeNull()
    expect(result.briefProposal).toBeNull()
    expect(result.profileAmendmentProposal).toBeNull()
  })

  it('extracts a brief_proposal block (V1.x-A.1 operation-level)', () => {
    const json = JSON.stringify({
      goal_text: 'Refine scene 3',
      stages: [
        {
          order: 1,
          title: 'Refine',
          trigger_type: 'manual',
          trigger_config: {},
          workflow: {
            title: 'Refine scene 3',
            steps: [
              {
                operation_type: 'refine',
                target_node_id: '11111111-1111-4111-8111-111111111111',
                description: 'Tighten.',
                estimated_duration_seconds: 45,
                parameters: { target_field: 'summary', instruction: 'Tighter.' },
              },
            ],
          },
        },
      ],
    })
    const content = `Plan it.\n<brief_proposal>${json}</brief_proposal>`
    const result = parseMessageProposals(content)
    expect(result.briefProposal).not.toBeNull()
    expect(result.briefProposal?.goal_text).toBe('Refine scene 3')
    expect(result.briefProposal?.stages).toHaveLength(1)
    expect(result.cleanedContent).not.toContain('<brief_proposal>')
  })

  it('extracts a profile_amendment_proposal block', () => {
    const json = JSON.stringify({
      amendment_type: 'add_constraint',
      target_path: 'preferences.constraints',
      after: ['no contractions'],
      reason: 'Author rule.',
    })
    const content = `Adding a constraint.\n<profile_amendment_proposal>${json}</profile_amendment_proposal>`
    const result = parseMessageProposals(content)
    expect(result.profileAmendmentProposal).not.toBeNull()
    expect(result.profileAmendmentProposal?.amendment_type).toBe('add_constraint')
    expect(result.cleanedContent).not.toContain('<profile_amendment_proposal>')
  })

  it('returns nulls on malformed JSON inside a block', () => {
    const content = '<brief_proposal>{ not valid json }</brief_proposal>'
    const result = parseMessageProposals(content)
    expect(result.briefProposal).toBeNull()
  })
})
