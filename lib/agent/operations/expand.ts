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

/**
 * Extract the first JSON array from the model output.
 *
 * Models frequently:
 *   - Wrap structured output in Markdown code fences (```json ... ```)
 *   - Add commentary before or after the JSON
 *
 * This function:
 *   1. Strips opening/closing Markdown code fences if present
 *   2. Finds the first '[' and matches to its closing ']' (counting
 *      brackets, respecting strings)
 *   3. Returns the JSON substring; throws if no valid array is found
 */
function extractJsonArray(content: string): string {
  let s = content.trim()
  // Strip opening fence
  s = s.replace(/^```(?:json|JSON)?\s*\n?/, '')
  // Strip closing fence
  s = s.replace(/\n?```\s*$/, '')
  s = s.trim()

  const start = s.indexOf('[')
  if (start === -1) throw new Error('no JSON array found in output')

  let depth = 0
  let inString = false
  let escape = false
  for (let i = start; i < s.length; i++) {
    const ch = s[i]
    if (escape) { escape = false; continue }
    if (ch === '\\' && inString) { escape = true; continue }
    if (ch === '"') { inString = !inString; continue }
    if (inString) continue
    if (ch === '[') depth++
    else if (ch === ']') {
      depth--
      if (depth === 0) return s.slice(start, i + 1)
    }
  }
  throw new Error('unterminated JSON array')
}

export async function runExpand(content: string): Promise<{ result_child_nodes: unknown[] }> {
  let parsed: unknown
  try {
    parsed = JSON.parse(extractJsonArray(content))
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
