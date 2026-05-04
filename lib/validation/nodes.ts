// Spec: stelavox_phase2_api_contract_v1_0.md §2.5 (validation rules),
//                                              §3.1 (POST body),
//                                              §3.4 (PATCH body),
//                                              §3.6 (PATCH /move body — separate file)
//       stelavox_phase2_build_checklist_v1_0.md v1.1 §3.3 T-3.1
//
// Zod schemas for the Phase 2 node API. `.strict()` on every object so
// any field not listed below produces `400 unknown_field` (the route
// surfaces the Zod issue path as the offending field name). Phase 1
// pattern from `lib/validation/documents.ts`.
//
// Forbidden fields per §2.5 (rejected by `.strict()`):
//   id, organisation_id, project_id, document_id, version, created_at,
//   updated_at, created_by, last_modified_by, depth, order, layer_index,
//   mobile_notes, attachment_count, plus tags (not yet in scope).
// Plus on PATCH: parent_id, node_type, node_category — all immutable
// after creation; parent_id moves through PATCH /move instead.
//
// Empty PATCH body (`{}`) parses successfully here — the route checks
// `Object.keys(parsed).length === 0` and returns `400 empty_update`.
// Same separation of concerns as Phase 1's documents PATCH route.

import { z } from 'zod'

const NODE_STATUS_V2   = ['draft', 'in_review', 'approved', 'locked'] as const
const NODE_CATEGORY_V2 = ['structural'] as const

// `.transform(trim).pipe(min(1).max(N))` matches Phase 1: empty-after-trim
// is rejected; the route maps the Zod issue path to the right error code
// (invalid_name / invalid_node_type / etc.).
const nameField = z
  .string()
  .transform(s => s.trim())
  .pipe(z.string().min(1).max(200))

const nodeTypeField = z
  .string()
  .transform(s => s.trim())
  .pipe(z.string().min(1).max(100))

const shortDescriptionField = z.string().max(1000).nullable().optional()
const agentInstructionField = z.string().max(5000).nullable().optional()
const wordCountTargetField  = z.number().int().nonnegative().nullable().optional()
const summaryField          = z.string().max(100_000).nullable().optional()
// Phase 3 G-2: 1M → 2M chars (~400k words). 2M is a guardrail against accidental
// megabyte payloads; per-beat content >5k words is suspect. Editor warns at 100k.
const proseField            = z.string().max(2_000_000).nullable().optional()
const notesField            = z.string().max(100_000).nullable().optional()
const metadataField         = z.record(z.string(), z.unknown()).optional()
const lockReasonField       = z.string().max(1000).nullable().optional()
// Phase 3: optional optimistic-concurrency token. Strict integer ≥ 1.
const expectedVersionField  = z.number().int().min(1).optional()

export const nodePostSchema = z.object({
  parent_id:         z.string().uuid(),
  node_type:         nodeTypeField,
  node_category:     z.enum(NODE_CATEGORY_V2).optional(),
  name:              nameField.optional(),
  short_description: shortDescriptionField,
  agent_instruction: agentInstructionField,
  word_count_target: wordCountTargetField,
  summary:           summaryField,
  prose:             proseField,
  notes:             notesField,
  metadata:          metadataField,
}).strict()

export const nodePatchSchema = z.object({
  name:              nameField.optional(),
  short_description: shortDescriptionField,
  status:            z.enum(NODE_STATUS_V2).optional(),
  agent_instruction: agentInstructionField,
  word_count_target: wordCountTargetField,
  summary:           summaryField,
  prose:             proseField,
  notes:             notesField,
  metadata:          metadataField,
  locked:            z.boolean().optional(),
  lock_reason:       lockReasonField,
  // Phase 3: optimistic-concurrency check; not a settable column. The route
  // strips it before the UPDATE.
  expected_version:  expectedVersionField,
}).strict()

// PATCH /api/nodes/[id]/move body — both fields required.
// `position` is 0-indexed per API Contract §3.6.
export const nodeMoveSchema = z.object({
  parent_id: z.string().uuid(),
  position:  z.number().int().nonnegative(),
}).strict()

export type NodePost  = z.infer<typeof nodePostSchema>
export type NodePatch = z.infer<typeof nodePatchSchema>
export type NodeMove  = z.infer<typeof nodeMoveSchema>
