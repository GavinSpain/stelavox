/**
 * Generate-context operation — parse JSON object with summary + metadata.
 *
 * Source: stelavox_phase5_api_contract_v1_0.md v1.2 §2.11.
 *         stelavox_agent_profile_library_v1_0.md §2.12–§2.17 (output format).
 * Build Checklist T-7.3.
 *
 * The six V1 generate_context profiles emit a single JSON object
 * { summary, metadata }. The Edge Function splits this into two
 * agent_jobs columns: result_summary (TEXT) and result_metadata (JSONB).
 *
 * The Accept route converts result_summary via plainTextToTiptap() before
 * writing to nodes.summary; result_metadata is merged into nodes.metadata
 * (preserving existing keys).
 */

import { GenerateContextOutputSchema } from '@/lib/llm/schemas/generate-context'

/**
 * Extract the first JSON object from the model output.
 * Strips Markdown code fences and ignores any leading/trailing commentary.
 */
function extractJsonObject(content: string): string {
  let s = content.trim()
  s = s.replace(/^```(?:json|JSON)?\s*\n?/, '')
  s = s.replace(/\n?```\s*$/, '')
  s = s.trim()

  const start = s.indexOf('{')
  if (start === -1) throw new Error('no JSON object found in output')

  let depth = 0
  let inString = false
  let escape = false
  for (let i = start; i < s.length; i++) {
    const ch = s[i]
    if (escape) { escape = false; continue }
    if (ch === '\\' && inString) { escape = true; continue }
    if (ch === '"') { inString = !inString; continue }
    if (inString) continue
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return s.slice(start, i + 1)
    }
  }
  throw new Error('unterminated JSON object')
}

export async function runGenerateContext(
  content: string,
): Promise<{ result_summary: string; result_metadata: Record<string, unknown> }> {
  let parsed: unknown
  try {
    parsed = JSON.parse(extractJsonObject(content))
  } catch (err) {
    // Log raw model output for prompt iteration (T-15 debug aid).
    console.error('[generate-context] raw output that failed to parse (first 500 chars):')
    console.error(content.slice(0, 500))
    throw new Error(`output_schema_invalid:json_parse:${(err as Error).message}`)
  }

  const result = GenerateContextOutputSchema.safeParse(parsed)
  if (!result.success) {
    throw new Error(`output_schema_invalid:${JSON.stringify(result.error.issues)}`)
  }

  return {
    result_summary: result.data.summary,
    result_metadata: result.data.metadata,
  }
}
