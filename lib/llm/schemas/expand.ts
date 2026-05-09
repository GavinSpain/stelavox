/**
 * Zod schema for `expand` agent operation output.
 *
 * Source: stelavox_phase5_api_contract_v1_0.md v1.2 §5.2 +
 *         stelavox_agent_profile_library_v1_0.md §2.1–§2.4 (output format).
 *
 * The four V1 expand profiles (book → acts, act → chapters, chapter → scenes,
 * scene → beats) all emit the same JSON-array shape; the Edge Function
 * dispatches by operation_type but uses this single schema for validation.
 *
 * The Edge Function:
 *   1. Parses the LLM response as JSON.
 *   2. Runs ExpandOutputSchema.safeParse() on the parsed value.
 *   3. On failure: marks the agent_jobs row failed with
 *      error_message='output_schema_invalid' plus the failure path.
 *   4. On success: additionally validates that `position` values are unique
 *      and 0-indexed contiguous (no gaps, no duplicates) — see
 *      assertContiguousPositions() below.
 *   5. Writes the array to agent_jobs.result_child_nodes (JSONB).
 *
 * Per the agent profile library §5.2 the shape is:
 *   [
 *     {
 *       name?: string,
 *       short_description: string (1–500 chars),
 *       summary: string (1+ chars),
 *       metadata?: object,
 *       word_count_target?: integer (1–250000),
 *       position: integer (≥ 0)
 *     },
 *     ...
 *   ]
 * Min items: 1. Max items: 20.
 *
 * Note on cap: word_count_target is capped at 250,000 to accommodate the
 * full V1 expand profile range. The series-into-books prompt explicitly
 * targets 70,000–120,000 per book with allowance for high-fantasy at
 * 150,000+; capping at 100,000 caused real production rejections (cloud
 * failure 2026-05-08, doc 9503c6ea Mars series). 250,000 is comfortably
 * above the longest realistic single-book target (~200k for Brandon-
 * Sanderson-scale fantasy) without admitting absurd values.
 */

import { z } from 'zod'

const ExpandOutputItemSchema = z.object({
  name: z.string().optional(),
  short_description: z.string().min(1).max(500),
  summary: z.string().min(1),
  metadata: z.record(z.string(), z.unknown()).optional(),
  word_count_target: z.number().int().min(1).max(250_000).optional(),
  position: z.number().int().min(0),
})

export const ExpandOutputSchema = z.array(ExpandOutputItemSchema).min(1).max(20)

export type ExpandOutput = z.infer<typeof ExpandOutputSchema>
export type ExpandOutputItem = z.infer<typeof ExpandOutputItemSchema>

/**
 * Verify that an expand output's `position` values are contiguous from 0.
 * Called by the Edge Function after Zod validation passes.
 *
 * Returns null on success; an error message string on failure.
 */
export function assertContiguousPositions(items: ExpandOutput): string | null {
  const positions = items.map((item) => item.position).sort((a, b) => a - b)
  for (let i = 0; i < positions.length; i++) {
    if (positions[i] !== i) {
      return `position values must be 0-indexed contiguous; expected ${i} at sorted index ${i}, got ${positions[i]}`
    }
  }
  return null
}
