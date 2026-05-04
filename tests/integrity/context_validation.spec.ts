// Spec: stelavox_phase4_api_contract_v1_0.md §2.5, §3.1, §5 G-4
//       stelavox_phase4_build_checklist_v1_0.md §3.1 T-1.1, T-1.4, T-1.5, T-1.7
//
// Pure Zod-schema unit tests for the new Phase 4 validation surfaces.
// No browser, no DB, no server. Playwright is just the harness.

import { test, expect } from '@playwright/test'
import { nodeContextPostSchema } from '../../lib/validation/nodes'
import { contextLinkPostSchema } from '../../lib/validation/context-links'
import { CONTEXT_NODE_TYPES_V1, isContextNodeType } from '../../lib/context/types'
import { getMetadataSchema } from '../../lib/context/metadata-schemas'
import { getContextLabel } from '../../lib/context/labels'

const VALID_UUID  = '00000000-0000-4000-8000-000000000001'
const VALID_UUID2 = '00000000-0000-4000-8000-000000000002'

// ─── CONTEXT_NODE_TYPES_V1 ───────────────────────────────────────────────

test('whitelist: contains exactly the six core types', () => {
  expect([...CONTEXT_NODE_TYPES_V1].sort()).toEqual([
    'character', 'location', 'organisation', 'plot_thread', 'theme', 'world',
  ])
})

test('whitelist: isContextNodeType narrows known strings', () => {
  expect(isContextNodeType('character')).toBe(true)
  expect(isContextNodeType('evidence')).toBe(false)   // 30+ extended type, not V1
  expect(isContextNodeType(123)).toBe(false)
  expect(isContextNodeType(null)).toBe(false)
})

// ─── getContextLabel ─────────────────────────────────────────────────────

test('labels: singular and plural for each type', () => {
  expect(getContextLabel('character'))         .toBe('Character')
  expect(getContextLabel('character', true))   .toBe('Characters')
  expect(getContextLabel('plot_thread'))       .toBe('Plot Thread')
  expect(getContextLabel('plot_thread', true)) .toBe('Plot Threads')
  expect(getContextLabel('organisation'))      .toBe('Organisation')   // British -s
})

// ─── metadata schemas ────────────────────────────────────────────────────

test('metadata: every type has at least one field', () => {
  for (const t of CONTEXT_NODE_TYPES_V1) {
    const schema = getMetadataSchema(t)
    expect(schema.fields.length).toBeGreaterThan(0)
  }
})

test('metadata: every field key is unique within its type', () => {
  for (const t of CONTEXT_NODE_TYPES_V1) {
    const schema = getMetadataSchema(t)
    const keys = schema.fields.map(f => f.key)
    const unique = new Set(keys)
    expect(unique.size).toBe(keys.length)
  }
})

test('metadata: select fields carry options', () => {
  for (const t of CONTEXT_NODE_TYPES_V1) {
    const schema = getMetadataSchema(t)
    for (const field of schema.fields) {
      if (field.type === 'select') {
        expect(Array.isArray(field.options)).toBe(true)
        expect(field.options!.length).toBeGreaterThan(0)
      }
    }
  }
})

test('metadata: character schema includes role with the four expected options', () => {
  const schema = getMetadataSchema('character')
  const role = schema.fields.find(f => f.key === 'role')
  expect(role).toBeDefined()
  expect(role?.type).toBe('select')
  expect(role?.options).toEqual(['protagonist', 'antagonist', 'supporting', 'minor'])
})

// ─── nodeContextPostSchema — happy paths ─────────────────────────────────

test('POST context: minimal project-scoped body parses', () => {
  const r = nodeContextPostSchema.safeParse({
    scope:     'project',
    node_type: 'character',
    name:      'Elena Vasquez',
  })
  expect(r.success).toBe(true)
})

test('POST context: minimal document-scoped body parses', () => {
  const r = nodeContextPostSchema.safeParse({
    scope:       'document',
    document_id: VALID_UUID,
    node_type:   'location',
    name:        'The North Tower',
  })
  expect(r.success).toBe(true)
})

test('POST context: full body parses', () => {
  const r = nodeContextPostSchema.safeParse({
    scope:             'project',
    node_type:         'character',
    name:              'Elena Vasquez',
    short_description: 'Protagonist; lawyer in her early 40s',
    summary:           '{"type":"doc","content":[]}',
    notes:             '{"type":"doc","content":[]}',
    metadata:          { role: 'protagonist', age: 42, want: '...', fear: '...' },
    tags:              ['pov-character', 'arc-1'],
  })
  expect(r.success).toBe(true)
})

// ─── nodeContextPostSchema — failure paths ───────────────────────────────

test('POST context: missing name → fail', () => {
  const r = nodeContextPostSchema.safeParse({
    scope: 'project', node_type: 'character',
  })
  expect(r.success).toBe(false)
})

