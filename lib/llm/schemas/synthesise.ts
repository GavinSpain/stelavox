/**
 * Zod schema for `synthesise` agent operation output.
 *
 * Source: stelavox_phase5_api_contract_v1_0.md v1.2 §5.3 +
 *         stelavox_agent_profile_library_v1_0.md §2.5 (output format).
 *
 * The synthesise_beat profile emits plain text (paragraphs separated by blank
 * lines). The Edge Function:
 *   1. Reads the LLM response content as a string (no JSON parsing).
 *   2. Runs SynthesiseOutputSchema.safeParse() on the string.
 *   3. On failure: marks the agent_jobs row failed with
 *      error_message='output_schema_invalid'.
 *   4. On success: writes the string to agent_jobs.result_prose (TEXT).
 *
 * The Accept route (§3.7) calls plainTextToTiptap() from
 * lib/agent/prose-to-tiptap.ts to convert this plain text to Tiptap document
 * JSON before writing to nodes.prose (G-9).
 *
 * Min length: 1 (no empty prose). Max length: 50_000 characters (≈10000-word
 * cap — far above any single beat's expected word count, but a defensive
 * upper bound against runaway generations).
 */

import { z } from 'zod'

export const SynthesiseOutputSchema = z.string().min(1).max(50_000)

export type SynthesiseOutput = z.infer<typeof SynthesiseOutputSchema>
