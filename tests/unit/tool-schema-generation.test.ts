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

  it('create_refine_step pins the V1 target_field enum', () => {
    const schema = toolInputSchemaFor('create_refine_step')
    const props = schema.properties as Record<string, { enum?: string[] }>
    expect(props.target_field?.enum).toEqual(['summary', 'prose', 'notes', 'metadata'])
    expect(schema.required).toEqual(
      expect.arrayContaining([
        'target_node_id',
        'target_field',
        'instruction',
        'description',
        'estimated_duration_seconds',
      ]),
    )
  })

  it('create_context_step pins the V1 context_type whitelist', () => {
    const schema = toolInputSchemaFor('create_context_step')
    const props = schema.properties as Record<string, { enum?: string[] }>
    expect(props.context_type?.enum).toEqual([
      'character',
      'location',
      'organisation',
      'theme',
      'plot_thread',
      'world',
    ])
  })

  it('create_node_reorder_step has new_order with positive integer constraint', () => {
    const schema = toolInputSchemaFor('create_node_reorder_step')
    const props = schema.properties as Record<string, { type?: string; minimum?: number; exclusiveMinimum?: number }>
    expect(props.new_order?.type).toBe('integer')
    // Zod's `.positive()` emits exclusiveMinimum=0 in JSON Schema (i.e. > 0).
    // Equivalent to minimum=1 for integers but expressed differently.
    expect(props.new_order?.exclusiveMinimum ?? props.new_order?.minimum).toBeDefined()
  })

  it('all 13 V1 tools generate without error', () => {
    const names = [
      'get_document_state', 'get_node', 'get_nodes_by_layer', 'get_node_tree',
      'assess_downstream_impact', 'get_conversation_history', 'get_workflow_history',
      'create_expand_step', 'create_synthesise_step', 'create_refine_step',
      'create_context_step', 'create_comment_step', 'create_node_reorder_step',
    ] as const
    for (const name of names) {
      const schema = toolInputSchemaFor(name)
      expect(schema.type, `${name} should be type=object`).toBe('object')
      expect(schema.additionalProperties, `${name} should disallow extras`).toBe(false)
    }
  })
})
