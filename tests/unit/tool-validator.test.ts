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
  // Phase 6: nodes.locked dropped. Find a chapter to lock and another to leave unlocked.
  const { data: chapters } = await a
    .from('nodes')
    .select('id')
    .eq('document_id', doc.id)
    .eq('node_type', 'chapter')
    .order('order')
    .limit(2)
  if (!chapters || chapters.length < 2) throw new Error('Need 2 chapters in fixture.')
  const locked = chapters[0]
  const unlocked = chapters[1]
  // Ensure the first one is locked (via node_author_locks).
  await a.from('node_author_locks').delete().eq('node_id', locked.id)  // clean prior runs
  await a.from('node_author_locks').delete().eq('node_id', unlocked.id)
  const { data: member2 } = await a
    .from('organisation_members').select('user_id').eq('organisation_id', member.organisation_id).limit(1).single()
  await a.from('node_author_locks').insert({
    node_id: locked.id, organisation_id: member.organisation_id,
    locked_by_user_id: member2!.user_id, lock_reason: 'tool-validator test',
  })
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
  // 2026-05-19 Phase 2 of create_*_step deprecation: the per-step
  // create_*_step tools are no longer registered as write tools. The
  // locked-node defence for workflow steps now lives in propose_brief's
  // per-step diagnostics (see tests/unit/m181-phase1-per-step-validation:
  // "rejects a rename targeting a locked node with per_step_errors").
  // After Phase 2, validateToolCall returns 'unknown_tool' for the
  // deprecated step tools; the locked-node check is exercised via
  // propose_brief's per-step lock validator.
  it.skip('SUPERSEDED — denies create_refine_step targeting a locked chapter (was node_locked, now unknown_tool)', async () => {
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

  it.skip('SUPERSEDED — allows create_refine_step targeting an unlocked chapter', async () => {
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

  it('Phase 2: deprecated create_*_step tools are denied by validateToolCall', async () => {
    // After Phase 2, create_refine_step is no longer registered as a
    // write tool. ToolInputSchemas still has the entry (Phase 3 cleanup
    // will drop it), so the deny reason depends on which check fires
    // first — input parse fails because we're not exercising the full
    // legacy shape, or the tool isn't in any registry. Either way the
    // tool is unreachable as a write — what matters here.
    const result = await validateToolCall({
      toolName: 'create_refine_step',
      arguments: { target_node_id: '00000000-0000-0000-0000-000000000000' },
      session: session(),
    })
    expect(result.allowed).toBe(false)
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

  it.skip('SUPERSEDED — denies create_refine_step against a fabricated UUID (was cross_org_access_denied)', async () => {
    // Phase 2: create_refine_step returns unknown_tool from
    // validateToolCall before reaching the org-scope check. The
    // cross-org defence for workflow steps now lives in propose_brief's
    // target-existence check (lib/director/tools/write.ts:checkNodesExist
    // scopes by organisation_id + document_id).
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
