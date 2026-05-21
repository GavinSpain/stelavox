/**
 * 2026-05-20 — regression guard for the propose_brief_amendment executor.
 *
 * Background: execProposeBriefAmendment in lib/director/tools/write.ts
 * had a latent schema-vs-code drift bug that went undiagnosed for five
 * days. The SELECT statement referenced briefs.preferences — a column
 * that hasn't existed since V1.x-A.1 (M-080 moved preferences off briefs
 * onto project_profiles). PostgREST returned a column-not-found error,
 * the Supabase client surfaced { data: null, error: <...> }, and the
 * unchecked `!brief` branch mistranslated that into
 * brief_not_found_in_session_scope.
 *
 * Every propose_brief_amendment call since V1.x-B.3 shipped 2026-05-15
 * hit this path. brief_amendments table had zero rows when discovered.
 * Push-model stage triggers silently failed end-to-end.
 *
 * The existing V1.x-B.3 tests in multibrief-and-amendments.spec.ts cover
 * the apply_brief_amendment RPC + brief_amendments CRUD, but NEVER drove
 * the propose_brief_amendment executor end-to-end. That's the coverage
 * gap that hid this bug.
 *
 * This spec closes the gap. Each test invokes the executor directly,
 * with a real session against the local DB, and asserts the artefact
 * shape returned. If a future column-drift bug recurs in the SELECT or
 * any other internal DB call, these tests fail loudly.
 *
 * Layer 3 of feedback_testing_methodology.md (invariant tests against
 * real DB). Skipped when SUPABASE_SERVICE_ROLE_KEY is unset.
 */

import { describe, expect, it, beforeAll } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { execProposeBriefAmendment } from '@/lib/director/tools/write'
import type { DirectorSession } from '@/lib/director/types'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54331'
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const hasServiceKey = SERVICE_KEY !== ''
const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

// Local Supabase test user (see reference_local_test_credentials.md
// in the project memory). Other test files use the tests/helpers/auth
// USERS fixture which targets test-a@example.com, but those users are
// provisioned by the Playwright global-setup which doesn't run for
// vitest. author@stelavox.local is the canonical local-dev user.
const TEST_USER_EMAIL = 'author@stelavox.local'

async function getOrgIdForTestUser(): Promise<string> {
  const { data: users } = await svc.auth.admin.listUsers({ perPage: 200 })
  const user = (users?.users ?? []).find((u) => u.email === TEST_USER_EMAIL)
  if (!user) throw new Error(`test user ${TEST_USER_EMAIL} not found in local auth.users`)
  const { data } = await svc
    .from('organisation_members')
    .select('organisation_id')
    .eq('user_id', user.id)
    .single()
  if (!data) throw new Error(`test user has no org membership`)
  return data.organisation_id
}

interface BriefFixture {
  docId: string
  briefId: string
  stage1Id: string
  stage2Id: string
  /** A leaf node we can target for a synthesise step in stage 2's amendment. */
  targetNodeId: string
}

/**
 * Seed: one active brief with stage 1 'completed' and stage 2 'planned'.
 * stage 2 has no workflow yet — the propose_brief_amendment call will
 * populate it via modify_pending_stage. Matches the push-model flow
 * exactly.
 */
