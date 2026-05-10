/**
 * Tool input-schema generator (round-3 audit B6.1 / F-81).
 *
 * Generates the JSON Schema for a Director tool's input parameters
 * directly from the Zod schema in `lib/director/schemas.ts`. Replaces
 * the hand-written JSON Schema bodies that previously lived in
 * `lib/director/tools/index.ts` — those duplicated the Zod definitions
 * and could drift silently. Single source of truth: ToolInputSchemas.
 *
 * Uses Zod v4's built-in `z.toJSONSchema()` (we initially tried the
 * `zod-to-json-schema` library but it was Zod-v3-only and silently
 * produced empty `{}` schemas at runtime against v4 inputs). The v4
 * built-in produces standard JSON Schema that Anthropic's tool API
 * accepts. We strip the draft-07 `$schema` URL and any `definitions`
 * wrapper for a flat object output.
 */

import 'server-only'

import { z } from 'zod'

import { ToolInputSchemas, type ToolName } from '@/lib/director/schemas'

/**
 * Generate the JSON-Schema body for a tool's input. Used by the
 * tool-registry initialiser; the result is what gets sent to Anthropic
 * as the tool's `input_schema`.
 */
export function toolInputSchemaFor(name: ToolName): Record<string, unknown> {
  const zodSchema = ToolInputSchemas[name]
  const generated = z.toJSONSchema(zodSchema, {
    target: 'draft-7',
    // Inline everything — no $ref / definitions wrapper. Our schemas
    // don't self-reference so this is the cleanest output.
    reused: 'inline',
  }) as Record<string, unknown>

  // Drop the `$schema` URL — Anthropic doesn't need it and it's noise
  // in the serialised tool definition. Same for `definitions` (won't be
  // present after `reused: inline` but defensive).
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { $schema, definitions, ...clean } = generated
  return clean
}
