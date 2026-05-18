/**
 * M-179 — create_rename_step write tool + workflow-executor node_rename branch.
 *
 * Methodology: feedback_testing_methodology.md (four layers).
 *
 * Layer 1 — pure-function input-schema tests (zod) over: happy path,
 *           empty-name rejection, whitespace-only rejection,
 *           over-length rejection, leading/trailing trim normalisation.
 * Layer 2 — tool contract on execCreateRenameStep: happy path,
 *           locked-node rejection, cross-document target,
 *           non-existent target, defensive empty/long handling.
 * Layer 3 — invariant on the workflow-executor branch: after a
 *           rename step executes against the live DB, the node's
 *           `name` is updated but `version` is NOT bumped (rename is
 *           metadata; matches the M-023 trigger's exclusion list).
 */

import { describe, expect, it } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { execCreateRenameStep } from '@/lib/director/tools/write'
import { ToolInputSchemas } from '@/lib/director/schemas'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54331'
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })
const hasServiceKey = SERVICE_KEY !== ''

// ---------------------------------------------------------------------------
// Layer 1 — input schema validation
// ---------------------------------------------------------------------------

describe('M-179 create_rename_step input schema — layer 1', () => {
  const schema = ToolInputSchemas.create_rename_step

  function args(overrides: Partial<z.input<typeof schema>>): z.input<typeof schema> {
    return {
      target_node_id: '550e8400-e29b-41d4-a716-446655440000',
      new_name: 'New Name',
      description: 'Rename for clarity',
      estimated_duration_seconds: 1,
      ...overrides,
    }
  }

  it('accepts happy-path input', () => {
    const r = schema.safeParse(args({}))
    expect(r.success).toBe(true)
  })

  it('rejects empty new_name', () => {
    expect(schema.safeParse(args({ new_name: '' })).success).toBe(false)
  })

  it('rejects whitespace-only new_name (trim → empty)', () => {
    expect(schema.safeParse(args({ new_name: '    ' })).success).toBe(false)
  })

  it('trims leading/trailing whitespace', () => {
    const r = schema.safeParse(args({ new_name: '  Trimmed  ' }))
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.new_name).toBe('Trimmed')
  })

  it('rejects new_name over 200 chars after trim', () => {
    const longName = 'x'.repeat(201)
    expect(schema.safeParse(args({ new_name: longName })).success).toBe(false)
  })

  it('accepts exactly 200 chars', () => {
    expect(schema.safeParse(args({ new_name: 'x'.repeat(200) })).success).toBe(true)
  })

  it('rejects invalid target_node_id (not UUID)', () => {
    expect(schema.safeParse(args({ target_node_id: 'not-a-uuid' })).success).toBe(false)
  })

  it('rejects missing required fields', () => {
    expect(schema.safeParse({ target_node_id: '550e8400-e29b-41d4-a716-446655440000' }).success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Layer 2 — tool contract (execCreateRenameStep)
// ---------------------------------------------------------------------------

describe.skipIf(!hasServiceKey)('M-179 execCreateRenameStep — layer 2', () => {
  const ORG_ID = '94822bb9-339a-4af4-a366-aa319fae1d25'
  const DOC_ID = '637acf44-38ab-42ad-b179-1d57844014b5'
  const session = {
    user_id: '5259319f-adde-4f29-9c6d-36b9dcea09c7',
    organisation_id: ORG_ID,
    document_id: DOC_ID,
    conversation_id: '00000000-0000-0000-0000-000000000000',
  } as never

  async function findId(name: string, nodeType: string): Promise<string | null> {
    const { data } = await svc
      .from('nodes')
      .select('id')
      .eq('document_id', DOC_ID)
      .eq('name', name)
      .eq('node_type', nodeType)
      .maybeSingle()
    return data?.id ?? null
  }

  it('happy path: proposes node_rename with trimmed new_name', async () => {
    const id = await findId('Salvage', 'chapter')
    if (!id) return
    const r = await execCreateRenameStep(
      {
        target_node_id: id,
        new_name: '  Salvage (renamed)  ',
        description: 'Rename for clarity',
        estimated_duration_seconds: 1,
      },
      session,
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const proposal = r.proposal!
    expect(proposal.operation_type).toBe('node_rename')
    expect(proposal.target_node_id).toBe(id)
    expect((proposal.parameters as { new_name: string }).new_name).toBe('Salvage (renamed)')
  })

  it('rejects target node not found', async () => {
    const r = await execCreateRenameStep(
      {
        target_node_id: '12345678-1234-1234-1234-123456789abc',
        new_name: 'X',
        description: 'x',
        estimated_duration_seconds: 1,
      },
      session,
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('target_node_not_found')
  })

  it('rejects cross-document target (within same org)', async () => {
    // Pick a node in the same org but a different document.
    const { data: foreign } = await svc
      .from('nodes')
      .select('id')
      .eq('organisation_id', ORG_ID)
      .neq('document_id', DOC_ID)
      .limit(1)
      .maybeSingle()
    if (!foreign) return // no foreign-doc nodes available; skip
    const r = await execCreateRenameStep(
      {
        target_node_id: foreign.id,
        new_name: 'X',
        description: 'x',
        estimated_duration_seconds: 1,
      },
      session,
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('cross_document_access_denied')
  })

  it('rejects locked node', async () => {
    const id = await findId('Salvage', 'chapter')
    if (!id) return
    // Insert a lock row.
    const { error: lockErr } = await svc.from('node_author_locks').insert({
      node_id: id,
      organisation_id: ORG_ID,
      locked_by_user_id: '5259319f-adde-4f29-9c6d-36b9dcea09c7',
      lock_reason: 'M-179 test',
    })
    if (lockErr) return // skip if already locked
    try {
      const r = await execCreateRenameStep(
        {
          target_node_id: id,
          new_name: 'X',
          description: 'x',
          estimated_duration_seconds: 1,
        },
        session,
      )
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.error).toBe('node_locked')
    } finally {
      await svc.from('node_author_locks').delete().eq('node_id', id)
    }
  })

  it('defensive: rejects empty new_name after trim', async () => {
    const id = await findId('Salvage', 'chapter')
    if (!id) return
    const r = await execCreateRenameStep(
      {
        target_node_id: id,
        new_name: '   ',
        description: 'x',
        estimated_duration_seconds: 1,
      },
      session,
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('invalid_new_name')
  })

  it('defensive: rejects new_name over 200 chars', async () => {
    const id = await findId('Salvage', 'chapter')
    if (!id) return
    const r = await execCreateRenameStep(
      {
        target_node_id: id,
        new_name: 'x'.repeat(201),
        description: 'x',
        estimated_duration_seconds: 1,
      },
      session,
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('invalid_new_name')
  })
})

// ---------------------------------------------------------------------------
// Layer 3 — invariant: rename via DB UPDATE preserves version
// ---------------------------------------------------------------------------

describe.skipIf(!hasServiceKey)('M-179 rename invariants — layer 3', () => {
  it('UPDATE nodes SET name does NOT bump version (matches TC-A-47 / M-023 exclusion)', async () => {
    // Pick any beat with prose so version > 1; rename it; assert
    // version is unchanged. Clean up by restoring original name.
    const { data: beat } = await svc
      .from('nodes')
      .select('id, name, version')
      .eq('document_id', '637acf44-38ab-42ad-b179-1d57844014b5')
      .eq('node_type', 'beat')
      .not('name', 'is', null)
      .limit(1)
      .maybeSingle()
    if (!beat) return

    const originalName = beat.name as string
    const originalVersion = beat.version as number
    const testName = `__M179_RENAME_${Date.now()}__`

    try {
      const { error } = await svc
        .from('nodes')
        .update({ name: testName })
        .eq('id', beat.id)
      expect(error).toBeNull()

      const { data: after } = await svc
        .from('nodes')
        .select('name, version')
        .eq('id', beat.id)
        .single()
      expect(after?.name).toBe(testName)
      expect(after?.version).toBe(originalVersion) // KEY INVARIANT
    } finally {
      await svc.from('nodes').update({ name: originalName }).eq('id', beat.id)
    }
  })
})
