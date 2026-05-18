/**
 * M-180 — propose_brief target_node_id FK verification + v1.21 prompt.
 *
 * Methodology: feedback_testing_methodology.md (four layers).
 *
 * Layer 1 — N/A directly (the verifier is async / DB-bound). Covered by
 *           layer 2.
 * Layer 2 — verifyProposedTargetNodeIds + execProposeBrief contract:
 *   - empty input → ok
 *   - all real ids in same doc → ok
 *   - one fake id mixed with real → missingIds reports the fake one
 *   - id from another doc (same org) → missingIds (cross-doc rejected)
 *   - id from another org → missingIds (cross-org rejected)
 *   - propose_brief rejects with target_node_ids_not_found when any
 *     workflow step references a non-existent id
 *   - propose_brief teaching reason names find_node_by_name
 * Layer 3 — invariant: every Brief that reaches the proposal stage has
 *           all target_node_ids verified.
 */

import { describe, expect, it } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { execProposeBrief, verifyProposedTargetNodeIds } from '@/lib/director/tools/write'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54331'
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })
const hasServiceKey = SERVICE_KEY !== ''

describe.skipIf(!hasServiceKey)('M-180 verifyProposedTargetNodeIds — layer 2', () => {
  const ORG_ID = '94822bb9-339a-4af4-a366-aa319fae1d25'
  const DOC_ID = '637acf44-38ab-42ad-b179-1d57844014b5'
  const session = {
    user_id: '5259319f-adde-4f29-9c6d-36b9dcea09c7',
    organisation_id: ORG_ID,
    document_id: DOC_ID,
    conversation_id: '00000000-0000-0000-0000-000000000000',
  } as never

  it('empty input → ok', async () => {
    const r = await verifyProposedTargetNodeIds(session, [])
    expect(r.ok).toBe(true)
  })

  it('all real ids in same doc → ok', async () => {
    const { data: real } = await svc
      .from('nodes')
      .select('id')
      .eq('document_id', DOC_ID)
      .limit(3)
    if (!real || real.length === 0) return
    const r = await verifyProposedTargetNodeIds(session, real.map((n) => n.id as string))
    expect(r.ok).toBe(true)
  })

  it('one fake id mixed with real → missingIds carries only the fake', async () => {
    const { data: real } = await svc
      .from('nodes')
      .select('id')
      .eq('document_id', DOC_ID)
      .limit(2)
    if (!real || real.length < 2) return
    const fake = '7a5e55c5-1bb0-4ebc-9234-a9b97e8f0b8f'
    const ids = [real[0].id as string, fake, real[1].id as string]
    const r = await verifyProposedTargetNodeIds(session, ids)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.missingIds).toEqual([fake])
    }
  })

  it('cross-document id (same org) → reported as missing', async () => {
    const { data: foreign } = await svc
      .from('nodes')
      .select('id')
      .eq('organisation_id', ORG_ID)
      .neq('document_id', DOC_ID)
      .limit(1)
      .maybeSingle()
    if (!foreign) return
    const r = await verifyProposedTargetNodeIds(session, [foreign.id as string])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.missingIds).toEqual([foreign.id])
  })

  it('cross-org id → reported as missing', async () => {
    const { data: foreign } = await svc
      .from('nodes')
      .select('id')
      .neq('organisation_id', ORG_ID)
      .limit(1)
      .maybeSingle()
    if (!foreign) return
    const r = await verifyProposedTargetNodeIds(session, [foreign.id as string])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.missingIds).toEqual([foreign.id])
  })

  it('deduplicates: same fake id repeated returns it once', async () => {
    const fake = '7a5e55c5-1bb0-4ebc-9234-a9b97e8f0b8f'
    const r = await verifyProposedTargetNodeIds(session, [fake, fake, fake])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.missingIds).toEqual([fake])
  })
})

describe.skipIf(!hasServiceKey)('M-180 execProposeBrief integration — layer 2', () => {
  const ORG_ID = '94822bb9-339a-4af4-a366-aa319fae1d25'
  const DOC_ID = '637acf44-38ab-42ad-b179-1d57844014b5'
  const session = {
    user_id: '5259319f-adde-4f29-9c6d-36b9dcea09c7',
    organisation_id: ORG_ID,
    document_id: DOC_ID,
    conversation_id: '00000000-0000-0000-0000-000000000000',
  } as never

  function briefWithTarget(targetId: string): Record<string, unknown> {
    return {
      goal_text: 'Test rename for M-180 verification',
      preferences: {},
      stages: [
        {
          order: 1,
          title: 'Test',
          description: 'Rename one node',
          trigger_type: 'manual',
          trigger_config: {},
          workflow: {
            title: 'Test',
            description: 'x',
            impact_summary: 'x',
            estimated_total_minutes: 1,
            steps: [
              {
                order: 1,
                operation_type: 'node_rename',
                target_node_id: targetId,
                description: 'Test rename',
                estimated_duration_seconds: 10,
                parameters: { new_name: 'Test New Name' },
              },
            ],
          },
        },
      ],
    }
  }

  it('rejects propose_brief with hallucinated target_node_id', async () => {
    const fake = '7a5e55c5-1bb0-4ebc-9234-a9b97e8f0b8f'
    const r = await execProposeBrief(briefWithTarget(fake), session)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toBe('target_node_ids_not_found')
      expect(r.reason).toContain(fake)
      expect(r.reason).toContain('find_node_by_name')
    }
  })

  it('accepts propose_brief with a real target_node_id', async () => {
    const { data: real } = await svc
      .from('nodes')
      .select('id')
      .eq('document_id', DOC_ID)
      .eq('node_type', 'beat')
      .limit(1)
      .maybeSingle()
    if (!real) return
    const r = await execProposeBrief(briefWithTarget(real.id as string), session)
    expect(r.ok).toBe(true)
  })

  it('rejects with the EXACT failure shape observed live (3 hallucinated UUIDs)', async () => {
    // Reproduces the propose_brief input the model produced on the
    // failing turn that triggered M-180.
    const observed = {
      goal_text: 'Rename the three "The Countdown" nodes',
      preferences: {},
      stages: [
        {
          order: 1,
          title: 'Rename three Countdown instances',
          description: 'Apply three renames',
          trigger_type: 'manual',
          trigger_config: {},
          workflow: {
            title: 'Rename three Countdown instances',
            description: 'x',
            impact_summary: 'x',
            estimated_total_minutes: 1,
            steps: [
              {
                order: 1,
                operation_type: 'node_rename',
                target_node_id: '7a5e55c5-1bb0-4ebc-9234-a9b97e8f0b8f',
                description: 'x',
                estimated_duration_seconds: 10,
                parameters: { new_name: 'The Signal Released' },
              },
              {
                order: 2,
                operation_type: 'node_rename',
                target_node_id: '3d5f4e72-0f1c-4c3a-8c56-2f8b1d4a9e6c',
                description: 'x',
                estimated_duration_seconds: 10,
                parameters: { new_name: 'The Vow Breaks' },
              },
              {
                order: 3,
                operation_type: 'node_rename',
                target_node_id: '9c8e2b1a-5f3d-4e7c-9a1d-6b2f8c4a1e9d',
                description: 'x',
                estimated_duration_seconds: 10,
                parameters: { new_name: 'Recognition' },
              },
            ],
          },
        },
      ],
    }
    const r = await execProposeBrief(observed, session)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toBe('target_node_ids_not_found')
      // All three hallucinated IDs are flagged.
      expect(r.reason).toContain('7a5e55c5')
      expect(r.reason).toContain('3d5f4e72')
      expect(r.reason).toContain('9c8e2b1a')
    }
  })
})
