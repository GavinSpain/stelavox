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

export async function runGenerateContext(
  content: string,
): Promise<{ result_summary: string; result_metadata: Record<string, unknown> }> {
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch (err) {
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
