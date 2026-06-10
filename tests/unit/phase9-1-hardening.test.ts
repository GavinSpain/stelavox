/**
 * Phase 9.1 — security + correctness hardening unit tests.
 *
 * Covers the DB-touching halves of the phase against the real local
 * Supabase stack (the established m210-style pattern):
 *
 *   DR-100 / M-215 — increment_usage_record RPC:
 *     1. First call INSERTs a fresh row with the given token values
 *     2. Second call ADDS to the existing row (ON CONFLICT branch)
 *     3. Concurrent calls all land — total equals the sum (no lost
 *        updates; the old SELECT-then-INSERT race is structurally gone)
 *     4. RPC is not callable as anon (service-role only grant)
 *
 *   DR-102 / F-89 — assertConversationAuthor fallback:
 *     5. No user messages + caller IS an org member  → pass (null)
 *     6. No user messages + caller NOT a member      → 403
 *     7. First-user-message author mismatch          → 403 (regression)
 *     8. First-user-message author match             → pass (regression)
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient } from '@supabase/supabase-js'

import { assertConversationAuthor } from '@/lib/director/route-helpers'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54331'
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''
const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })
const hasServiceKey = SERVICE_KEY !== ''

interface Fixture {
  orgId: string
  memberUserId: string
  outsiderUserId: string
  documentId: string
  conversationId: string
}

let fix: Fixture | null = null

async function createAuthUser(email: string): Promise<string> {
  const { data, error } = await svc.auth.admin.createUser({
    email,
    password: 'Phase91!Test!Pass',
    email_confirm: true,
  })
  if (error || !data.user) throw new Error(`createAuthUser: ${error?.message}`)
  return data.user.id
}

beforeAll(async () => {
  if (!hasServiceKey) return

  const stamp = Date.now()
  const memberUserId = await createAuthUser(`phase91-member-${stamp}@test.local`)
  const outsiderUserId = await createAuthUser(`phase91-outsider-${stamp}@test.local`)

  // handle_new_user trigger auto-creates an org + membership for each
  // user. Use the member's auto-org as the fixture org.
  const { data: membership } = await svc
    .from('organisation_members')
    .select('organisation_id')
    .eq('user_id', memberUserId)
    .maybeSingle()
  if (!membership) throw new Error('member auto-org missing')
  const orgId = membership.organisation_id as string

  // A document via the canonical RPC so layer-stack invariants hold.
  const { data: project, error: projErr } = await svc
    .from('projects')
    .insert({ organisation_id: orgId, name: `phase91-${stamp}` })
    .select('id')
    .single()
  if (projErr || !project) throw new Error(`project insert: ${projErr?.message}`)

  const { data: docResult, error: docErr } = await svc.rpc('create_document_with_layer_stack', {
    p_project_id: project.id,
    p_organisation_id: orgId,
    p_name: 'Phase 9.1 fixture',
    p_description: null as unknown as string,
    p_document_type: 'novel',
    p_authors: [],
  })
  if (docErr || !docResult) throw new Error(`create_document: ${docErr?.message}`)
  const documentId = (docResult as { document: { id: string } }).document.id

  // A conversation with NO user messages (the F-89 edge).
  const { data: conv, error: convErr } = await svc
    .from('conversations')
    .insert({ organisation_id: orgId, document_id: documentId })
    .select('id')
    .single()
  if (convErr || !conv) throw new Error(`conversation insert: ${convErr?.message}`)

  fix = {
    orgId,
    memberUserId,
    outsiderUserId,
    documentId,
    conversationId: conv.id as string,
  }
})

afterAll(async () => {
  if (!hasServiceKey || !fix) return
  // Cascade order: usage rows, conversation, document tree via project.
  await svc.from('usage_records').delete().eq('organisation_id', fix.orgId)
  await svc.from('conversation_messages').delete().eq('conversation_id', fix.conversationId)
  await svc.from('conversations').delete().eq('id', fix.conversationId)
  await svc.auth.admin.deleteUser(fix.memberUserId).catch(() => {
    /* fixture user may hold FK refs; acceptable residue in local dev DB */
  })
  await svc.auth.admin.deleteUser(fix.outsiderUserId).catch(() => {
    /* same */
  })
})