test('POST context: empty-after-trim name → fail', () => {
  const r = nodeContextPostSchema.safeParse({
    scope: 'project', node_type: 'character', name: '   ',
  })
  expect(r.success).toBe(false)
})

test('POST context: missing scope → fail', () => {
  const r = nodeContextPostSchema.safeParse({
    node_type: 'character', name: 'Elena',
  })
  expect(r.success).toBe(false)
})

test('POST context: invalid scope → fail', () => {
  const r = nodeContextPostSchema.safeParse({
    scope: 'workspace', node_type: 'character', name: 'Elena',
  })
  expect(r.success).toBe(false)
})

test('POST context: missing node_type → fail', () => {
  const r = nodeContextPostSchema.safeParse({
    scope: 'project', name: 'Elena',
  })
  expect(r.success).toBe(false)
})

test('POST context: unknown node_type (extended type) → fail', () => {
  const r = nodeContextPostSchema.safeParse({
    scope: 'project', node_type: 'evidence', name: 'Exhibit A',
  })
  expect(r.success).toBe(false)
})

test('POST context: parent_id forbidden → fail', () => {
  const r = nodeContextPostSchema.safeParse({
    scope: 'project', node_type: 'character', name: 'Elena',
    parent_id: VALID_UUID,
  })
  expect(r.success).toBe(false)
})

test('POST context: prose forbidden → fail', () => {
  const r = nodeContextPostSchema.safeParse({
    scope: 'project', node_type: 'character', name: 'Elena',
    prose: 'A leaf-only field — context nodes have no ProseEditor.',
  })
  expect(r.success).toBe(false)
})

test('POST context: agent_instruction forbidden → fail', () => {
  const r = nodeContextPostSchema.safeParse({
    scope: 'project', node_type: 'character', name: 'Elena',
    agent_instruction: 'Structural-only field.',
  })
  expect(r.success).toBe(false)
})

test('POST context: word_count_target forbidden → fail', () => {
  const r = nodeContextPostSchema.safeParse({
    scope: 'project', node_type: 'character', name: 'Elena',
    word_count_target: 1000,
  })
  expect(r.success).toBe(false)
})

test('POST context: tags array over the 20 cap → fail', () => {
  const r = nodeContextPostSchema.safeParse({
    scope: 'project', node_type: 'character', name: 'Elena',
    tags: Array.from({ length: 21 }, (_, i) => `tag-${i}`),
  })
  expect(r.success).toBe(false)
})

test('POST context: tags accepts up to 20 entries', () => {
  const r = nodeContextPostSchema.safeParse({
    scope: 'project', node_type: 'character', name: 'Elena',
    tags: Array.from({ length: 20 }, (_, i) => `tag-${i}`),
  })
  expect(r.success).toBe(true)
})

test('POST context: empty-after-trim tag → fail', () => {
  const r = nodeContextPostSchema.safeParse({
    scope: 'project', node_type: 'character', name: 'Elena',
    tags: ['valid', '   '],
  })
  expect(r.success).toBe(false)
})

test('POST context: document_id not a UUID → fail', () => {
  const r = nodeContextPostSchema.safeParse({
    scope: 'document', document_id: 'not-a-uuid',
    node_type: 'character', name: 'Elena',
  })
  expect(r.success).toBe(false)
})

// Note: scope/document_id consistency (scope=project + document_id present,
// or scope=document + no document_id) is enforced at the route layer
// (§3.1 step 10), not at the schema layer — the Zod schema admits all
// four combinations and the route returns 400 scope_document_mismatch
// for the two invalid ones. The route-level test cases are TC-A-03 and
// TC-A-04 in the integration suite.

// ─── contextLinkPostSchema ───────────────────────────────────────────────

test('POST link: minimal body parses', () => {
  const r = contextLinkPostSchema.safeParse({ context_node_id: VALID_UUID })
  expect(r.success).toBe(true)
})

test('POST link: missing context_node_id → fail', () => {
  const r = contextLinkPostSchema.safeParse({})
  expect(r.success).toBe(false)
})

test('POST link: malformed UUID → fail', () => {
  const r = contextLinkPostSchema.safeParse({ context_node_id: 'not-a-uuid' })
  expect(r.success).toBe(false)
})

test('POST link: extra field → fail', () => {
  const r = contextLinkPostSchema.safeParse({
    context_node_id: VALID_UUID,
    link_type: 'structural_to_context',
  })
  expect(r.success).toBe(false)
})

test('POST link: source_node_id in body forbidden → fail', () => {
  // The source is in the URL path; including it in the body is a hint
  // the client is confused about the contract.
  const r = contextLinkPostSchema.safeParse({
    context_node_id: VALID_UUID,
    source_node_id:  VALID_UUID2,
  })
  expect(r.success).toBe(false)
})
