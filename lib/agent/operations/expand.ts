/**
 * Expand operation — parse JSON array of proposed child nodes.
 *
 * Source: stelavox_phase5_api_contract_v1_0.md v1.2 §2.11.
 *         stelavox_agent_profile_library_v1_0.md §2.1–§2.4 (output format).
 * Build Checklist T-7.3.
 *
 * Validates the LLM response against ExpandOutputSchema and the
 * contiguous-position invariant. Returns the result_* columns to write
 * to agent_jobs (just result_child_nodes for expand).
 */

import { ExpandOutputSchema, assertContiguousPositions } from '@/lib/llm/schemas/expand'

export async function runExpand(content: string): Promise<{ result_child_nodes: unknown[] }> {
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch (err) {
    throw new Error(`output_schema_invalid:json_parse:${(err as Error).message}`)
  }

  const result = ExpandOutputSchema.safeParse(parsed)
  if (!result.success) {
    throw new Error(`output_schema_invalid:${JSON.stringify(result.error.issues)}`)
  }

  const positionsErr = assertContiguousPositions(result.data)
  if (positionsErr) {
    throw new Error(`output_schema_invalid:positions:${positionsErr}`)
  }

  return { result_child_nodes: result.data }
}
