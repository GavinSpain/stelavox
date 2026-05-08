// SU-44 — TC-S-02 unit-style integration test for validateToolCall's
// locked-node defence. Mode-skipped in tests/director/api.spec.ts because
// Playwright cannot dynamic-import the project's ESM lib/ modules.
//
// This test depends on the j5-novel fixture being seeded against the local
// Supabase stack (Chapter 1 is locked there). To prepare:
//   npx tsx scripts/seed-director-fixture.ts --scenario j5-novel --reset
//
// The test reads the seeded data via admin client, then exercises the
// real validateToolCall() function. Self-contained: no mutations.

import { describe, expect, it, beforeAll } from 'vitest'
import { createClient } from '@supabase/supabase-js'

import { validateToolCall } from '@/lib/security/tool-validator'
import type { DirectorSession } from '@/lib/director/types'

const TEST_USER_EMAIL = 'j5-walk@example.com'
const PROJECT_NAME = 'j5-novel'

interface FixtureRefs {
  orgId: string
  documentId: string
  lockedChapterId: string
  unlockedChapterId: string
}

let fixture: FixtureRefs | null = null

function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY must be set; run scripts/seed-director-fixture.ts first.')
  }
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
}

beforeAll(async () => {
  const a = admin()
  const { data: users } = await a.auth.admin.listUsers({ perPage: 200 })
  const user = (users?.users ?? []).find((u) => u.email === TEST_USER_EMAIL)
  if (!user) throw new Error(`Test user ${TEST_USER_EMAIL} not found. Run the seed script first.`)
  const { data: member } = await a
    .from('organisation_members')
    .select('organisation_id')
    .eq('user_id', user.id)
    .single()
  if (!member) throw new Error('Test user has no organisation_members row.')
  const { data: project } = await a
    .from('projects')
    .select('id')
    .eq('organisation_id', member.organisation_id)
    .eq('name', PROJECT_NAME)
    .maybeSingle()
  if (!project) throw new Error(`Project "${PROJECT_NAME}" not seeded. Run scripts/seed-director-fixture.ts.`)
  const { data: doc } = await a
    .from('documents')
    .select('id')
    .eq('project_id', project.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!doc) throw new Error('No document in j5-novel project. Re-seed.')
  const { data: locked } = await a
    .from('nodes')
    .select('id')
    .eq('document_id', doc.id)
    .eq('node_type', 'chapter')
    .eq('locked', true)
    .limit(1)
    .maybeSingle()
  if (!locked) throw new Error('No locked chapter in seeded fixture.')
  const { data: unlocked } = await a
    .from('nodes')
    .select('id')
    .eq('document_id', doc.id)
    .eq('node_type', 'chapter')
    .eq('locked', false)
    .limit(1)
    .maybeSingle()
  if (!unlocked) throw new Error('No unlocked chapter in seeded fixture.')
  fixture = {
    orgId: member.organisation_id,
    documentId: doc.id,
    lockedChapterId: locked.id,
    unlockedChapterId: unlocked.id,
  }
})

function session(overrides: Partial<DirectorSession> = {}): DirectorSession {
  if (!fixture) throw new Error('beforeAll did not seed fixture')
  return {
    user_id: '00000000-0000-0000-0000-000000000000',
    organisation_id: fixture.orgId,
    document_id: fixture.documentId,
    conversation_id: '00000000-0000-0000-0000-000000000000',
    ...overrides,
  } as DirectorSession
}

describe('TC-S-02 — validateToolCall blocks locked-node write', () => {
  it('denies create_refine_step targeting a locked chapter (node_locked)', async () => {
    if (!fixture) throw new Error('fixture not seeded')
    const result = await validateToolCall({
      toolName: 'create_refine_step',
      arguments: {
        target_node_id: fixture.lockedChapterId,
        target_field: 'summary',
        instruction: 'tighten',
        description: 'Should be denied — chapter is locked.',
        estimated_duration_seconds: 30,
      },
      session: session(),
    })
    expect(result.allowed).toBe(false)
    if (!result.allowed) {
      expect(result.reason).toBe('node_locked')
    }
  })

  it('allows create_refine_step targeting an unlocked chapter (sanity-positive)', async () => {
    if (!fixture) throw new Error('fixture not seeded')
    const result = await validateToolCall({
      toolName: 'create_refine_step',
      arguments: {
        target_node_id: fixture.unlockedChapterId,
        target_field: 'summary',
        instruction: 'tighten',
        description: 'Permitted — chapter is not locked.',
        estimated_duration_seconds: 30,
      },
      session: session(),
    })
    expect(result.allowed).toBe(true)
  })

  it('allows get_node (a read tool) on a locked chapter', async () => {
    if (!fixture) throw new Error('fixture not seeded')
    const result = await validateToolCall({
      toolName: 'get_node',
      arguments: { node_id: fixture.lockedChapterId },
      session: session(),
    })
    expect(result.allowed).toBe(true)
  })

  it('denies a write tool against a fabricated UUID (cross_org_access_denied)', async () => {
    const result = await validateToolCall({
      toolName: 'create_refine_step',
      arguments: {
        target_node_id: 'b2c3d4e5-f678-4abc-9def-0123456789ab',
        target_field: 'summary',
        instruction: 'fabricated',
        description: 'Fabricated node id.',
        estimated_duration_seconds: 30,
      },
      session: session(),
    })
    expect(result.allowed).toBe(false)
    if (!result.allowed) {
      expect(result.reason).toBe('cross_org_access_denied')
    }
  })
})
