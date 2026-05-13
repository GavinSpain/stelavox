/**
 * Parse proposal blocks out of an assistant message's persisted content.
 *
 * V1.x-A.1: three artefacts supported — <workflow_proposal> (legacy),
 * <brief_proposal> (V1.x-A.1 operation-level), <profile_amendment_proposal>
 * (V1.x-A.1 Profile delta).
 */

import type {
  WorkflowProposalParsed,
  BriefProposalV1xA1Parsed,
  ProfileAmendmentProposalParsed,
} from '@/lib/director/schemas'
import {
  WorkflowProposalSchema,
  BriefProposalV1xA1Schema,
  ProfileAmendmentProposalSchema,
} from '@/lib/director/schemas'

export interface MessageProposals {
  cleanedContent: string
  workflowProposal: WorkflowProposalParsed | null
  briefProposal: BriefProposalV1xA1Parsed | null
  profileAmendmentProposal: ProfileAmendmentProposalParsed | null
}

export function parseMessageProposals(content: string): MessageProposals {
  let cleaned = content
  const result: MessageProposals = {
    cleanedContent: content,
    workflowProposal: null,
    briefProposal: null,
    profileAmendmentProposal: null,
  }

  const workflow = extractBlock(cleaned, 'workflow_proposal')
  if (workflow) {
    cleaned = workflow.cleaned
    try {
      const parsed = WorkflowProposalSchema.safeParse(JSON.parse(workflow.body))
      if (parsed.success) result.workflowProposal = parsed.data
    } catch { /* malformed — ignore */ }
  }

  const brief = extractBlock(cleaned, 'brief_proposal')
  if (brief) {
    cleaned = brief.cleaned
    try {
      const parsed = BriefProposalV1xA1Schema.safeParse(JSON.parse(brief.body))
      if (parsed.success) result.briefProposal = parsed.data
    } catch { /* malformed — ignore */ }
  }

  const amendment = extractBlock(cleaned, 'profile_amendment_proposal')
  if (amendment) {
    cleaned = amendment.cleaned
    try {
      const parsed = ProfileAmendmentProposalSchema.safeParse(JSON.parse(amendment.body))
      if (parsed.success) result.profileAmendmentProposal = parsed.data
    } catch { /* malformed — ignore */ }
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
  const lazy = text.match(new RegExp(`<${tag}>\\s*([\\s\\S]*)$`))
  if (lazy) {
    const cleaned = text.replace(lazy[0], '').trim()
    return { body: lazy[1].trim(), cleaned }
  }
  return null
}
