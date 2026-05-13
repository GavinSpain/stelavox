/**
 * Parse proposal artefacts out of an assistant message's persisted state.
 *
 * V1.x-A.1 (v1.6) — the architectural model is:
 *
 *   - Workflow proposals: legacy XML in message content (V1.x-A path). The
 *     model emits `<workflow_proposal>{...}</workflow_proposal>`; we strip
 *     it from rendered text and parse it for the PlanCard.
 *
 *   - Brief and Profile-amendment proposals: tool result IS the proposal.
 *     The Director writes a `<plan>...</plan>` scratchpad block in its
 *     message content (stripped from UI render), then calls `propose_brief`
 *     or `propose_profile_amendment`. The validated proposal artefact is
 *     stashed in `tool_calls[i].proposal_artefact` (set by the executor).
 *     The UI reads from there.
 *
 * Two helpers:
 *   - `parseMessageProposals(content)` — strips suppressed tags (`<plan>`,
 *     `<workflow_proposal>`, `<brief_proposal>`, `<profile_amendment_proposal>`)
 *     from the rendered content; extracts the workflow_proposal payload
 *     from XML if present.
 *   - `findProposalInToolCalls(toolCalls)` — V1.x-A.1 path. Looks up the
 *     most recent propose_brief / propose_profile_amendment call with an
 *     attached proposal_artefact and returns the validated payload.
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

const SUPPRESSED_TAGS = [
  'plan',
  'workflow_proposal',
  'brief_proposal',
  'profile_amendment_proposal',
] as const

export interface MessageProposals {
  /** Content with all suppressed proposal-style blocks stripped. */
  cleanedContent: string
  /** Parsed workflow_proposal payload (V1.x-A legacy XML path) or null. */
  workflowProposal: WorkflowProposalParsed | null
}

export function parseMessageProposals(content: string): MessageProposals {
  let cleaned = content
  let workflowProposal: WorkflowProposalParsed | null = null

  // Strip every suppressed tag from rendered content.
  for (const tag of SUPPRESSED_TAGS) {
    const extracted = extractBlock(cleaned, tag)
    if (extracted) {
      cleaned = extracted.cleaned
      // For workflow_proposal, also parse the JSON for the legacy XML path.
      if (tag === 'workflow_proposal') {
        try {
          const parsed = WorkflowProposalSchema.safeParse(JSON.parse(extracted.body))
          if (parsed.success) workflowProposal = parsed.data
        } catch {
          /* malformed — ignore */
        }
      }
    }
  }

  return { cleanedContent: cleaned.trim(), workflowProposal }
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
    return { body: m[1].trim(), cleaned: text.replace(m[0], '').trim() }
  }
  // Tolerant fallback: open tag without close (model truncated).
  const lazy = text.match(new RegExp(`<${tag}>\\s*([\\s\\S]*)$`))
  if (lazy) {
    return { body: lazy[1].trim(), cleaned: text.replace(lazy[0], '').trim() }
  }
  return null
}

// ---------------------------------------------------------------------------
// V1.x-A.1 — find Brief / Profile-amendment proposals in tool_calls.
// ---------------------------------------------------------------------------

interface ToolCallEntry {
  id: string
  name: string
  arguments: Record<string, unknown>
  validation_result: string
  executed_at: string
  result_summary: string
  proposal_artefact?: unknown
}

export interface ToolCallProposals {
  briefProposal: BriefProposalV1xA1Parsed | null
  profileAmendmentProposal: ProfileAmendmentProposalParsed | null
}

/**
 * Scan a conversation_messages.tool_calls array for a Director-proposed
 * Brief or Profile amendment. Returns the most recent of each kind.
 */
export function findProposalInToolCalls(toolCalls: unknown): ToolCallProposals {
  const empty: ToolCallProposals = { briefProposal: null, profileAmendmentProposal: null }
  if (!Array.isArray(toolCalls)) return empty

  let briefProposal: BriefProposalV1xA1Parsed | null = null
  let profileAmendmentProposal: ProfileAmendmentProposalParsed | null = null

  for (const raw of toolCalls) {
    if (!raw || typeof raw !== 'object') continue
    const entry = raw as ToolCallEntry
    if (entry.proposal_artefact === undefined) continue

    if (entry.name === 'propose_brief') {
      const r = BriefProposalV1xA1Schema.safeParse(entry.proposal_artefact)
      if (r.success) briefProposal = r.data
    } else if (entry.name === 'propose_profile_amendment') {
      const r = ProfileAmendmentProposalSchema.safeParse(entry.proposal_artefact)
      if (r.success) profileAmendmentProposal = r.data
    }
  }

  return { briefProposal, profileAmendmentProposal }
}
