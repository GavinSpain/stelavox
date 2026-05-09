/**
 * Phase 5d hardening drive — Tiers 1, 2, 4, 6.
 *
 * Direct API + Postgres script. Runs against the local stack on
 * APP_URL (default http://localhost:3000). Bypasses Playwright's
 * webServer race so we can iterate fast.
 *
 * Usage:
 *   tsx scripts/hardening-drive.ts [tier1|tier2|tier4|tier6|all]
 *
 * Each tier is independent. Each test reports pass/fail and the
 * surfaced bug shape; the script tallies bug-rate at the end.
 *
 * Auth: signs in as test-a@example.com (bootstrapped by the standard
 * Playwright globalSetup helper or the manual seed). If sign-in fails,
 * the script bootstraps the user via the admin API.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../lib/types/database'

const APP_URL = process.env.PLAYWRIGHT_APP_URL ?? 'http://localhost:3000'
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54331'
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const TEST_USER_EMAIL = 'test-a@example.com'
const TEST_USER_PASSWORD = 'Test1234!Test1234!'

if (!SUPABASE_SERVICE_KEY || !SUPABASE_ANON_KEY) {
  console.error('SUPABASE_SERVICE_ROLE_KEY and NEXT_PUBLIC_SUPABASE_ANON_KEY required')
  process.exit(1)
}

const admin = createClient<Database>(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

interface Result {
  id: string
  desc: string
  pass: boolean
  detail?: string
}

const results: Result[] = []

function check(id: string, desc: string, pass: boolean, detail?: string) {
  results.push({ id, desc, pass, detail })
  const icon = pass ? '✓' : '✗'
  console.log(`  ${icon} ${id} ${desc}${pass ? '' : ` — ${detail}`}`)
}

async function ensureUserAndSignIn(): Promise<string> {
  // Ensure the user exists.
  const { data: list } = await admin.auth.admin.listUsers({ perPage: 200 })
  const existing = list?.users?.find((u) => u.email === TEST_USER_EMAIL)
  if (!existing) {
    const { error } = await admin.auth.admin.createUser({
      email: TEST_USER_EMAIL,
      password: TEST_USER_PASSWORD,
      email_confirm: true,
    })
    if (error && !error.message.includes('already registered')) throw error
    await new Promise((r) => setTimeout(r, 300))
  }

  // Sign in via the anon client to get an access token.
  const anon = createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data, error } = await anon.auth.signInWithPassword({
    email: TEST_USER_EMAIL,
    password: TEST_USER_PASSWORD,
  })
  if (error) throw new Error(`signin failed: ${error.message}`)
  return data.session!.access_token
}

class Api {
  constructor(private token: string) {}

  async req(method: string, path: string, body?: unknown): Promise<{ status: number; body: unknown }> {
    const res = await fetch(`${APP_URL}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        cookie: '', // we drive via Authorization header
        authorization: `Bearer ${this.token}`,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
    let parsed: unknown = null
    try {
      parsed = await res.json()
    } catch {
      // empty / non-JSON body
    }
    return { status: res.status, body: parsed }
  }
}

interface Bootstrap {
  api: Api
  projectId: string
  documentId: string
  rootId: string
  bookId: string
  actId: string
  chapterId: string
  sceneId: string
  beatId: string
}

async function bootstrap(api: Api): Promise<Bootstrap> {
  const ts = Date.now()
  const projRes = await api.req('POST', '/api/projects', {
    name: `harden-${ts}`,
    description: 'hardening drive',
  })
  if (projRes.status >= 400) throw new Error(`bootstrap project ${projRes.status}: ${JSON.stringify(projRes.body)}`)
  const projectId = (projRes.body as { project: { id: string } }).project.id

  const docRes = await api.req('POST', `/api/projects/${projectId}/documents`, {
    name: `harden-doc-${ts}`,
    document_type: 'novel',
  })
  if (docRes.status >= 400) throw new Error(`bootstrap doc ${docRes.status}`)
  const documentId = (docRes.body as { document: { id: string } }).document.id

  const treeRes = await api.req('GET', `/api/documents/${documentId}/nodes`)
  const rootId = (treeRes.body as { nodes: Array<{ id: string }> }).nodes[0].id

  async function child(parentId: string, name: string): Promise<string> {
    const r = await api.req('POST', `/api/documents/${documentId}/nodes`, { parent_id: parentId, name })
    if (r.status >= 400) throw new Error(`bootstrap ${name} ${r.status}: ${JSON.stringify(r.body)}`)
    return (r.body as { node: { id: string } }).node.id
  }

  const bookId = await child(rootId, 'Book')
  const actId = await child(bookId, 'Act')
  const chapterId = await child(actId, 'Chapter')
  const sceneId = await child(chapterId, 'Scene')
  const beatId = await child(sceneId, 'Beat')

  return { api, projectId, documentId, rootId, bookId, actId, chapterId, sceneId, beatId }
}

async function teardown(projectId: string): Promise<void> {
  await admin.from('projects').delete().eq('id', projectId)
}

// ── TIER 1 ─────────────────────────────────────────────────────────────

async function tier1(api: Api): Promise<void> {
  console.log('\n=== TIER 1 — untested surfaces ===')

  // T1-LOCK-01: PATCH summary on locked node returns 423
  {
    const ctx = await bootstrap(api)
    try {
      await api.req('PATCH', `/api/nodes/${ctx.chapterId}`, { locked: true, lock_reason: 'lock test' })
      const r = await api.req('PATCH', `/api/nodes/${ctx.chapterId}`, { summary: 'should fail' })
      check('T1-LOCK-01', 'edit on locked node → 423', r.status === 423, `got ${r.status} ${JSON.stringify(r.body)}`)
    } finally {
      await teardown(ctx.projectId)
    }
  }

  // T1-LOCK-02: child of locked parent returns 423 (parent_locked)
  {
    const ctx = await bootstrap(api)
    try {
      await api.req('PATCH', `/api/nodes/${ctx.actId}`, { locked: true, lock_reason: 'parent lock' })
      const r = await api.req('PATCH', `/api/nodes/${ctx.chapterId}`, { summary: 'child' })
      check('T1-LOCK-02', 'edit on parent-locked → 423', r.status === 423, `got ${r.status} ${JSON.stringify(r.body)}`)
    } finally {
      await teardown(ctx.projectId)
    }
  }

  // T1-LOCK-03: expand on locked book → 423
  {
    const ctx = await bootstrap(api)
    try {
      await api.req('PATCH', `/api/nodes/${ctx.bookId}`, { locked: true, lock_reason: 'expand lock' })
      const r = await api.req('POST', '/api/agent/expand', { node_id: ctx.bookId })
      check('T1-LOCK-03', 'expand on locked book → 4xx', r.status >= 400 && r.status < 500, `got ${r.status} ${JSON.stringify(r.body)}`)
    } finally {
      await teardown(ctx.projectId)
    }
  }

  // T1-LOCK-04: synthesise on locked beat → 4xx (with summary so J14-6 passes)
  {
    const ctx = await bootstrap(api)
    try {
      await api.req('PATCH', `/api/nodes/${ctx.beatId}`, { summary: 'a beat with content' })
      await api.req('PATCH', `/api/nodes/${ctx.beatId}`, { locked: true, lock_reason: 'synth lock' })
      const r = await api.req('POST', '/api/agent/synthesise', { node_id: ctx.beatId })
      check('T1-LOCK-04', 'synth on locked beat → 4xx', r.status >= 400 && r.status < 500, `got ${r.status} ${JSON.stringify(r.body)}`)
    } finally {
      await teardown(ctx.projectId)
    }
  }

  // T1-LOCK-05: synthesise on beat with EMPTY summary → 422 summary_required (J14-6)
  {
    const ctx = await bootstrap(api)
    try {
      const r = await api.req('POST', '/api/agent/synthesise', { node_id: ctx.beatId })
      const body = r.body as { error?: string }
      check('T1-LOCK-05', 'synth on empty-summary beat → 422 summary_required (J14-6)',
        r.status === 422 && body.error === 'summary_required',
        `got ${r.status} error=${body.error}`)
    } finally {
      await teardown(ctx.projectId)
    }
  }

  // T1-LINK-01: create + list + delete context link
  {
    const ctx = await bootstrap(api)
    try {
      const c = await api.req('POST', `/api/projects/${ctx.projectId}/context-nodes`, {
        scope: 'project',
        node_type: 'character',
        name: 'Voss',
      })
      const ctxNodeId = (c.body as { node: { id: string } }).node.id
      const link = await api.req('POST', `/api/nodes/${ctx.bookId}/context-links`, { context_node_id: ctxNodeId })
      check('T1-LINK-01a', 'create context link', link.status >= 200 && link.status < 300, `${link.status}`)
      const del = await api.req('DELETE', `/api/nodes/${ctx.bookId}/context-links/${ctxNodeId}`)
      check('T1-LINK-01b', 'delete context link', del.status >= 200 && del.status < 300, `${del.status}`)
    } finally {
      await teardown(ctx.projectId)
    }
  }

  // T1-LINK-02: link with non-existent context → 4xx
  {
    const ctx = await bootstrap(api)
    try {
      const r = await api.req('POST', `/api/nodes/${ctx.bookId}/context-links`, {
        context_node_id: '00000000-0000-0000-0000-000000000000',
      })
      check('T1-LINK-02', 'link to non-existent context → 4xx', r.status >= 400 && r.status < 500, `${r.status}`)
    } finally {
      await teardown(ctx.projectId)
    }
  }

  // T1-DEL-01: delete chapter cascades to scenes + beats
  {
    const ctx = await bootstrap(api)
    try {
      const before = await admin.from('nodes').select('id').eq('document_id', ctx.documentId)
      const beforeIds = new Set((before.data ?? []).map((n) => n.id))
      const r = await api.req('DELETE', `/api/nodes/${ctx.chapterId}`)
      check('T1-DEL-01a', 'delete chapter → 2xx', r.status >= 200 && r.status < 300, `${r.status}`)
      const after = await admin.from('nodes').select('id').eq('document_id', ctx.documentId)
      const afterIds = new Set((after.data ?? []).map((n) => n.id))
      check('T1-DEL-01b', 'cascade removes scene', !afterIds.has(ctx.sceneId), 'scene survived')
      check('T1-DEL-01c', 'cascade removes beat', !afterIds.has(ctx.beatId), 'beat survived')
      void beforeIds
    } finally {
      await teardown(ctx.projectId)
    }
  }

  // T1-DEL-02: delete root refused
  {
    const ctx = await bootstrap(api)
    try {
      const r = await api.req('DELETE', `/api/nodes/${ctx.rootId}`)
      check('T1-DEL-02', 'delete root refused', r.status >= 400, `${r.status}`)
    } finally {
      await teardown(ctx.projectId)
    }
  }

  // T1-MOVE-01: move chapter to a different act
  {
    const ctx = await bootstrap(api)
    try {
      const act2 = await api.req('POST', `/api/documents/${ctx.documentId}/nodes`, {
        parent_id: ctx.bookId, name: 'Act 2',
      })
      const act2Id = (act2.body as { node: { id: string } }).node.id
      const r = await api.req('PATCH', `/api/nodes/${ctx.chapterId}/move`, { parent_id: act2Id, position: 0 })
      check('T1-MOVE-01', 'move chapter to act 2', r.status >= 200 && r.status < 300, `${r.status} ${JSON.stringify(r.body)}`)
    } finally {
      await teardown(ctx.projectId)
    }
  }

  // T1-MOVE-02: move act under its own descendant chapter → cycle prevention
  {
    const ctx = await bootstrap(api)
    try {
      const r = await api.req('PATCH', `/api/nodes/${ctx.actId}/move`, {
        parent_id: ctx.chapterId, position: 0,
      })
      check('T1-MOVE-02', 'cycle move refused', r.status >= 400 && r.status < 500, `${r.status} ${JSON.stringify(r.body)}`)
    } finally {
      await teardown(ctx.projectId)
    }
  }
}

// ── TIER 2 ─────────────────────────────────────────────────────────────

async function tier2(api: Api): Promise<void> {
  console.log('\n=== TIER 2 — boundary / data extremes ===')

  // T2-NAME-01: empty name on PATCH → 4xx
  {
    const ctx = await bootstrap(api)
    try {
      const r = await api.req('PATCH', `/api/nodes/${ctx.bookId}`, { name: '' })
      check('T2-NAME-01', 'empty name → 4xx', r.status >= 400 && r.status < 500, `${r.status}`)
    } finally {
      await teardown(ctx.projectId)
    }
  }

  // T2-NAME-02: whitespace-only name → 4xx
  {
    const ctx = await bootstrap(api)
    try {
      const r = await api.req('PATCH', `/api/nodes/${ctx.bookId}`, { name: '   \t\n  ' })
      check('T2-NAME-02', 'whitespace-only name → 4xx', r.status >= 400 && r.status < 500, `${r.status}`)
    } finally {
      await teardown(ctx.projectId)
    }
  }

  // T2-NAME-03: 200-char name accepted (max length)
  {
    const ctx = await bootstrap(api)
    try {
      const max = 'x'.repeat(200)
      const r = await api.req('PATCH', `/api/nodes/${ctx.bookId}`, { name: max })
      check('T2-NAME-03', '200-char name accepted', r.status >= 200 && r.status < 300, `${r.status}`)
    } finally {
      await teardown(ctx.projectId)
    }
  }

  // T2-NAME-04: 201-char name rejected
  {
    const ctx = await bootstrap(api)
    try {
      const over = 'x'.repeat(201)
      const r = await api.req('PATCH', `/api/nodes/${ctx.bookId}`, { name: over })
      check('T2-NAME-04', '201-char name rejected', r.status >= 400 && r.status < 500, `${r.status}`)
    } finally {
      await teardown(ctx.projectId)
    }
  }

  // T2-NAME-05: unicode name accepted
  {
    const ctx = await bootstrap(api)
    try {
      const r = await api.req('PATCH', `/api/nodes/${ctx.bookId}`, { name: '世界 — book' })
      check('T2-NAME-05', 'unicode name accepted', r.status >= 200 && r.status < 300, `${r.status}`)
    } finally {
      await teardown(ctx.projectId)
    }
  }

  // T2-NAME-06: emoji name accepted
  {
    const ctx = await bootstrap(api)
    try {
      const r = await api.req('PATCH', `/api/nodes/${ctx.bookId}`, { name: '🚢 Tariff War 🚀' })
      check('T2-NAME-06', 'emoji name accepted', r.status >= 200 && r.status < 300, `${r.status}`)
    } finally {
      await teardown(ctx.projectId)
    }
  }

  // T2-SEC-01: HTML in name persists raw (no XSS path through summary editor)
  {
    const ctx = await bootstrap(api)
    try {
      const malicious = '<script>alert(1)</script>'
      const r = await api.req('PATCH', `/api/nodes/${ctx.bookId}`, { name: malicious })
      check('T2-SEC-01a', 'HTML in name accepted (server-side)', r.status >= 200 && r.status < 300, `${r.status}`)
      // Verify it's stored exactly as-is
      const { data } = await admin.from('nodes').select('name').eq('id', ctx.bookId).single()
      check('T2-SEC-01b', 'HTML stored raw (no server-side sanitisation)', data?.name === malicious, `got: ${data?.name}`)
    } finally {
      await teardown(ctx.projectId)
    }
  }

  // T2-SEC-02: SQL injection in name doesn't execute
  {
    const ctx = await bootstrap(api)
    try {
      const sql = "'; DROP TABLE nodes; --"
      const r = await api.req('PATCH', `/api/nodes/${ctx.bookId}`, { name: sql })
      check('T2-SEC-02a', "SQL-injection-shaped name accepted as data", r.status >= 200 && r.status < 300, `${r.status}`)
      // Verify nodes table still exists
      const { count } = await admin.from('nodes').select('id', { count: 'exact', head: true })
      check('T2-SEC-02b', 'nodes table not dropped', (count ?? 0) > 0, 'table missing')
    } finally {
      await teardown(ctx.projectId)
    }
  }

  // T2-SUM-01: very large summary (50KB)
  {
    const ctx = await bootstrap(api)
    try {
      const large = 'word '.repeat(10_000)  // 50,000 chars
      const r = await api.req('PATCH', `/api/nodes/${ctx.bookId}`, { summary: large })
      check('T2-SUM-01', '50KB summary accepted', r.status >= 200 && r.status < 300, `${r.status}`)
    } finally {
      await teardown(ctx.projectId)
    }
  }

  // T2-SUM-02: summary just over the 100KB cap
  {
    const ctx = await bootstrap(api)
    try {
      const over = 'x'.repeat(100_001)
      const r = await api.req('PATCH', `/api/nodes/${ctx.bookId}`, { summary: over })
      check('T2-SUM-02', '100k+1 summary rejected', r.status >= 400 && r.status < 500, `${r.status}`)
    } finally {
      await teardown(ctx.projectId)
    }
  }

  // T2-SUM-03: prose 1MB
  {
    const ctx = await bootstrap(api)
    try {
      const big = 'x'.repeat(1_000_000)
      const r = await api.req('PATCH', `/api/nodes/${ctx.beatId}`, { prose: big })
      check('T2-SUM-03', '1MB prose accepted (under 2M cap)', r.status >= 200 && r.status < 300, `${r.status}`)
    } finally {
      await teardown(ctx.projectId)
    }
  }

  // T2-WCT-01: word_count_target negative
  {
    const ctx = await bootstrap(api)
    try {
      const r = await api.req('PATCH', `/api/nodes/${ctx.bookId}`, { word_count_target: -1 })
      check('T2-WCT-01', 'negative word_count_target rejected', r.status >= 400 && r.status < 500, `${r.status}`)
    } finally {
      await teardown(ctx.projectId)
    }
  }

  // T2-WCT-02: word_count_target zero
  {
    const ctx = await bootstrap(api)
    try {
      const r = await api.req('PATCH', `/api/nodes/${ctx.bookId}`, { word_count_target: 0 })
      check('T2-WCT-02', 'zero word_count_target accepted (≥0)', r.status >= 200 && r.status < 300, `${r.status}`)
    } finally {
      await teardown(ctx.projectId)
    }
  }
}

// ── TIER 4 ─────────────────────────────────────────────────────────────

async function tier4(api: Api): Promise<void> {
  console.log('\n=== TIER 4 — concurrency / failure injection ===')

  // T4-CONC-01: two PATCHes race; second hits 409 with expected_content_revision
  {
    const ctx = await bootstrap(api)
    try {
      // Get current content_revision
      const { data: before } = await admin
        .from('nodes')
        .select('content_revision')
        .eq('id', ctx.bookId)
        .single()
      const cr = before!.content_revision

      // Fire both patches in parallel; one wins, other should 409.
      const a = api.req('PATCH', `/api/nodes/${ctx.bookId}`, {
        summary: 'A',
        expected_content_revision: cr,
      })
      const b = api.req('PATCH', `/api/nodes/${ctx.bookId}`, {
        summary: 'B',
        expected_content_revision: cr,
      })
      const [resA, resB] = await Promise.all([a, b])
      const winners = [resA, resB].filter((r) => r.status >= 200 && r.status < 300).length
      const losers = [resA, resB].filter((r) => r.status === 409).length
      check('T4-CONC-01', 'concurrent PATCH with same expected_revision → 1 win + 1 conflict',
        winners === 1 && losers === 1, `wins=${winners} conflicts=${losers}`)
    } finally {
      await teardown(ctx.projectId)
    }
  }

  // T4-CONC-02: same-content PATCH twice doesn't bump content_revision
  {
    const ctx = await bootstrap(api)
    try {
      await api.req('PATCH', `/api/nodes/${ctx.bookId}`, { summary: 'identical content' })
      const { data: mid } = await admin
        .from('nodes')
        .select('content_revision')
        .eq('id', ctx.bookId)
        .single()
      const crMid = mid!.content_revision

      // Second identical PATCH
      await api.req('PATCH', `/api/nodes/${ctx.bookId}`, { summary: 'identical content' })
      const { data: after } = await admin
        .from('nodes')
        .select('content_revision')
        .eq('id', ctx.bookId)
        .single()
      const crAfter = after!.content_revision

      check('T4-CONC-02', 'identical-content PATCH does not bump content_revision (IS DISTINCT FROM)',
        crAfter === crMid, `mid=${crMid} after=${crAfter}`)
    } finally {
      await teardown(ctx.projectId)
    }
  }

  // T4-CONC-03: double-Accept on same job is idempotent
  {
    const ctx = await bootstrap(api)
    try {
      // Seed a fake completed job we can Accept twice
      const { data: job } = await admin
        .from('agent_jobs')
        .insert({
          organisation_id: (await admin.from('nodes').select('organisation_id').eq('id', ctx.bookId).single()).data!.organisation_id,
          node_id: ctx.bookId,
          document_id: ctx.documentId,
          operation_type: 'expand',
          operation_class: 'single_node',
          status: 'completed',
          triggered_by: 'test',
          target_node_version_at_capture: 1,
          result_child_nodes: [
            { name: 'Generated Act', short_description: 'sd', summary: 's', position: 0 },
          ],
        })
        .select('id')
        .single()

      const r1 = api.req('POST', `/api/agent-jobs/${job!.id}/accept`)
      const r2 = api.req('POST', `/api/agent-jobs/${job!.id}/accept`)
      const [a, b] = await Promise.all([r1, r2])
      const successful = [a, b].filter((r) => r.status >= 200 && r.status < 300).length

      // Both should succeed (one applies, one is idempotent on already-accepted)
      check('T4-CONC-03', 'concurrent double-Accept idempotent',
        successful === 2, `s1=${a.status} s2=${b.status}`)
    } finally {
      await teardown(ctx.projectId)
    }
  }
}

// ── TIER 6 ─────────────────────────────────────────────────────────────

async function tier6(api: Api): Promise<void> {
  console.log('\n=== TIER 6 — RLS / permission edges ===')

  // T6-RLS-01: User B (different org) cannot read User A's project
  {
    // Create User B
    const userB = `test-b-rls-${Date.now()}@example.com`
    const userBPass = 'Test1234!Test1234!'
    await admin.auth.admin.createUser({
      email: userB,
      password: userBPass,
      email_confirm: true,
    })
    await new Promise((r) => setTimeout(r, 300))

    const userActx = await bootstrap(api)
    try {
      // Sign in as B
      const anonB = createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: { autoRefreshToken: false, persistSession: false },
      })
      const { data: bSession } = await anonB.auth.signInWithPassword({
        email: userB,
        password: userBPass,
      })
      const bToken = bSession?.session?.access_token
      if (!bToken) throw new Error('user B sign-in failed')

      // B tries to GET A's project
      const r = await fetch(`${APP_URL}/api/projects/${userActx.projectId}`, {
        headers: { authorization: `Bearer ${bToken}` },
      })
      check('T6-RLS-01', "User B cannot read User A's project (404 RLS-hidden)",
        r.status === 404, `got ${r.status}`)

      // B tries to GET A's document
      const r2 = await fetch(`${APP_URL}/api/documents/${userActx.documentId}`, {
        headers: { authorization: `Bearer ${bToken}` },
      })
      check('T6-RLS-02', "User B cannot read User A's document (404 RLS-hidden)",
        r2.status === 404, `got ${r2.status}`)

      // B tries to GET A's tree
      const r3 = await fetch(`${APP_URL}/api/documents/${userActx.documentId}/nodes`, {
        headers: { authorization: `Bearer ${bToken}` },
      })
      check('T6-RLS-03', "User B cannot read User A's tree (404 / empty)",
        r3.status === 404 || (r3.status === 200 && (await r3.json()).nodes?.length === 0),
        `got ${r3.status}`)

      // B tries to PATCH A's node
      const r4 = await fetch(`${APP_URL}/api/nodes/${userActx.bookId}`, {
        method: 'PATCH',
        headers: { authorization: `Bearer ${bToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'hacked' }),
      })
      check('T6-RLS-04', "User B cannot PATCH User A's node",
        r4.status === 404 || r4.status === 403, `got ${r4.status}`)

      // B tries to DELETE A's project
      const r5 = await fetch(`${APP_URL}/api/projects/${userActx.projectId}`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${bToken}` },
      })
      check('T6-RLS-05', "User B cannot DELETE User A's project",
        r5.status === 404 || r5.status === 403, `got ${r5.status}`)
    } finally {
      await teardown(userActx.projectId)
      // Clean up user B
      const { data: list } = await admin.auth.admin.listUsers({ perPage: 200 })
      const bUser = list?.users?.find((u) => u.email === userB)
      if (bUser) await admin.auth.admin.deleteUser(bUser.id)
    }
  }
}

// ── MAIN ───────────────────────────────────────────────────────────────

async function main() {
  const which = process.argv[2] ?? 'all'
  const token = await ensureUserAndSignIn()
  const api = new Api(token)

  if (which === 'tier1' || which === 'all') await tier1(api)
  if (which === 'tier2' || which === 'all') await tier2(api)
  if (which === 'tier4' || which === 'all') await tier4(api)
  if (which === 'tier6' || which === 'all') await tier6(api)

  // Summary
  const passed = results.filter((r) => r.pass).length
  const failed = results.filter((r) => !r.pass).length
  console.log(`\n=== HARDENING DRIVE SUMMARY ===`)
  console.log(`  passed: ${passed}`)
  console.log(`  failed: ${failed}`)
  if (failed > 0) {
    console.log(`\n  FAILED CHECKS:`)
    for (const r of results.filter((r) => !r.pass)) {
      console.log(`    ✗ ${r.id} ${r.desc} — ${r.detail}`)
    }
  }
  process.exit(failed === 0 ? 0 : 1)
}

void main()
