/**
 * Zod schema for `refine` agent operation output.
 *
 * Source: stelavox_phase5_api_contract_v1_0.md v1.2 §5.3 +
 *         stelavox_agent_profile_library_v1_0.md §2.6–§2.11, §2.18.
 *
 * Refine emits plain text — irrespective of the target_field
 * (summary | prose | notes). The Edge Function:
 *   1. Reads the LLM response content as a string (no JSON parsing).
 *   2. Runs RefineOutputSchema.safeParse() on the string.
 *   3. On failure: marks the agent_jobs row failed with
 *      error_message='output_schema_invalid'.
 *   4. On success: writes the string to the appropriate result_* column
 *      based on the request's target_field:
 *        target_field='summary' → agent_jobs.result_summary
 *        target_field='prose'   → agent_jobs.result_prose
 *        target_field='notes'   → agent_jobs.result_notes
 *
 * The Accept route (§3.7) calls plainTextToTiptap() to convert plain text
 * to Tiptap JSON before writing to nodes.summary / nodes.prose / nodes.notes
 * (G-9).
 *
 * Min length: 1 (no empty refines). Max length: 50_000 characters
 * (matching SynthesiseOutputSchema).
 */

import { z } from 'zod'

export const RefineOutputSchema = z.string().min(1).max(50_000)

export type RefineOutput = z.infer<typeof RefineOutputSchema>
