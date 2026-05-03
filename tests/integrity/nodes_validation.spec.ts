// Pure Zod-schema unit tests for `lib/validation/nodes.ts`.
// No browser, no DB, no server — Playwright is just used as the test
// harness because the project has no dedicated unit-test runner.
//
// Acceptance for T-3.1: schemas reject every forbidden field listed in
// API Contract §2.5 and accept every documented valid body.

import { test, expect } from '@playwright/test'
import { nodePostSchema, nodePatchSchema } from '../../lib/validation/nodes'

const VALID_UUID = '00000000-0000-4000-8000-000000000001'

const FORBIDDEN_BOTH = [
  'id', 'organisation_id', 'project_id', 'document_id',
  'version', 'created_at', 'updated_at',
  'created_by', 'last_modified_by',
  'depth', 'order', 'layer_index',
  'mobile_notes', 'attachment_count',
  'tags',  // not in scope for Phase 2
] as const

const PATCH_ONLY_FORBIDDEN = ['parent_id', 'node_type', 'node_category'] as const

// ─── POST ─────────────────────────────────────────────────────────────

test('POST: minimal valid body parses', () => {
  const r = nodePostSchema.safeParse({
    parent_id: VALID_UUID,
    node_type: 'chapter',
  })
  expect(r.success).toBe(true)
})

test('POST: full valid body parses', () => {
  const r = nodePostSchema.safeParse({
    parent_id:         VALID_UUID,
    node_type:         'chapter',
    node_category:     'structural',
    name:              'Chapter 3',
    short_description: 'The first encounter',
    agent_instruction: 'Make the protagonist hesitant.',
    word_count_target: 3500,
    summary:           'A long-form summary.',
    prose:             'Once upon a time…',
    notes:             'Author notes.',
    metadata:          { mood: 'tense' },
  })
  expect(r.success).toBe(true)
})

test('POST: missing parent_id → fail', () => {
  const r = nodePostSchema.safeParse({ node_type: 'chapter' })
  expect(r.success).toBe(false)
})

test('POST: missing node_type → fail', () => {
  const r = nodePostSchema.safeParse({ parent_id: VALID_UUID })
  expect(r.success).toBe(false)
})

test('POST: parent_id not a UUID → fail', () => {
  const r = nodePostSchema.safeParse({ parent_id: 'not-a-uuid', node_type: 'chapter' })
  expect(r.success).toBe(false)
})

test('POST: empty node_type after trim → fail', () => {
  const r = nodePostSchema.safeParse({ parent_id: VALID_UUID, node_type: '   ' })
  expect(r.success).toBe(false)
})

test('POST: empty name after trim → fail', () => {
  const r = nodePostSchema.safeParse({ parent_id: VALID_UUID, node_type: 'chapter', name: '   ' })
  expect(r.success).toBe(false)
})

test('POST: node_category="context" → fail', () => {
  const r = nodePostSchema.safeParse({
    parent_id: VALID_UUID, node_type: 'chapter', node_category: 'context',
  })
  expect(r.success).toBe(false)
})

test('POST: word_count_target negative → fail', () => {
  const r = nodePostSchema.safeParse({
    parent_id: VALID_UUID, node_type: 'chapter', word_count_target: -1,
  })
  expect(r.success).toBe(false)
})

test('POST: word_count_target non-integer → fail', () => {
  const r = nodePostSchema.safeParse({
    parent_id: VALID_UUID, node_type: 'chapter', word_count_target: 1.5,
  })
  expect(r.success).toBe(false)
})

test('POST: each forbidden field individually → fail with unknown_keys issue', () => {
  for (const field of FORBIDDEN_BOTH) {
    const body: Record<string, unknown> = {
      parent_id: VALID_UUID,
      node_type: 'chapter',
      [field]: 'anything',
    }
    const r = nodePostSchema.safeParse(body)
    expect(r.success, `forbidden field '${field}' must be rejected`).toBe(false)
    if (!r.success) {
      const hasUnknownKeys = r.error.issues.some(i => i.code === 'unrecognized_keys')
      expect(hasUnknownKeys, `forbidden '${field}' must trip unrecognized_keys`).toBe(true)
    }
  }
})

// ─── PATCH ────────────────────────────────────────────────────────────

test('PATCH: empty body parses (route checks empty_update separately)', () => {
  const r = nodePatchSchema.safeParse({})
  expect(r.success).toBe(true)
})

test('PATCH: typical content update parses', () => {
  const r = nodePatchSchema.safeParse({
    name: 'Renamed', summary: 'New summary', status: 'in_review',
  })
  expect(r.success).toBe(true)
})

test('PATCH: status enum out of range → fail', () => {
  const r = nodePatchSchema.safeParse({ status: 'published' })
  expect(r.success).toBe(false)
})

test('PATCH: locked=true accepted (admin/test path per §2.11.7)', () => {
  const r = nodePatchSchema.safeParse({ locked: true, status: 'locked' })
  expect(r.success).toBe(true)
})

test('PATCH: each PATCH-only-forbidden field individually → fail', () => {
  for (const field of PATCH_ONLY_FORBIDDEN) {
    const body: Record<string, unknown> = { [field]: 'anything' }
    const r = nodePatchSchema.safeParse(body)
    expect(r.success, `PATCH-forbidden field '${field}' must be rejected`).toBe(false)
    if (!r.success) {
      const hasUnknownKeys = r.error.issues.some(i => i.code === 'unrecognized_keys')
      expect(hasUnknownKeys, `PATCH-forbidden '${field}' must trip unrecognized_keys`).toBe(true)
    }
  }
})

test('PATCH: each universally forbidden field individually → fail', () => {
  for (const field of FORBIDDEN_BOTH) {
    const body: Record<string, unknown> = { [field]: 'anything' }
    const r = nodePatchSchema.safeParse(body)
    expect(r.success, `forbidden field '${field}' must be rejected on PATCH`).toBe(false)
    if (!r.success) {
      const hasUnknownKeys = r.error.issues.some(i => i.code === 'unrecognized_keys')
      expect(hasUnknownKeys, `forbidden '${field}' must trip unrecognized_keys on PATCH`).toBe(true)
    }
  }
})

test('PATCH: name empty after trim → fail', () => {
  const r = nodePatchSchema.safeParse({ name: '   ' })
  expect(r.success).toBe(false)
})

test('PATCH: prose oversize → fail', () => {
  const r = nodePatchSchema.safeParse({ prose: 'a'.repeat(1_000_001) })
  expect(r.success).toBe(false)
})
