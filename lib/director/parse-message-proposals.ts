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
import type { BriefCancellationProposalArtefact } from '@/lib/director/types'

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

export interface ConcurrentEditWarning {
  node_ids: string[]
  conflicting_brief_ids: string[]
  message: string
}

export interface ToolCallProposals {
  briefProposal: BriefProposalV1xA1Parsed | null
  /** V1.x-D.4 — concurrent-edit warning attached to brief proposal artefacts. */
  briefProposalConcurrentEdit: ConcurrentEditWarning | null
  profileAmendmentProposal: ProfileAmendmentProposalParsed | null
  /** V1.x-B.1.1 — destructive Brief cancellation proposal. */
  briefCancellationProposal: BriefCancellationProposalArtefact | null
}

/**
 * Scan a conversation_messages.tool_calls array for a Director-proposed
 * Brief, Profile amendment, or Brief cancellation. Returns the most
 * recent of each kind. The UI uses these to re-render the matching
 * proposal card after a page reload.
 */
export function findProposalInToolCalls(toolCalls: unknown): ToolCallProposals {
  const empty: ToolCallProposals = {
    briefProposal: null,
    briefProposalConcurrentEdit: null,
    profileAmendmentProposal: null,
    briefCancellationProposal: null,
  }
  if (!Array.isArray(toolCalls)) return empty

  let briefProposal: BriefProposalV1xA1Parsed | null = null
  let briefProposalConcurrentEdit: ConcurrentEditWarning | null = null
  let profileAmendmentProposal: ProfileAmendmentProposalParsed | null = null
  let briefCancellationProposal: BriefCancellationProposalArtefact | null = null

  for (const raw of toolCalls) {
    if (!raw || typeof raw !== 'object') continue
    const entry = raw as ToolCallEntry
    if (entry.proposal_artefact === undefined) continue

    if (entry.name === 'propose_brief') {
      const r = BriefProposalV1xA1Schema.safeParse(entry.proposal_artefact)
      if (r.success) briefProposal = r.data
      // V1.x-D.4 — extract concurrent-edit warning attached to artefact
      // by execProposeBrief (V1.x-B.3 contract). The strict zod schema
      // strips it; we read it directly from the raw artefact.
      const artefact = entry.proposal_artefact as
        | { concurrent_edit_warning?: ConcurrentEditWarning }
        | null
      if (
        artefact &&
        typeof artefact === 'object' &&
        artefact.concurrent_edit_warning &&
        typeof artefact.concurrent_edit_warning === 'object' &&
        Array.isArray(artefact.concurrent_edit_warning.node_ids) &&
        Array.isArray(artefact.concurrent_edit_warning.conflicting_brief_ids) &&
        typeof artefact.concurrent_edit_warning.message === 'string'
      ) {
        briefProposalConcurrentEdit = artefact.concurrent_edit_warning
      }
    } else if (entry.name === 'propose_profile_amendment') {
      const r = ProfileAmendmentProposalSchema.safeParse(entry.proposal_artefact)
      if (r.success) profileAmendmentProposal = r.data
    } else if (entry.name === 'cancel_brief') {
      // The artefact is server-validated at execCancelBrief time; the
      // shape is the BriefCancellationProposalArtefact contract.
      // No re-validation here — server is the source of truth.
      const a = entry.proposal_artefact as BriefCancellationProposalArtefact
      if (
        a &&
        typeof a === 'object' &&
        typeof a.brief_id === 'string' &&
        typeof a.reason === 'string' &&
        a.cascade_preview &&
        typeof a.cascade_preview === 'object'
      ) {
        briefCancellationProposal = a
      }
    }
  }

  return {
    briefProposal,
    briefProposalConcurrentEdit,
    profileAmendmentProposal,
    briefCancellationProposal,
  }
}