describe.skipIf(!hasServiceKey)('M-215 increment_usage_record (DR-100)', () => {
  const ym = '2099-01' // far-future month avoids collisions with real rows
  const op = 'phase91_test_op'
  const provider = 'anthropic'

  async function readRow() {
    const { data } = await svc
      .from('usage_records')
      .select('tokens_input, tokens_output, tokens_cache_write, tokens_cache_read')
      .eq('organisation_id', fix!.orgId)
      .eq('year_month', ym)
      .eq('operation_type', op)
      .eq('provider', provider)
      .maybeSingle()
    return data as
      | { tokens_input: number; tokens_output: number; tokens_cache_write: number; tokens_cache_read: number }
      | null
  }

  function rpcArgs(tokens: number) {
    return {
      p_organisation_id: fix!.orgId,
      p_year_month: ym,
      p_operation_type: op,
      p_provider: provider,
      p_tokens_input: tokens,
      p_tokens_output: tokens * 2,
      p_tokens_cache_write: 0,
      p_tokens_cache_read: 0,
    }
  }

  it('1. first call INSERTs a fresh row', async () => {
    const { error } = await svc.rpc('increment_usage_record', rpcArgs(100))
    expect(error).toBeNull()
    const row = await readRow()
    expect(row).not.toBeNull()
    expect(row!.tokens_input).toBe(100)
    expect(row!.tokens_output).toBe(200)
  })

  it('2. second call ADDS to the existing row', async () => {
    const { error } = await svc.rpc('increment_usage_record', rpcArgs(50))
    expect(error).toBeNull()
    const row = await readRow()
    expect(row!.tokens_input).toBe(150)
    expect(row!.tokens_output).toBe(300)
  })

  it('3. concurrent calls all land — no lost updates', async () => {
    const before = await readRow()
    const base = before!.tokens_input
    const results = await Promise.all(
      Array.from({ length: 8 }, () => svc.rpc('increment_usage_record', rpcArgs(10))),
    )
    for (const r of results) expect(r.error).toBeNull()
    const after = await readRow()
    expect(after!.tokens_input).toBe(base + 80)
  })

  it('4. anon role cannot call the RPC', async () => {
    const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } })
    const { error } = await anon.rpc('increment_usage_record', rpcArgs(1))
    expect(error).not.toBeNull()
  })
})

describe.skipIf(!hasServiceKey)('assertConversationAuthor fallback (DR-102 / F-89)', () => {
  it('5. no user messages + caller IS an org member → pass', async () => {
    const result = await assertConversationAuthor(
      svc,
      fix!.conversationId,
      fix!.memberUserId,
    )
    expect(result).toBeNull()
  })

  it('6. no user messages + caller NOT a member → 403', async () => {
    const result = await assertConversationAuthor(
      svc,
      fix!.conversationId,
      fix!.outsiderUserId,
    )
    expect(result).not.toBeNull()
    expect(result!.status).toBe(403)
  })

  it('7. author mismatch on first user message → 403 (regression)', async () => {
    await svc.from('conversation_messages').insert({
      conversation_id: fix!.conversationId,
      role: 'user',
      content: 'phase 9.1 fixture message',
      sequence: 1,
      author_user_id: fix!.memberUserId,
    })
    const result = await assertConversationAuthor(
      svc,
      fix!.conversationId,
      fix!.outsiderUserId,
    )
    expect(result).not.toBeNull()
    expect(result!.status).toBe(403)
  })

  it('8. author match on first user message → pass (regression)', async () => {
    const result = await assertConversationAuthor(
      svc,
      fix!.conversationId,
      fix!.memberUserId,
    )
    expect(result).toBeNull()
  })
})
