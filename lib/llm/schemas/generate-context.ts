/**
 * Zod schema for `generate_context` agent operation output.
 *
 * Source: stelavox_phase5_api_contract_v1_0.md v1.2 §5.3 +
 *         stelavox_agent_profile_library_v1_0.md §2.12–§2.17 (one profile
 *         per V1 core context type — character / location / organisation /
 *         world / theme / plot_thread).
 *
 * All six V1 generate_context profiles emit the same top-level shape — an
 * object with `summary` (string) + `metadata` (object). The metadata's
 * field set varies by node_type (character has wound/lie/want/need/ghost;
 * location has atmosphere/sensory_notes; etc. — see library doc §2.12–§2.17),
 * but server-side schema validation is per Phase 4 G-2 deferred to V2;
 * V1 admits any object shape at the top schema level. Per-type schema
 * rendering happens client-side via lib/context/metadata-schemas.ts (G-10).
 *
 * The Edge Function:
 *   1. Parses the LLM response as JSON.
 *   2. Runs GenerateContextOutputSchema.safeParse() on the parsed value.
 *   3. On failure: marks the agent_jobs row failed with
 *      error_message='output_schema_invalid'.
 *   4. On success: splits the object — `summary` to agent_jobs.result_summary
 *      (TEXT), `metadata` to agent_jobs.result_metadata (JSONB).
 *
 * The Accept route calls plainTextToTiptap() on result_summary before writing
 * to nodes.summary (G-9). result_metadata is merged into nodes.metadata
 * (preserving existing keys not in the proposed object) directly without
 * conversion.
 */

import { z } from 'zod'

export const GenerateContextOutputSchema = z.object({
  summary: z.string().min(1),
  metadata: z.record(z.string(), z.unknown()),
})

export type GenerateContextOutput = z.infer<typeof GenerateContextOutputSchema>
