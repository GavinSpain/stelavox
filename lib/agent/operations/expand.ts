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
 *   - Wrap the array in an outer JSON object with a property like
 *     `{ "books": [...] }` or `{ "result": [...] }`, despite the prompt
 *     asking for an array (the cloud-observed failure 2026-05-08 doc
 *     9503c6ea Mars-series expand was this shape)
 *
 * This function:
 *   1. Strips opening/closing Markdown code fences if present
 *   2. If a top-level '[' is found, matches it to its closing ']' (counting
 *      brackets, respecting strings) and returns the array substring
 *   3. Otherwise (fallback): finds the first '{', extracts the balanced
 *      object, parses it, and returns the first array-valued property's
 *      JSON. This recovers from the object-wrapped-array model failure
 *      mode without admitting arbitrary content.
 *   4. Throws if neither path yields a JSON array.
 */
function extractJsonArray(content: string): string {
  let s = content.trim()
  // Strip opening fence
  s = s.replace(/^```(?:json|JSON)?\s*\n?/, '')
  // Strip closing fence
  s = s.replace(/\n?```\s*$/, '')
  s = s.trim()

  // Primary: find a balanced top-level array.
  const arrStart = s.indexOf('[')
  const objStart = s.indexOf('{')
  // Prefer array if it appears at or before any object (top-level array case).
  if (arrStart !== -1 && (objStart === -1 || arrStart <= objStart)) {
    const arr = sliceBalanced(s, arrStart, '[', ']')
    if (arr !== null) return arr
    throw new Error(truncatedMessage('array', s.length - arrStart))
  }

  // Fallback: extract a top-level object and look for an array property.
  if (objStart !== -1) {
    const obj = sliceBalanced(s, objStart, '{', '}')
    if (obj === null) throw new Error(truncatedMessage('object', s.length - objStart))
    let parsedObj: unknown
    try { parsedObj = JSON.parse(obj) } catch { throw new Error('no JSON array found in output (object parse failed)') }
    if (parsedObj && typeof parsedObj === 'object' && !Array.isArray(parsedObj)) {
      for (const value of Object.values(parsedObj as Record<string, unknown>)) {
        if (Array.isArray(value)) return JSON.stringify(value)
      }
    }
    throw new Error('no JSON array found in output (object had no array property)')
  }

  throw new Error('no JSON array found in output')
}

/**
 * SU-J12-1 (Mars-drive 2026-05-09): authors hit "unterminated JSON array"
 * when the LLM hit its output-token cap mid-array and the trailing `]`
 * never arrived. The original message described WHAT (parse failed) but
 * not WHY (model truncated) or WHAT TO DO (reduce count or raise cap).
 * This message names the cause and the two remediation paths.
 */
function truncatedMessage(kind: 'array' | 'object', spanLength: number): string {
  return (
    `model_output_truncated:${kind}:span=${spanLength}chars — ` +
    `the model started a JSON ${kind} but did not finish it before its output ` +
    `token limit. Lower the requested item count or raise the model's max_tokens.`
  )
}

function sliceBalanced(s: string, start: number, open: string, close: string): string | null {
  let depth = 0
  let inString = false
  let escape = false
  for (let i = start; i < s.length; i++) {
    const ch = s[i]
    if (escape) { escape = false; continue }
    if (ch === '\\' && inString) { escape = true; continue }
    if (ch === '"') { inString = !inString; continue }
    if (inString) continue
    if (ch === open) depth++
    else if (ch === close) {
      depth--
      if (depth === 0) return s.slice(start, i + 1)
    }
  }
  return null
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

  // SU-J12-7 (Mars-drive 2026-05-09): models commonly return names with
  // ordinal prefixes ("1. Red Genesis", "2) Inheritance", "Chapter 3: …").
  // The display layer adds its own "${i+1}. " prefix in the proposal
  // preview, producing "1. 1. Red Genesis"; once Accepted, the persisted
  // node names also carry the redundant prefix into the tree. Strip
  // canonical leading-ordinal patterns at the operation boundary so both
  // the preview and the persisted tree see clean names.
  const cleaned = result.data.map((item) => ({
    ...item,
    name: item.name ? stripLeadingOrdinal(item.name) : item.name,
  }))

  return { result_child_nodes: cleaned }
}

function stripLeadingOrdinal(name: string): string {
  // Match "1. ", "2) ", "3 - ", "4: ", optionally with leading whitespace.
  // Non-greedy so we don't strip from names that genuinely start with a
  // number (e.g., "1984" — no separator follows the digits).
  const stripped = name.replace(/^\s*\d+\s*[.)\-:]\s+/, '').trim()
  return stripped || name
}
