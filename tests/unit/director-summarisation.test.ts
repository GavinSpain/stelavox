// TC-A-30 — Conversation summarisation crosses threshold and persists.
//
// Originally listed in Phase 5b Test Plan §10.2 as a cloud-smoke case.
// Closed off this session as a Vitest unit-style integration test that
// exercises the full I-9 path end-to-end:
//
//   1. Lower agent.director_session_max_tokens via platform_config (test
//      isolation: restored in afterAll).
//   2. Seed a conversation with messages whose token estimate crosses
//      the lowered threshold.
//   3. Verify shouldSummarise() returns true.
//   4. Run summariseConversation() with a real Anthropic Haiku provider.
//   5. Verify conversations.conversation_summary populated and
//      summary_covers_through advanced.
//   6. Restore the original threshold.
//
// Cost: ~$0.005 per run on Haiku 4.5. Skipped automatically when
// ANTHROPIC_API_KEY is missing or empty (CI safe).

import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import {
  estimateConversationTokens,
  shouldSummarise,
  summariseConversation,
} from '@/lib/director/conversation-context'
import { AnthropicProvider } from '@/lib/llm/providers/anthropic'

const TEST_USER_EMAIL = 'j5-walk@example.com'
const PROJECT_NAME = 'j5-novel'
const CONFIG_KEY = 'agent.director_session_max_tokens'
const TEST_THRESHOLD = 500
const ORIGINAL_THRESHOLD = 60000

const hasLLMKey = (process.env.ANTHROPIC_API_KEY ?? '').length > 0

interface SummariseFixture {
  admin: SupabaseClient
  orgId: string
  documentId: string
  conversationId: string
  originalThreshold: string | null
}

let fix: SummariseFixture | null = null

function admin(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required')
  }
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
}

beforeAll(async () => {
  const a = admin()
  const { data: users } = await a.auth.admin.listUsers({ perPage: 200 })
  const user = (users?.users ?? []).find((u) => u.email === TEST_USER_EMAIL)
  if (!user) throw new Error(`Test user ${TEST_USER_EMAIL} not seeded.`)
  const { data: member } = await a
    .from('organisation_members')
    .select('organisation_id')
    .eq('user_id', user.id)
    .single()
  if (!member) throw new Error('Test user has no org membership.')
  const { data: project } = await a
    .from('projects')
    .select('id')
    .eq('organisation_id', member.organisation_id)
    .eq('name', PROJECT_NAME)
    .maybeSingle()
  if (!project) throw new Error(`Project ${PROJECT_NAME} not seeded.`)
  const { data: doc } = await a
    .from('documents')
    .select('id')
    .eq('project_id', project.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!doc) throw new Error('No document in seeded project.')

  // Capture the original threshold so we can restore it in afterAll.
  const { data: cfg } = await a
    .from('platform_config')
    .select('value')
    .eq('key', CONFIG_KEY)
    .maybeSingle()
  const originalThreshold = cfg ? JSON.stringify(cfg.value) : null

  // Lower the threshold for the test.
  await a
    .from('platform_config')
    .update({ value: TEST_THRESHOLD })
    .eq('key', CONFIG_KEY)

  // Cross-suite isolation: conversations.document_id is UNIQUE, so any
  // residual conversation under this document blocks the INSERT. Residue
  // typically comes from the Phase 5b TC-A-15 Playwright test
  // (j5-workflow-approve.spec.ts) which seeds a conversation + workflow +
  // step + agent_job and isn't currently configured to delete-cascade
  // those rows on cleanup. Sweep the full chain in reverse-FK order
  // before our INSERT so this test re-runs cleanly regardless of which
  // suite ran before it.
  const { data: residualConvs } = await a
    .from('conversations')
    .select('id')
    .eq('document_id', doc.id)
  for (const rc of residualConvs ?? []) {
    const { data: residualWfs } = await a
      .from('workflows')
      .select('id')
      .eq('conversation_id', rc.id)
    for (const rwf of residualWfs ?? []) {
      const { data: residualSteps } = await a
        .from('workflow_steps')
        .select('id, agent_job_id')
        .eq('workflow_id', rwf.id)
      for (const rs of residualSteps ?? []) {
        await a.from('workflow_steps').delete().eq('id', rs.id)
        if (rs.agent_job_id) await a.from('agent_jobs').delete().eq('id', rs.agent_job_id)
      }
      await a.from('workflows').delete().eq('id', rwf.id)
    }
    await a.from('conversation_messages').delete().eq('conversation_id', rc.id)
    await a.from('conversations').delete().eq('id', rc.id)
  }

  // Create a fresh conversation isolated from any other test data.
  const { data: conv, error: convErr } = await a
    .from('conversations')
    .insert({ organisation_id: member.organisation_id, document_id: doc.id })
    .select('id')
    .single()
  if (convErr || !conv) throw new Error(`Conversation insert failed: ${convErr?.message ?? 'no row'}`)

  // Seed enough messages to exceed TEST_THRESHOLD when token-estimated.
  // estimateConversationTokens divides char-count by 4. To clear 500
  // tokens we need >2000 chars across the conversation.
  const longContent = 'The author asks about pacing in Chapter 3. The Director reads several scene summaries and identifies a structural drag where two interior beats sit back to back across the chapter break, then proposes a reorder that pulls the external action forward. '.repeat(6)
  const messageRows = [
    { role: 'user', content: longContent, sequence: 1, turn_state: 'final', author_user_id: user.id },
    { role: 'assistant', content: longContent, sequence: 2, turn_state: 'final' },
    { role: 'user', content: longContent, sequence: 3, turn_state: 'final', author_user_id: user.id },
    { role: 'assistant', content: longContent, sequence: 4, turn_state: 'final' },
  ].map((row) => ({ ...row, conversation_id: conv.id }))
  const { error: msgErr } = await a.from('conversation_messages').insert(messageRows)
  if (msgErr) throw new Error(`Seed messages failed: ${msgErr.message}`)

  fix = {
    admin: a,
    orgId: member.organisation_id,
    documentId: doc.id,
    conversationId: conv.id,
    originalThreshold,
  }
})