async function seedBrief(orgId: string, namePrefix: string): Promise<BriefFixture> {
  const { data: project } = await svc
    .from('projects')
    .insert({ organisation_id: orgId, name: namePrefix })
    .select('id')
    .single()
  const { data: docRpc, error: docErr } = await svc.rpc('create_document_with_layer_stack', {
    p_project_id: project!.id,
    p_organisation_id: orgId,
    p_name: namePrefix,
    p_description: null as unknown as string,
    p_document_type: 'novel',
    p_authors: [],
  })
  if (docErr) throw new Error(`create_document RPC failed: ${docErr.message}`)
  const docId = (docRpc as { document: { id: string } }).document.id

  const { data: root } = await svc
    .from('nodes')
    .select('id')
    .eq('document_id', docId)
    .eq('depth', 0)
    .single()
  const { data: chapter } = await svc
    .from('nodes')
    .insert({
      organisation_id: orgId,
      document_id: docId,
      project_id: project!.id,
      node_category: 'structural',
      node_type: 'chapter',
      parent_id: root!.id,
      order: 1,
      depth: 1,
      layer_index: 1,
      name: 'chapter',
    })
    .select('id')
    .single()
  const { data: scene } = await svc
    .from('nodes')
    .insert({
      organisation_id: orgId,
      document_id: docId,
      project_id: project!.id,
      node_category: 'structural',
      node_type: 'scene',
      parent_id: chapter!.id,
      order: 1,
      depth: 2,
      layer_index: 2,
      name: 'scene',
      summary: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a scene' }] }],
      },
    })
    .select('id')
    .single()

  const { data: brief } = await svc
    .from('briefs')
    .insert({
      organisation_id: orgId,
      document_id: docId,
      status: 'active',
      sequence_position: 0,
      goal_text: `${namePrefix} — two-stage test brief`,
    })
    .select('id')
    .single()
  const { data: stage1 } = await svc
    .from('brief_stages')
    .insert({
      brief_id: brief!.id,
      order: 1,
      title: 'Stage 1',
      status: 'completed',
      trigger_type: 'manual',
      trigger_config: {},
    })
    .select('id')
    .single()
  const { data: stage2 } = await svc
    .from('brief_stages')
    .insert({
      brief_id: brief!.id,
      order: 2,
      title: 'Stage 2 — pending',
      status: 'planned',
      trigger_type: 'after_stage',
      trigger_config: { after_stage_order: 1 },
    })
    .select('id')
    .single()

  return {
    docId,
    briefId: brief!.id,
    stage1Id: stage1!.id,
    stage2Id: stage2!.id,
    targetNodeId: scene!.id,
  }
}

async function cleanup(fx: BriefFixture): Promise<void> {
  await svc.from('brief_amendments').delete().eq('brief_id', fx.briefId)
  await svc.from('brief_stages').delete().eq('brief_id', fx.briefId)
  await svc.from('briefs').delete().eq('id', fx.briefId)
  await svc.from('nodes').delete().eq('document_id', fx.docId)
}

