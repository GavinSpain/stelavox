// B6.1 — round-3 audit F-81.
//
// The Director tool registry's `input_schema` fields used to be
// hand-written JSON Schema bodies that duplicated the Zod schemas in
// lib/director/schemas.ts. Drift risk: a fix in one wouldn't propagate.
// Post-fix: input_schema is generated from the Zod schema via
// `toolInputSchemaFor(name)` — single source of truth.
//
// This test pins the generated shape against expected key sets, so a
// future Zod-schema change that accidentally drops a field surfaces
// here. It's not a byte-perfect snapshot — zod-to-json-schema's output
// can vary between library versions — but the structural assertions
// catch the drift cases that matter (field presence, required fields,
// type-and-format on UUIDs, enum values).

import { describe, expect, it } from 'vitest'
import { toolInputSchemaFor } from '@/lib/director/tool-schema'

describe('B6.1 — F-81: tool input schemas are generated from Zod', () => {
  it('get_document_state has empty properties (no inputs)', () => {
    const schema = toolInputSchemaFor('get_document_state')
    expect(schema.type).toBe('object')
    expect(schema.properties).toEqual({})
    expect(schema.additionalProperties).toBe(false)
  })

  it('get_node requires node_id (uuid format)', () => {
    const schema = toolInputSchemaFor('get_node')
    const props = schema.properties as Record<string, { type?: string; format?: string }>
    expect(props.node_id?.type).toBe('string')
    expect(props.node_id?.format).toBe('uuid')
    expect(schema.required).toEqual(['node_id'])
    expect(schema.additionalProperties).toBe(false)
  })

  // 2026-05-19 Phase 3 of create_*_step deprecation: the per-step
  // input-schemas were removed from ToolInputSchemas. Per-op-type
  // parameter validation now lives in propose_brief's StepSchema
  // (lib/brief/proposalBuilder.ts), exercised by the m181-phase1
  // tests directly against execProposeBrief.
  it.skip('SUPERSEDED — create_refine_step input schema (Phase 3 removed; replaced by StepSchema in proposalBuilder)', () => {})
  it.skip('SUPERSEDED — create_context_step input schema (Phase 3 removed)', () => {})
  it.skip('SUPERSEDED — create_node_reorder_step input schema (Phase 3 removed)', () => {})

  it('current ToolInputSchemas entries all generate without error', () => {
    const names = [
      'get_project_profile', 'get_brief_state', 'get_document_state',
      'get_node', 'get_nodes_by_layer', 'find_node_by_name',
      'get_node_tree', 'get_subtree_content', 'find_context_references',
      'get_subtree_stats',
      'assess_downstream_impact', 'get_conversation_history', 'get_workflow_history',
      'propose_brief', 'propose_profile_amendment', 'cancel_brief',
      // 2026-05-21 simplification: propose_brief_amendment → propose_workflow.
      'propose_workflow', 'report_capability_limit',
    ] as const
    for (const name of names) {
      const schema = toolInputSchemaFor(name)
      expect(schema.type, `${name} should be type=object`).toBe('object')
      // propose_workflow's schema is the workflow shape directly
      // (mirrors _ProposalWorkflowSchema), which doesn't carry the
      // strict additionalProperties marker the other write tools
      // have. The other 16 do.
      if (name !== 'propose_workflow') {
        expect(schema.additionalProperties, `${name} should disallow extras`).toBe(false)
      }
    }
  })
})
