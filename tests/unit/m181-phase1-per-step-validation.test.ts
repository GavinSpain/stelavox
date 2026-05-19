/**
 * Phase 1 of create_*_step deprecation refactor (precursor to M-181).
 *
 * Tests the strengthened propose_brief validation:
 *   - Per-op-type discriminated parameter validation in StepSchema
 *     (lib/brief/proposalBuilder.ts)
 *   - Per-step author-lock check in execProposeBrief
 *   - per_step_errors response shape on any validation failure
 *
 * The create_*_step tools remain registered in this phase — Phase 2
 * removes them. Today's tests exercise propose_brief's new behaviour
 * directly without depending on create_*_step at all.
 *
 * Methodology: feedback_testing_methodology.md (four layers).
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { execProposeBrief } from '@/lib/director/tools/write'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54331'
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })
const hasServiceKey = SERVICE_KEY !== ''

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

function brief(steps: Array<Record<string, unknown>>): Record<string, unknown> {
  return {
    goal_text: 'Test brief',
    preferences: {},
    stages: [
      {
        order: 1,
        title: 'Test stage',
        description: 'x',
        trigger_type: 'manual',
        trigger_config: {},
        workflow: {
          title: 'Test',
          description: 'x',
          impact_summary: 'x',
          estimated_total_minutes: 1,
          steps,
        },
      },
    ],
  }
}

function renameStep(target_node_id: string, new_name = 'Renamed'): Record<string, unknown> {
  return {
    operation_type: 'node_rename',
    target_node_id,
    description: 'Rename',
    estimated_duration_seconds: 10,
    parameters: { new_name },
  }
}

// ===========================================================================
// Layer 1 — per-op-type parameter validation via Zod discriminated union
// ===========================================================================

describe.skipIf(!hasServiceKey)('Phase 1 — per-op-type parameter validation', () => {
  it('refine step requires parameters.target_field + parameters.instruction', async () => {
    const id = (await findId('Salvage', 'chapter'))!
    if (!id) return
    // Missing parameters.instruction
    const r = await execProposeBrief(
      brief([
        {
          operation_type: 'refine',
          target_node_id: id,
          description: 'Refine',
          estimated_duration_seconds: 10,
          parameters: { target_field: 'summary' },
        },
      ]),
      session,
    )
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toBe('invalid_brief_proposal')
      expect(r.per_step_errors).toBeTruthy()
      const e = r.per_step_errors![0]
      expect(e.error).toBe('invalid_step_shape')
      expect(e.path).toContain('parameters')
      expect(e.path).toContain('instruction')
    }
  })

  it('refine step rejects an unknown target_field enum value', async () => {
    const id = (await findId('Salvage', 'chapter'))!
    if (!id) return
    const r = await execProposeBrief(
      brief([
        {
          operation_type: 'refine',
          target_node_id: id,
          description: 'Refine',
          estimated_duration_seconds: 10,
          parameters: { target_field: 'not_a_field', instruction: 'tighten' },
        },
      ]),
      session,
    )
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.per_step_errors).toBeTruthy()
      const e = r.per_step_errors!.find((e) => e.path?.includes('target_field'))
      expect(e).toBeTruthy()
      expect(e!.error).toBe('invalid_step_shape')
    }
  })

  it('node_rename step requires parameters.new_name', async () => {
    const id = (await findId('Salvage', 'chapter'))!
    if (!id) return
    const r = await execProposeBrief(
      brief([
        {
          operation_type: 'node_rename',
          target_node_id: id,
          description: 'Rename',
          estimated_duration_seconds: 10,
          parameters: {},
        },
      ]),
      session,
    )
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.per_step_errors).toBeTruthy()
      const e = r.per_step_errors![0]
      expect(e.error).toBe('invalid_step_shape')
      expect(e.path).toContain('parameters')
      expect(e.path).toContain('new_name')
    }
  })

  it('node_rename step rejects new_name > 200 chars', async () => {
    const id = (await findId('Salvage', 'chapter'))!
    if (!id) return
    const r = await execProposeBrief(
      brief([renameStep(id, 'x'.repeat(201))]),
      session,
    )
    expect(r.ok).toBe(false)
  })

  it('comment step requires parameters.comment_type + parameters.content', async () => {
    const id = (await findId('Salvage', 'chapter'))!
    if (!id) return
    const r = await execProposeBrief(
      brief([
        {
          operation_type: 'comment',
          target_node_id: id,
          description: 'Comment',
          estimated_duration_seconds: 5,
          parameters: { comment_type: 'note' }, // missing content
        },
      ]),
      session,
    )
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.per_step_errors).toBeTruthy()
      const e = r.per_step_errors!.find((e) => e.path?.includes('content'))
      expect(e).toBeTruthy()
    }
  })

  it('node_reorder step requires parameters.new_order', async () => {
    const id = (await findId('Salvage', 'chapter'))!
    if (!id) return
    const r = await execProposeBrief(
      brief([
        {
          operation_type: 'node_reorder',
          target_node_id: id,
          description: 'Reorder',
          estimated_duration_seconds: 5,
          parameters: {},
        },
      ]),
      session,
    )
    expect(r.ok).toBe(false)
  })

  it('synthesise step accepts empty parameters {}', async () => {
    const id = (await findId('The Routine', 'beat'))!
    if (!id) return
    const r = await execProposeBrief(
      brief([
        {
          operation_type: 'synthesise',
          target_node_id: id,
          description: 'Synthesise',
          estimated_duration_seconds: 60,
          parameters: {},
        },
      ]),
      session,
    )
    expect(r.ok).toBe(true)
  })

  it('synthesise step accepts no parameters field at all (defaults to {})', async () => {
    const id = (await findId('The Routine', 'beat'))!
    if (!id) return
    const r = await execProposeBrief(
      brief([
        {
          operation_type: 'synthesise',
          target_node_id: id,
          description: 'Synthesise',
          estimated_duration_seconds: 60,
        },
      ]),
      session,
    )
    expect(r.ok).toBe(true)
  })

  it('rejects unknown operation_type via discriminated-union', async () => {
    const id = (await findId('Salvage', 'chapter'))!
    if (!id) return
    const r = await execProposeBrief(
      brief([
        {
          operation_type: 'not_a_real_op',
          target_node_id: id,
          description: 'x',
          estimated_duration_seconds: 5,
          parameters: {},
        },
      ]),
      session,
    )
    expect(r.ok).toBe(false)
  })
})

// ===========================================================================
// Layer 3 — per-step lock check in execProposeBrief
// ===========================================================================

describe.skipIf(!hasServiceKey)('Phase 1 — per-step author-lock check', () => {
  let lockedNodeId: string | null = null

  beforeAll(async () => {
    lockedNodeId = await findId('Salvage', 'chapter')
    if (!lockedNodeId) return
    // Insert a lock; tear down after the suite.
    const { error } = await svc.from('node_author_locks').insert({
      node_id: lockedNodeId,
      organisation_id: ORG_ID,
      locked_by_user_id: '5259319f-adde-4f29-9c6d-36b9dcea09c7',
      lock_reason: 'Phase 1 test lock',
    })
    if (error) {
      // Already locked from a prior failed run — leave it; we'll still test
      // the rejection path, just won't tear down.
    }
  })

  afterAll(async () => {
    if (!lockedNodeId) return
    await svc.from('node_author_locks').delete().eq('node_id', lockedNodeId)
  })

  it('rejects a rename targeting a locked node with per_step_errors[*].error="node_locked"', async () => {
    if (!lockedNodeId) return
    const r = await execProposeBrief(brief([renameStep(lockedNodeId)]), session)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toBe('invalid_brief_proposal')
      expect(r.per_step_errors).toBeTruthy()
      const e = r.per_step_errors![0]
      expect(e.error).toBe('node_locked')
      expect(e.target_node_id).toBe(lockedNodeId)
      expect(e.stage_order).toBe(1)
      expect(e.step_index).toBe(0)
    }
  })

  it('mixed: one locked + one missing → reports both with correct locations', async () => {
    if (!lockedNodeId) return
    const fakeId = '7a5e55c5-1bb0-4ebc-9234-a9b97e8f0b8f'
    const r = await execProposeBrief(
      brief([renameStep(lockedNodeId, 'A'), renameStep(fakeId, 'B')]),
      session,
    )
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.per_step_errors).toHaveLength(2)
      const lockedErr = r.per_step_errors!.find((e) => e.target_node_id === lockedNodeId)
      const missingErr = r.per_step_errors!.find((e) => e.target_node_id === fakeId)
      expect(lockedErr?.error).toBe('node_locked')
      expect(lockedErr?.step_index).toBe(0)
      expect(missingErr?.error).toBe('target_node_not_found')
      expect(missingErr?.step_index).toBe(1)
    }
  })
})

// ===========================================================================
// Layer 2 — happy path still works
// ===========================================================================

describe.skipIf(!hasServiceKey)('Phase 1 — happy path unchanged', () => {
  it('valid Brief proposal returns ok with brief_proposal_full as before', async () => {
    const id = await findId('The Routine', 'beat')
    if (!id) return
    const r = await execProposeBrief(
      brief([
        {
          operation_type: 'comment',
          target_node_id: id,
          description: 'Add a note',
          estimated_duration_seconds: 5,
          parameters: { comment_type: 'note', content: 'A test note.' },
        },
      ]),
      session,
    )
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.brief_proposal).toBeTruthy()
      expect(r.brief_proposal_full).toBeTruthy()
    }
  })
})
