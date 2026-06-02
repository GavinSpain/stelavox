// Phase 8.01.C T-9 — InlineWorkflowProposalCard render contract.
//
// Spot-checks Inviolable #2 (verdigris LEFT border only — within use #7
// affirmative-action triggers family; no new use), the Approve button,
// and the conditional Modify link.

import { describe, expect, it } from 'vitest'
import { renderToString } from 'react-dom/server'
import React from 'react'

import { InlineWorkflowProposalCard } from '@/components/director/InlineWorkflowProposalCard'
import type { WorkflowProposalParsed } from '@/lib/director/schemas'

const SAMPLE: WorkflowProposalParsed = {
  title: 'Expand Act 1',
  description: 'Generate chapters under act 1',
  steps: [
    {
      operation_type: 'expand',
      target_node_id: '00000000-0000-0000-0000-000000000001',
      description: 'Create the first three chapters',
      estimated_duration_seconds: 60,
      parameters: { child_count_target: 3 },
    },
  ],
  locked_nodes_requiring_unlock: [],
}

describe('InlineWorkflowProposalCard', () => {
  it('renders title + step + Approve button (Modify hidden when handler omitted)', () => {
    const html = renderToString(
      React.createElement(InlineWorkflowProposalCard, {
        workflowProposal: SAMPLE,
        onApprove: () => {},
      }),
    )
    expect(html).toMatch(/data-testid="inline-workflow-proposal"/)
    expect(html).toContain('Expand Act 1')
    expect(html).toContain('Create the first three chapters')
    expect(html).toMatch(/data-testid="inline-workflow-approve"/)
    expect(html).toContain('Approve')
    expect(html).not.toMatch(/data-testid="inline-workflow-modify"/)
  })

  it('Modify link rendered when onModify provided', () => {
    const html = renderToString(
      React.createElement(InlineWorkflowProposalCard, {
        workflowProposal: SAMPLE,
        onApprove: () => {},
        onModify: () => {},
      }),
    )
    expect(html).toMatch(/data-testid="inline-workflow-modify"/)
    expect(html).toContain('Modify')
  })

  it('LEFT border only is verdigris (Inviolable #2 use #7 — no broadening)', () => {
    const html = renderToString(
      React.createElement(InlineWorkflowProposalCard, {
        workflowProposal: SAMPLE,
        onApprove: () => {},
      }),
    )
    // Card container border-left uses --color-accent.
    expect(html).toMatch(/border-left:1px solid var\(--color-accent\)/)
    // Approve button uses --color-accent as background (use #7).
    expect(html).toMatch(/data-testid="inline-workflow-approve"[^>]*var\(--color-accent\)|background:var\(--color-accent\)[^>]*data-testid="inline-workflow-approve"/)
  })

  it('Approve button disabled when disabled=true', () => {
    const html = renderToString(
      React.createElement(InlineWorkflowProposalCard, {
        workflowProposal: SAMPLE,
        onApprove: () => {},
        disabled: true,
      }),
    )
    // The disabled attribute appears on the button.
    expect(html).toMatch(/<button[^>]*data-testid="inline-workflow-approve"[^>]*disabled/)
  })

  it('renders step operation label "Expand" via the operation map', () => {
    const html = renderToString(
      React.createElement(InlineWorkflowProposalCard, {
        workflowProposal: SAMPLE,
        onApprove: () => {},
      }),
    )
    expect(html).toContain('Expand')
  })
})