describe.skipIf(!hasServiceKey)(
  'propose_brief_amendment executor — schema-drift regression guard (2026-05-20)',
  () => {
    let orgA: string
    beforeAll(async () => {
      orgA = await getOrgIdForTestUser()
    })

    it('modify_pending_stage with a populated workflow returns brief_amendment_proposal artefact', async () => {
      const fx = await seedBrief(orgA, `exec-modify-${Date.now()}`)
      try {
        const session: DirectorSession = {
          conversation_id: '00000000-0000-0000-0000-000000000000',
          document_id: fx.docId,
          organisation_id: orgA,
          user_id: '',
        }
        const result = await execProposeBriefAmendment(
          {
            brief_id: fx.briefId,
            amendment_type: 'modify_pending_stage',
            target_path: fx.stage2Id,
            after: {
              workflow: {
                title: 'Synthesise beats',
                description: 'Generate prose for stage 2 beats',
                steps: [
                  {
                    operation_type: 'synthesise',
                    target_node_id: fx.targetNodeId,
                    description: 'synthesise prose',
                    estimated_duration_seconds: 45,
                    parameters: {},
                  },
                ],
              },
            },
            reason: 'push-model planning result',
          },
          session,
        )
        expect(result.ok, JSON.stringify(result)).toBe(true)
        // The artefact MUST surface — that's what the iteration runner
        // extracts and the UI renders as a BriefAmendmentCard.
        expect(
          (result as { brief_amendment_proposal?: unknown }).brief_amendment_proposal,
        ).toBeDefined()
        const artefact = (
          result as { brief_amendment_proposal: Record<string, unknown> }
        ).brief_amendment_proposal
        expect(artefact.brief_id).toBe(fx.briefId)
        expect(artefact.amendment_type).toBe('modify_pending_stage')
        expect(artefact.target_path).toBe(fx.stage2Id)
      } finally {
        await cleanup(fx)
      }
    })

    it('2026-05-21 — modify_pending_stage accepts target_path as stage ORDER (string)', async () => {
      // Discovery: get_brief_state strips brief_stages.id from its
      // output and only exposes `order`. The Director naturally passed
      // target_path="2" (the stage order as a string) to
      // propose_brief_amendment; the executor only looked up by UUID
      // and rejected every call with target_stage_not_found.
      //
      // Fix: resolution falls back to (brief_id, order) when target_path
      // is a positive integer string. The artefact's target_path is
      // normalised to the resolved stage UUID for downstream consumers
      // (apply_brief_amendment RPC + brief_amendments row).
      const fx = await seedBrief(orgA, `exec-order-${Date.now()}`)
      try {
        const session: DirectorSession = {
          conversation_id: '00000000-0000-0000-0000-000000000000',
          document_id: fx.docId,
          organisation_id: orgA,
          user_id: '',
        }
        const result = await execProposeBriefAmendment(
          {
            brief_id: fx.briefId,
            amendment_type: 'modify_pending_stage',
            target_path: '2', // stage ORDER, not UUID — matches what get_brief_state exposes
            after: {
              workflow: {
                title: 'Synthesise beats',
                description: 'Generate prose',
                steps: [
                  {
                    operation_type: 'synthesise',
                    target_node_id: fx.targetNodeId,
                    description: 'synthesise',
                    estimated_duration_seconds: 45,
                    parameters: {},
                  },
                ],
              },
            },
            reason: 'order-based target_path',
          },
          session,
        )
        expect(result.ok, JSON.stringify(result)).toBe(true)
        const artefact = (
          result as { brief_amendment_proposal: Record<string, unknown> }
        ).brief_amendment_proposal
        // CRITICAL: target_path was normalised from "2" → the stage's UUID
        // so the downstream RPC + amendments row store the canonical form.
        expect(artefact.target_path).toBe(fx.stage2Id)
      } finally {
        await cleanup(fx)
      }
    })

    it('2026-05-21 — modify_pending_stage with target_path as UUID still works (backward compat)', async () => {
      // UUID lookup is tried first. This case ensures the order-fallback
      // didn't break the UUID path.
      const fx = await seedBrief(orgA, `exec-uuid-${Date.now()}`)
      try {
        const session: DirectorSession = {
          conversation_id: '00000000-0000-0000-0000-000000000000',
          document_id: fx.docId,
          organisation_id: orgA,
          user_id: '',
        }
        const result = await execProposeBriefAmendment(
          {
            brief_id: fx.briefId,
            amendment_type: 'modify_pending_stage',
            target_path: fx.stage2Id, // UUID form
            after: {
              workflow: {
                title: 'Synthesise',
                description: 'Generate prose',
                steps: [
                  {
                    operation_type: 'synthesise',
                    target_node_id: fx.targetNodeId,
                    description: 'synthesise',
                    estimated_duration_seconds: 45,
                    parameters: {},
                  },
                ],
              },
            },
            reason: 'uuid-based target_path',
          },
          session,
        )
        expect(result.ok, JSON.stringify(result)).toBe(true)
        const artefact = (
          result as { brief_amendment_proposal: Record<string, unknown> }
        ).brief_amendment_proposal
        expect(artefact.target_path).toBe(fx.stage2Id)
      } finally {
        await cleanup(fx)
      }
    })

    it('2026-05-21 — unknown stage order returns target_stage_not_found with instructive reason', async () => {
      const fx = await seedBrief(orgA, `exec-badorder-${Date.now()}`)
      try {
        const session: DirectorSession = {
          conversation_id: '00000000-0000-0000-0000-000000000000',
          document_id: fx.docId,
          organisation_id: orgA,
          user_id: '',
        }
        const result = await execProposeBriefAmendment(
          {
            brief_id: fx.briefId,
            amendment_type: 'modify_pending_stage',
            target_path: '99', // no stage with order=99 on this brief
            after: { workflow: { title: 'X', steps: [] } },
            reason: 'bad order',
          },
          session,
        )
        expect(result.ok).toBe(false)
        expect((result as { error: string }).error).toBe('target_stage_not_found')
        // The new reason must guide the model toward the right input shape.
        expect((result as { reason?: string }).reason).toMatch(/order/i)
      } finally {
        await cleanup(fx)
      }
    })

    it('goal_text amendment returns artefact (no preferences column needed)', async () => {
      // Directly preferences-adjacent: pre-fix the SELECT crashed on
      // briefs.preferences regardless of the amendment_type. The
      // goal_text case proves the SELECT works for the simplest
      // amendment shape.
      const fx = await seedBrief(orgA, `exec-goal-${Date.now()}`)
      try {
        const session: DirectorSession = {
          conversation_id: '00000000-0000-0000-0000-000000000000',
          document_id: fx.docId,
          organisation_id: orgA,
          user_id: '',
        }
        const result = await execProposeBriefAmendment(
          {
            brief_id: fx.briefId,
            amendment_type: 'goal_text',
            after: { goal_text: 'updated goal text' },
            reason: 'tighter scope',
          },
          session,
        )
        expect(result.ok, JSON.stringify(result)).toBe(true)
        const artefact = (
          result as { brief_amendment_proposal: Record<string, unknown> }
        ).brief_amendment_proposal
        expect(artefact.amendment_type).toBe('goal_text')
        expect((artefact.after as { goal_text: string }).goal_text).toBe('updated goal text')
      } finally {
        await cleanup(fx)
      }
    })

    it('cross-document brief returns brief_not_found_in_session_scope', async () => {
      // Belt-and-braces: the session-scope check must still reject a
      // brief whose document_id doesn't match the session. Before the
      // fix this branch was being hit for the WRONG reason (the SELECT
      // crashed); after the fix it should only fire for legitimate
      // cross-document attempts.
      const fx = await seedBrief(orgA, `exec-crossdoc-${Date.now()}`)
      try {
        const session: DirectorSession = {
          conversation_id: '00000000-0000-0000-0000-000000000000',
          document_id: '00000000-0000-0000-0000-000000000099', // different doc
          organisation_id: orgA,
          user_id: '',
        }
        const result = await execProposeBriefAmendment(
          {
            brief_id: fx.briefId,
            amendment_type: 'goal_text',
            after: { goal_text: 'shouldnt apply' },
            reason: 'cross-doc test',
          },
          session,
        )
        expect(result.ok).toBe(false)
        expect((result as { error: string }).error).toBe('brief_not_found_in_session_scope')
      } finally {
        await cleanup(fx)
      }
    })

    it('unknown brief_id returns brief_not_found_in_session_scope (clean lookup, not column error)', async () => {
      // Pre-fix this would error at the SELECT and surface
      // brief_not_found_in_session_scope by accident. Post-fix the
      // SELECT runs cleanly, returns null, and we still return
      // brief_not_found_in_session_scope but for the right reason.
      // The new brief_lookup_failed code is RESERVED for genuine DB
      // errors and must NOT fire for a clean "row not found".
      const session: DirectorSession = {
        conversation_id: '00000000-0000-0000-0000-000000000000',
        document_id: '00000000-0000-0000-0000-000000000099',
        organisation_id: orgA,
        user_id: '',
      }
      const result = await execProposeBriefAmendment(
        {
          brief_id: '00000000-0000-0000-0000-000000000aaa',
          amendment_type: 'goal_text',
          after: { goal_text: 'whatever' },
          reason: 'unknown brief test',
        },
        session,
      )
      expect(result.ok).toBe(false)
      expect((result as { error: string }).error).toBe('brief_not_found_in_session_scope')
      expect((result as { error: string }).error).not.toBe('brief_lookup_failed')
    })
  },
)