afterAll(async () => {
  if (!fix) return
  // Restore the original threshold.
  await fix.admin
    .from('platform_config')
    .update({ value: fix.originalThreshold ? JSON.parse(fix.originalThreshold) : ORIGINAL_THRESHOLD })
    .eq('key', CONFIG_KEY)
  // Clean up the seeded conversation.
  await fix.admin.from('conversations').delete().eq('id', fix.conversationId)
})

describe('TC-A-30 threshold check (no LLM)', () => {
  it('estimateConversationTokens returns a positive token count for the seeded conversation', async () => {
    if (!fix) throw new Error('fixture not initialised')
    const tokens = await estimateConversationTokens(fix.admin, fix.conversationId)
    expect(tokens).toBeGreaterThan(0)
  })

  it('estimateConversationTokens crosses the lowered threshold', async () => {
    if (!fix) throw new Error('fixture not initialised')
    const tokens = await estimateConversationTokens(fix.admin, fix.conversationId)
    expect(tokens).toBeGreaterThanOrEqual(TEST_THRESHOLD)
  })

  it('shouldSummarise returns true when tokens exceed the threshold', async () => {
    if (!fix) throw new Error('fixture not initialised')
    const result = await shouldSummarise(fix.admin, fix.conversationId)
    expect(result).toBe(true)
  })
})

describe.skipIf(!hasLLMKey)('TC-A-30 full flow (live Haiku, ~$0.005)', () => {
  it('summariseConversation populates conversation_summary and advances summary_covers_through', async () => {
    if (!fix) throw new Error('fixture not initialised')
    const provider = new AnthropicProvider(process.env.ANTHROPIC_API_KEY!)

    // Verify pre-state — no summary yet.
    const { data: before } = await fix.admin
      .from('conversations')
      .select('conversation_summary, summary_covers_through')
      .eq('id', fix.conversationId)
      .single()
    expect(before?.conversation_summary).toBeFalsy()

    await summariseConversation(
      fix.admin,
      fix.conversationId,
      provider,
      'claude-haiku-4-5-20251001',
    )

    const { data: after } = await fix.admin
      .from('conversations')
      .select('conversation_summary, summary_covers_through')
      .eq('id', fix.conversationId)
      .single()
    expect(after?.conversation_summary).toBeTruthy()
    expect((after?.conversation_summary as string).length).toBeGreaterThan(0)
    // The function summarises the OLDEST half — covers_through should be
    // a positive sequence number at or below the highest assistant message.
    expect(after?.summary_covers_through).toBeGreaterThan(0)
  })
})
