/**
 * Parse proposal blocks out of an assistant message's persisted content.
 *
 * The Director streams the full text including a proposal block; the
 * client-side suppression (consumeTextForDelta) only affects in-flight
 * text_delta events, NOT the conversation_messages.content row that gets
 * persisted. So when rendering an assistant message from the DB, we need
 * to detect any embedded `<workflow_proposal>`, `<brief_proposal>`, or
 * `<brief_amendment_proposal>` block, strip it from the rendered text,
 * and surface the parsed payload to the UI for card rendering.
 *
 * This is the read-time mirror of executor.ts's parseWorkflowProposal /
 * parseBriefProposal / parseBriefAmendmentProposal — same regex grammar,
 * just operating on the persisted content rather than the streaming
 * accumulator.
 */

import type {
  WorkflowProposalParsed,
  BriefProposalParsed,
  BriefAmendmentProposalParsed,
} from '@/lib/director/schemas'
import {
  WorkflowProposalSchema,
  BriefProposalSchema,
  BriefAmendmentProposalSchema,
} from '@/lib/director/schemas'

export interface MessageProposals {
  /** Content with proposal blocks removed. */
  cleanedContent: string
  workflowProposal: WorkflowProposalParsed | null
  briefProposal: BriefProposalParsed | null
  briefAmendmentProposal: BriefAmendmentProposalParsed | null
}

export function parseMessageProposals(content: string): MessageProposals {
  let cleaned = content
  const result: MessageProposals = {
    cleanedContent: content,
    workflowProposal: null,
    briefProposal: null,
    briefAmendmentProposal: null,
  }

  // Try workflow_proposal
  const workflow = extractBlock(cleaned, 'workflow_proposal')
  if (workflow) {
    cleaned = workflow.cleaned
    try {
      const parsed = WorkflowProposalSchema.safeParse(JSON.parse(workflow.body))
      if (parsed.success) result.workflowProposal = parsed.data
    } catch {
      // malformed — ignore, leave proposal null
    }
  }

  const brief = extractBlock(cleaned, 'brief_proposal')
  if (brief) {
    cleaned = brief.cleaned
    try {
      const parsed = BriefProposalSchema.safeParse(JSON.parse(brief.body))
      if (parsed.success) result.briefProposal = parsed.data
    } catch {
      // malformed — ignore
    }
  }

  const amendment = extractBlock(cleaned, 'brief_amendment_proposal')
  if (amendment) {
    cleaned = amendment.cleaned
    try {
      const parsed = BriefAmendmentProposalSchema.safeParse(JSON.parse(amendment.body))
      if (parsed.success) result.briefAmendmentProposal = parsed.data
    } catch {
      // malformed — ignore
    }
  }

  result.cleanedContent = cleaned.trim()
  return result
}

function extractBlock(
  text: string,
  tag: string,
): { body: string; cleaned: string } | null {
  const fenced = new RegExp(
    `<${tag}>\\s*(?:\`\`\`json)?\\s*([\\s\\S]*?)\\s*(?:\`\`\`)?\\s*</${tag}>`,
  )
  const m = text.match(fenced)
  if (m) {
    const cleaned = text.replace(m[0], '').trim()
    return { body: m[1].trim(), cleaned }
  }
  // Tolerant fallback: open tag at end-of-string, no close tag.
  const lazy = text.match(new RegExp(`<${tag}>\\s*([\\s\\S]*)$`))
  if (lazy) {
    const cleaned = text.replace(lazy[0], '').trim()
    return { body: lazy[1].trim(), cleaned }
  }
  return null
}
