/**
 * Synthesise operation — validate plain-text prose output.
 *
 * Source: stelavox_phase5_api_contract_v1_0.md v1.2 §2.11.
 *         stelavox_agent_profile_library_v1_0.md §2.5 (output format).
 * Build Checklist T-7.3.
 *
 * The synthesise_beat profile emits plain text (no JSON). The Edge
 * Function reads response.content directly and writes to result_prose.
 * The Accept route later converts via plainTextToTiptap() before writing
 * to nodes.prose (G-9).
 */

import { SynthesiseOutputSchema } from '@/lib/llm/schemas/synthesise'

export async function runSynthesise(content: string): Promise<{ result_prose: string }> {
  const result = SynthesiseOutputSchema.safeParse(content)
  if (!result.success) {
    throw new Error(`output_schema_invalid:${JSON.stringify(result.error.issues)}`)
  }
  return { result_prose: result.data }
}
