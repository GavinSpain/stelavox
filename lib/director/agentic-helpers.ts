/**
 * V1.x-B.2.1 — pure helpers extracted from the per-turn executor so the
 * per-iteration runner (`lib/director/iteration-runner.ts`) and the legacy
 * `runAgenticTurn` (`lib/director/executor.ts`) can share them.
 *
 * No I/O. No DB calls. No provider calls. Just text-stream parsing and
 * proposal-suppression state machines.
 *
 * Source: stelavox_v1x_b_2_build_checklist_v1_0.md §3.2.3
 *         (per-iteration decomposition + helpers retained).
 */

import { WorkflowProposalSchema, type WorkflowProposalParsed } from '@/lib/director/schemas'

// ---------------------------------------------------------------------------
// Proposal-block text suppression
// ---------------------------------------------------------------------------
// V1.x-A.1 (v1.6 prompt) — keep proposal artefact tags out of user-visible
// text_delta events:
//   - <plan>           — Director chain-of-thought scratchpad
//   - <workflow_proposal> — workflow XML still emitted (different arch)
//   - <brief_proposal> / <profile_amendment_proposal> — defensive against
//     model regressions (v1.6 instructs the model that the tool call IS the
//     proposal; suppression catches stragglers)
// ---------------------------------------------------------------------------

export interface WorkflowSuppressionState {
  suppressing: boolean
  tail: string
}

const PROPOSAL_OPEN_TAGS = [
  '<plan>',
  '<workflow_proposal>',
  '<brief_proposal>',
  '<profile_amendment_proposal>',
] as const

const PROPOSAL_TAIL_HOLD = Math.max(...PROPOSAL_OPEN_TAGS.map((t) => t.length)) - 1

export function freshSuppressionState(): WorkflowSuppressionState {
  return { suppressing: false, tail: '' }
}

/**
 * Process one text chunk against the suppression state. Returns the visible
 * portion (to yield as `text_delta`) and the new state.
 *
 *  - If already suppressing, the chunk is dropped from output.
 *  - If any proposal open tag appears in (tail + chunk), yield the prefix
 *    up to the earliest tag and transition to suppressing.
 *  - Otherwise, yield (tail + chunk) minus the trailing PROPOSAL_TAIL_HOLD
 *    chars; hold those as the new tail so a tag split across chunk
 *    boundaries is still detected.
 */
export function consumeTextForDelta(
  chunk: string,
  state: WorkflowSuppressionState,
): { visible: string; state: WorkflowSuppressionState } {
  if (state.suppressing) {
    return { visible: '', state }
  }
  const combined = state.tail + chunk
  let earliest = -1
  for (const tag of PROPOSAL_OPEN_TAGS) {
    const idx = combined.indexOf(tag)
    if (idx !== -1 && (earliest === -1 || idx < earliest)) earliest = idx
  }
  if (earliest !== -1) {
    return {
      visible: combined.slice(0, earliest),
      state: { suppressing: true, tail: '' },
    }
  }
  const safeLen = Math.max(0, combined.length - PROPOSAL_TAIL_HOLD)
  return {
    visible: combined.slice(0, safeLen),
    state: { suppressing: false, tail: combined.slice(safeLen) },
  }
}

// ---------------------------------------------------------------------------
// <workflow_proposal> JSON block parser
// ---------------------------------------------------------------------------

/**
 * Locate and parse the <workflow_proposal>...</workflow_proposal> JSON
 * block from the Director's accumulated text. Returns null if absent.
 * Returns null and logs if present-but-malformed.
 */
export function parseWorkflowProposal(text: string): WorkflowProposalParsed | null {
  const match = text.match(
    /<workflow_proposal>\s*(?:```json)?\s*([\s\S]*?)\s*(?:```)?\s*<\/workflow_proposal>/,
  )
  if (!match) {
    // Tolerant fallback: leading <workflow_proposal> followed by raw JSON
    // until end-of-string. Useful when the model truncates.
    const lazy = text.match(/<workflow_proposal>\s*([\s\S]*)$/)
    if (!lazy) return null
    try {
      const obj = JSON.parse(lazy[1].trim()) as unknown
      const result = WorkflowProposalSchema.safeParse(obj)
      return result.success ? result.data : null
    } catch {
      return null
    }
  }
  try {
    const obj = JSON.parse(match[1].trim()) as unknown
    const result = WorkflowProposalSchema.safeParse(obj)
    if (!result.success) {
      console.warn('[director] workflow proposal failed schema validation', {
        error: result.error.message,
      })
      return null
    }
    return result.data
  } catch (err) {
    console.warn('[director] workflow proposal JSON parse failed', {
      error: err instanceof Error ? err.message : String(err),
    })
    return null
  }
}
