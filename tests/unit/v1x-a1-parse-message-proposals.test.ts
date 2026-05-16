/**
 * V1.x-A.1 (v1.6) — parseMessageProposals + findProposalInToolCalls tests.
 *
 * v1.6 architectural change: brief and profile-amendment proposals come
 * from tool_calls.proposal_artefact, NOT from XML in message content.
 * parseMessageProposals only strips suppressed tags + extracts workflow
 * XML; findProposalInToolCalls reads structured proposals from tool_calls.
 */

import { describe, expect, it } from 'vitest'

import {
  parseMessageProposals,
  findProposalInToolCalls,
} from '@/lib/director/parse-message-proposals'

const VALID_UUID = '11111111-1111-4111-8111-111111111111'

describe('parseMessageProposals (V1.x-A.1 v1.6)', () => {
  it('returns content unchanged when no blocks are present', () => {
    const content = 'A plain message with no proposal block.'
    const result = parseMessageProposals(content)
    expect(result.cleanedContent).toBe(content)
    expect(result.workflowProposal).toBeNull()
  })

  it('strips a <plan> block from rendered content', () => {
    const content = `Hello.\n<plan>\n1. Step\n2. Another step\n</plan>\nSo here is the visible prose.`
    const result = parseMessageProposals(content)
    expect(result.cleanedContent).not.toContain('<plan>')
    expect(result.cleanedContent).not.toContain('Step')
    expect(result.cleanedContent).toContain('visible prose')
  })

  it('extracts a workflow_proposal block (V1.x-A legacy XML path)', () => {
    const json = JSON.stringify({
      title: 'Test workflow',
      steps: [
        {
          operation_type: 'comment',
          target_node_id: VALID_UUID,
          description: 'Test',
          estimated_duration_seconds: 1,
          parameters: { comment_type: 'note', content: 'hi' },
        },
      ],
    })
    const content = `Preamble.\n<workflow_proposal>${json}</workflow_proposal>\nTrailing.`
    const result = parseMessageProposals(content)
    expect(result.workflowProposal).not.toBeNull()
    expect(result.workflowProposal?.title).toBe('Test workflow')
    expect(result.cleanedContent).not.toContain('<workflow_proposal>')
    expect(result.cleanedContent).toContain('Preamble')
    expect(result.cleanedContent).toContain('Trailing')
  })

  it('strips a defensive <brief_proposal> block from rendered content', () => {
    // v1.6 prompt instructs the model NOT to emit <brief_proposal> XML.
    // If a model regresses and emits one anyway, we strip it from the
    // rendered text so raw JSON doesn't leak to the user.
    const content = `Some prose.\n<brief_proposal>{"goal_text":"X","stages":[]}</brief_proposal>`
    const result = parseMessageProposals(content)
    expect(result.cleanedContent).not.toContain('<brief_proposal>')
    expect(result.cleanedContent).toContain('Some prose.')
  })

  it('handles a malformed/open <plan> tag at end of content', () => {
    const content = `Visible text.\n<plan>thinking that got truncated`
    const result = parseMessageProposals(content)
    expect(result.cleanedContent).toBe('Visible text.')
  })
})

describe('findProposalInToolCalls (V1.x-A.1 v1.6)', () => {
  it('returns nulls when tool_calls is not an array', () => {
    // V1.x-B.1.1 — shape extended with briefCancellationProposal.
    // V1.x-D.4 — shape extended with briefProposalConcurrentEdit.
    // V1.x-F.1 — shape extended with capabilityLimitProposal.
    expect(findProposalInToolCalls(null)).toEqual({
      briefProposal: null,
      profileAmendmentProposal: null,
      briefCancellationProposal: null,
      briefProposalConcurrentEdit: null,
      capabilityLimitProposal: null,
    })
    expect(findProposalInToolCalls({})).toEqual({
      briefProposal: null,
      profileAmendmentProposal: null,
      briefCancellationProposal: null,
      briefProposalConcurrentEdit: null,
      capabilityLimitProposal: null,
    })
  })

  it('returns nulls when no proposal artefact present', () => {
    const toolCalls = [
      { name: 'get_project_profile', proposal_artefact: undefined },
      { name: 'get_document_state' },
    ]
    expect(findProposalInToolCalls(toolCalls)).toEqual({
      briefProposal: null,
      profileAmendmentProposal: null,
      briefCancellationProposal: null,
      briefProposalConcurrentEdit: null,
      capabilityLimitProposal: null,
    })
  })

  it('extracts a Brief proposal from a propose_brief tool call', () => {
    const proposal = {
      goal_text: 'Refine scene 3',
      stages: [
        {
          order: 1,
          title: 'Refine',
          trigger_type: 'manual',
          trigger_config: {},
          workflow: {
            title: 'Refine scene 3 summary',
            steps: [
              {
                operation_type: 'refine',
                target_node_id: VALID_UUID,
                description: 'Tighten.',
                estimated_duration_seconds: 45,
                parameters: { target_field: 'summary', instruction: 'Tighter.' },
              },
            ],
          },
        },
      ],
    }
    const toolCalls = [
      { name: 'get_project_profile' },
      { name: 'propose_brief', proposal_artefact: proposal },
    ]
    const result = findProposalInToolCalls(toolCalls)
    expect(result.briefProposal).not.toBeNull()
    expect(result.briefProposal?.goal_text).toBe('Refine scene 3')
    expect(result.briefProposal?.stages).toHaveLength(1)
  })

  it('extracts a Profile amendment from a propose_profile_amendment call', () => {
    const amendment = {
      amendment_type: 'add_constraint',
      target_path: 'preferences.constraints',
      after: ['no contractions'],
      reason: 'Author rule.',
    }
    const toolCalls = [{ name: 'propose_profile_amendment', proposal_artefact: amendment }]
    const result = findProposalInToolCalls(toolCalls)
    expect(result.profileAmendmentProposal).not.toBeNull()
    expect(result.profileAmendmentProposal?.amendment_type).toBe('add_constraint')
  })

  it('returns nulls when artefact fails schema validation', () => {
    const toolCalls = [
      { name: 'propose_brief', proposal_artefact: { invalid: 'shape' } },
    ]
    const result = findProposalInToolCalls(toolCalls)
    expect(result.briefProposal).toBeNull()
  })
})
