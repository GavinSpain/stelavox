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

interface SsrSession {
  cookieHeader: string
}

/**
 * Build the @supabase/ssr cookie shape the API routes expect.
 *
 * The SSR helper reads cookies named `sb-<projectref>-auth-token` (often
 * chunked into `.0`, `.1`, ...). The cookie value is a base64url-encoded
 * JSON of the full session payload prefixed with `base64-`.
 *
 * For local dev (URL = http://127.0.0.1:54331), the project ref is the
 * URL host: `127`. We sign in via the supabase-js client to get a real
 * session and then format it the way the SSR client expects to read it.
 */
async function ensureUserAndSignIn(): Promise<SsrSession> {
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

  // Sign in via the anon client to get the full session.
  const anon = createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data, error } = await anon.auth.signInWithPassword({
    email: TEST_USER_EMAIL,
    password: TEST_USER_PASSWORD,
  })
  if (error) throw new Error(`signin failed: ${error.message}`)
  const session = data.session!

  // Project ref derivation per supabase/ssr conventions: hostname without dots.
  // For http://127.0.0.1:54331, host is 127.0.0.1; supabase/ssr uses the
  // first dot-separated piece as the project ref. Local dev = '127'.
  const url = new URL(SUPABASE_URL)
  const host = url.hostname  // 127.0.0.1
  const projectRef = host.split('.')[0] ?? 'localhost'
  const cookieName = `sb-${projectRef}-auth-token`

  // Modern @supabase/ssr stores the session as a base64-encoded JSON
  // OBJECT (not array) prefixed with 'base64-'. Verified shape from a
  // live tests/.auth/test-a.json: { access_token, token_type,
  // expires_in, expires_at, refresh_token, user, ... }.
  const sessionPayload = {
    access_token: session.access_token,
    token_type: 'bearer',
    expires_in: session.expires_in,
    expires_at: session.expires_at,
    refresh_token: session.refresh_token,
    user: data.user,
  }
  const json = JSON.stringify(sessionPayload)
  const b64 = Buffer.from(json, 'utf-8').toString('base64')
  const cookieHeader = `${cookieName}=base64-${b64}`

  return { cookieHeader }
}

class Api {
  constructor(private session: SsrSession) {}

  async req(method: string, path: string, body?: unknown): Promise<{ status: number; body: unknown }> {
    const res = await fetch(`${APP_URL}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        cookie: this.session.cookieHeader,
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

  // Use 'series' document so we get all 6 layers (series_root → book →
  // act → chapter → scene → beat). Tests use 'book' as the closest
  // analogue to 'novel' for cross-doc-type comparisons.
  const docRes = await api.req('POST', `/api/projects/${projectId}/documents`, {
    name: `harden-doc-${ts}`,
    document_type: 'series',
  })
  if (docRes.status >= 400) throw new Error(`bootstrap doc ${docRes.status}: ${JSON.stringify(docRes.body)}`)
  const documentId = (docRes.body as { document: { id: string } }).document.id

  const treeRes = await api.req('GET', `/api/documents/${documentId}/nodes`)
  const rootId = (treeRes.body as { nodes: Array<{ id: string }> }).nodes[0].id

  async function child(parentId: string, name: string, node_type: string): Promise<string> {
    const r = await api.req('POST', `/api/documents/${documentId}/nodes`, { parent_id: parentId, name, node_type })
    if (r.status >= 400) throw new Error(`bootstrap ${name} ${r.status}: ${JSON.stringify(r.body)}`)
    return (r.body as { node: { id: string } }).node.id
  }

  // Layer types per series layer stack
  const bookId = await child(rootId, 'Book', 'book')
  const actId = await child(bookId, 'Act', 'act')
  const chapterId = await child(actId, 'Chapter', 'chapter')
  const sceneId = await child(chapterId, 'Scene', 'scene')
  const beatId = await child(sceneId, 'Beat', 'beat')

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
        parent_id: ctx.bookId, name: 'Act 2', node_type: 'act',
      })
      if (act2.status >= 400) {
        check('T1-MOVE-01-pre', 'create Act 2 for move test', false, `${act2.status} ${JSON.stringify(act2.body)}`)
      } else {
        const act2Id = (act2.body as { node: { id: string } }).node.id
        const r = await api.req('PATCH', `/api/nodes/${ctx.chapterId}/move`, { parent_id: act2Id, position: 0 })
        check('T1-MOVE-01', 'move chapter to act 2', r.status >= 200 && r.status < 300, `${r.status} ${JSON.stringify(r.body)}`)
      }
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
        winners === 1 && losers === 1,
        `wins=${winners} conflicts=${losers} A=${resA.status} ${JSON.stringify(resA.body)} B=${resB.status} ${JSON.stringify(resB.body)}`)
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
      const bSessionData = bSession?.session
      if (!bSessionData) throw new Error('user B sign-in failed')
      // Format B's session as an SSR cookie too
      const url = new URL(SUPABASE_URL)
      const projectRef = url.hostname.split('.')[0] ?? 'localhost'
      const cookieName = `sb-${projectRef}-auth-token`
      const bPayload = {
        access_token: bSessionData.access_token,
        token_type: 'bearer',
        expires_in: bSessionData.expires_in,
        expires_at: bSessionData.expires_at,
        refresh_token: bSessionData.refresh_token,
        user: bSessionData.user,
      }
      const bCookie = `${cookieName}=base64-${Buffer.from(JSON.stringify(bPayload), 'utf-8').toString('base64')}`

      // B tries to GET A's project
      const r = await fetch(`${APP_URL}/api/projects/${userActx.projectId}`, {
        headers: { cookie: bCookie },
      })
      check('T6-RLS-01', "User B cannot read User A's project (404 RLS-hidden)",
        r.status === 404, `got ${r.status}`)

      // B tries to GET A's document
      const r2 = await fetch(`${APP_URL}/api/documents/${userActx.documentId}`, {
        headers: { cookie: bCookie },
      })
      check('T6-RLS-02', "User B cannot read User A's document (404 RLS-hidden)",
        r2.status === 404, `got ${r2.status}`)

      // B tries to GET A's tree
      const r3 = await fetch(`${APP_URL}/api/documents/${userActx.documentId}/nodes`, {
        headers: { cookie: bCookie },
      })
      check('T6-RLS-03', "User B cannot read User A's tree (404 / empty)",
        r3.status === 404 || (r3.status === 200 && (await r3.json()).nodes?.length === 0),
        `got ${r3.status}`)

      // B tries to PATCH A's node
      const r4 = await fetch(`${APP_URL}/api/nodes/${userActx.bookId}`, {
        method: 'PATCH',
        headers: { cookie: bCookie, 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'hacked' }),
      })
      check('T6-RLS-04', "User B cannot PATCH User A's node",
        r4.status === 404 || r4.status === 403, `got ${r4.status}`)

      // B tries to DELETE A's project
      const r5 = await fetch(`${APP_URL}/api/projects/${userActx.projectId}`, {
        method: 'DELETE',
        headers: { cookie: bCookie },
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

// ── TIER 3 — unusual but valid paths ───────────────────────────────────

async function tier3(api: Api): Promise<void> {
  console.log('\n=== TIER 3 — unusual but valid paths ===')

  // T3-RAPID-01: rename a node 5 times in 200ms — version stable, content_revision irrelevant
  {
    const ctx = await bootstrap(api)
    try {
      const before = await admin.from('nodes').select('version, content_revision').eq('id', ctx.bookId).single()
      const ops = ['a', 'b', 'c', 'd', 'e'].map((n) =>
        api.req('PATCH', `/api/nodes/${ctx.bookId}`, { name: `rapid-${n}` }),
      )
      const results = await Promise.all(ops)
      const allOk = results.every((r) => r.status >= 200 && r.status < 300)
      const after = await admin.from('nodes').select('version, content_revision').eq('id', ctx.bookId).single()
      // Renames don't bump version OR content_revision
      check('T3-RAPID-01a', '5 concurrent renames all succeed', allOk, results.map((r) => r.status).join(','))
      check('T3-RAPID-01b', 'version unchanged by renames', after.data!.version === before.data!.version, `${before.data!.version}→${after.data!.version}`)
      check('T3-RAPID-01c', 'content_revision unchanged by renames', after.data!.content_revision === before.data!.content_revision, `${before.data!.content_revision}→${after.data!.content_revision}`)
    } finally { await teardown(ctx.projectId) }
  }

  // T3-IDEM-01: PATCH same value twice in succession — second is no-op
  {
    const ctx = await bootstrap(api)
    try {
      await api.req('PATCH', `/api/nodes/${ctx.bookId}`, { summary: 'identical' })
      const mid = await admin.from('nodes').select('content_revision').eq('id', ctx.bookId).single()
      const r = await api.req('PATCH', `/api/nodes/${ctx.bookId}`, { summary: 'identical' })
      const after = await admin.from('nodes').select('content_revision').eq('id', ctx.bookId).single()
      check('T3-IDEM-01a', '2xx on no-op PATCH', r.status >= 200 && r.status < 300, `${r.status}`)
      check('T3-IDEM-01b', 'no-op PATCH does not bump content_revision', after.data!.content_revision === mid.data!.content_revision, `${mid.data!.content_revision}→${after.data!.content_revision}`)
    } finally { await teardown(ctx.projectId) }
  }

  // T3-DEL-RECREATE-01: delete then create with same name under same parent — succeeds
  {
    const ctx = await bootstrap(api)
    try {
      const a = await api.req('POST', `/api/documents/${ctx.documentId}/nodes`, { parent_id: ctx.actId, name: 'Same Name', node_type: 'chapter' })
      const id = (a.body as { node: { id: string } }).node.id
      const d = await api.req('DELETE', `/api/nodes/${id}`)
      check('T3-DEL-RECREATE-01a', 'delete original', d.status >= 200 && d.status < 300, `${d.status}`)
      const b = await api.req('POST', `/api/documents/${ctx.documentId}/nodes`, { parent_id: ctx.actId, name: 'Same Name', node_type: 'chapter' })
      check('T3-DEL-RECREATE-01b', 'create with same name after delete', b.status >= 200 && b.status < 300, `${b.status}`)
    } finally { await teardown(ctx.projectId) }
  }

  // T3-LOCK-UNLOCK-01: lock + unlock + edit — should work
  {
    const ctx = await bootstrap(api)
    try {
      await api.req('PATCH', `/api/nodes/${ctx.bookId}`, { locked: true, lock_reason: 'tmp' })
      await api.req('PATCH', `/api/nodes/${ctx.bookId}`, { locked: false, lock_reason: null })
      const r = await api.req('PATCH', `/api/nodes/${ctx.bookId}`, { summary: 'after unlock' })
      check('T3-LOCK-UNLOCK-01', 'edit succeeds after unlock', r.status >= 200 && r.status < 300, `${r.status}`)
    } finally { await teardown(ctx.projectId) }
  }

  // T3-MOVE-RETURN-01: move chapter, then move it back — final state matches initial
  {
    const ctx = await bootstrap(api)
    try {
      const act2 = await api.req('POST', `/api/documents/${ctx.documentId}/nodes`, { parent_id: ctx.bookId, name: 'A2', node_type: 'act' })
      const act2Id = (act2.body as { node: { id: string } }).node.id
      await api.req('PATCH', `/api/nodes/${ctx.chapterId}/move`, { parent_id: act2Id, position: 0 })
      await api.req('PATCH', `/api/nodes/${ctx.chapterId}/move`, { parent_id: ctx.actId, position: 0 })
      const { data } = await admin.from('nodes').select('parent_id').eq('id', ctx.chapterId).single()
      check('T3-MOVE-RETURN-01', 'chapter returned to original parent', data!.parent_id === ctx.actId, `parent=${data!.parent_id}`)
    } finally { await teardown(ctx.projectId) }
  }

  // T3-LINK-DELETE-01: delete context node WITHOUT force when it has
  // back-links → 409 with count (safeguard against accidental loss)
  {
    const ctx = await bootstrap(api)
    try {
      const c = await api.req('POST', `/api/projects/${ctx.projectId}/context-nodes`, { scope: 'project', node_type: 'character', name: 'C' })
      const cid = (c.body as { node: { id: string } }).node.id
      await api.req('POST', `/api/nodes/${ctx.bookId}/context-links`, { context_node_id: cid })
      const noForce = await api.req('DELETE', `/api/nodes/${cid}`)
      check('T3-LINK-DELETE-01a', 'delete context with back-links → 409', noForce.status === 409, `${noForce.status}`)
      // Force-delete + verify link cascaded
      const force = await api.req('DELETE', `/api/nodes/${cid}?force=true`)
      check('T3-LINK-DELETE-01b', 'force-delete context with back-links succeeds', force.status >= 200 && force.status < 300, `${force.status}`)
      const { data } = await admin.from('node_context_links').select('*').eq('source_node_id', ctx.bookId)
      check('T3-LINK-DELETE-01c', 'FK cascade removes link', (data ?? []).length === 0, `${(data ?? []).length} link(s) still present`)
    } finally { await teardown(ctx.projectId) }
  }
}

// ── TIER 5 — long-running / accumulation (novel scale) ─────────────────

async function tier5(api: Api): Promise<void> {
  console.log('\n=== TIER 5 — long-running / novel-scale ===')

  // T5-NOVEL-01: build a novel-scale tree (3 acts × 5 chapters × 4 scenes × 3 beats = 180 beats)
  // Verify list endpoint, tree fetch, count assertions, no orphans, no 5xx.
  {
    const ctx = await bootstrap(api)
    try {
      const t0 = Date.now()
      // Add 2 more acts (already have 1 from bootstrap)
      const acts = [ctx.actId]
      for (let i = 0; i < 2; i++) {
        const r = await api.req('POST', `/api/documents/${ctx.documentId}/nodes`, {
          parent_id: ctx.bookId, name: `Act ${i + 2}`, node_type: 'act',
        })
        if (r.status >= 400) throw new Error(`add act: ${r.status}`)
        acts.push((r.body as { node: { id: string } }).node.id)
      }

      // 5 chapters per act
      const chapters: string[] = []
      for (const actId of acts) {
        for (let c = 0; c < 5; c++) {
          const r = await api.req('POST', `/api/documents/${ctx.documentId}/nodes`, {
            parent_id: actId, name: `Ch${c + 1}`, node_type: 'chapter',
          })
          if (r.status >= 400) throw new Error(`add chapter: ${r.status}`)
          chapters.push((r.body as { node: { id: string } }).node.id)
        }
      }

      // 4 scenes per chapter
      const scenes: string[] = []
      for (const chId of chapters) {
        for (let s = 0; s < 4; s++) {
          const r = await api.req('POST', `/api/documents/${ctx.documentId}/nodes`, {
            parent_id: chId, name: `Sc${s + 1}`, node_type: 'scene',
          })
          if (r.status >= 400) throw new Error(`add scene: ${r.status}`)
          scenes.push((r.body as { node: { id: string } }).node.id)
        }
      }

      // 3 beats per scene
      const beats: string[] = []
      for (const scId of scenes) {
        for (let b = 0; b < 3; b++) {
          const r = await api.req('POST', `/api/documents/${ctx.documentId}/nodes`, {
            parent_id: scId, name: `B${b + 1}`, node_type: 'beat',
          })
          if (r.status >= 400) throw new Error(`add beat: ${r.status}`)
          beats.push((r.body as { node: { id: string } }).node.id)
        }
      }

      const elapsed = Date.now() - t0
      // Total: 1 root + 1 book + 3 acts (incl bootstrap) + 15 chapters + 60 scenes + 180 beats
      // = 260, plus the 2 from teardown chain
      const expectedTotal = 1 + 1 + 3 + 15 + 60 + 180
      const fetchT0 = Date.now()
      const tree = await api.req('GET', `/api/documents/${ctx.documentId}/nodes`)
      const fetchElapsed = Date.now() - fetchT0
      const treeBody = tree.body as { nodes: Array<unknown> }
      check('T5-NOVEL-01a', `built novel-scale tree (${beats.length} beats) in ${elapsed}ms`, beats.length === 180, `got ${beats.length}`)
      check('T5-NOVEL-01b', `tree fetch returns all ${expectedTotal} nodes in ${fetchElapsed}ms`, treeBody.nodes.length >= expectedTotal - 1, `got ${treeBody.nodes.length}`)
      check('T5-NOVEL-01c', `tree fetch < 5s for ${expectedTotal} nodes`, fetchElapsed < 5000, `${fetchElapsed}ms`)
      // Concurrent autosaves on 10 random beats
      const cT0 = Date.now()
      const writes = beats.slice(0, 10).map((id) =>
        api.req('PATCH', `/api/nodes/${id}`, { summary: `concurrent ${id.slice(0, 4)}` }),
      )
      const wResults = await Promise.all(writes)
      const wOk = wResults.every((r) => r.status >= 200 && r.status < 300)
      check('T5-NOVEL-01d', `10 concurrent autosaves in ${Date.now() - cT0}ms`, wOk, wResults.map((r) => r.status).join(','))
    } finally { await teardown(ctx.projectId) }
  }
}

// ── TIER 8 monkey via direct API calls (no Playwright) ─────────────────

async function tier8(api: Api): Promise<void> {
  console.log('\n=== TIER 8 — monkey (100 random ops) ===')

  function mulberry32(seed: number) {
    return () => {
      seed = (seed + 0x6d2b79f5) | 0
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
  }
  const rand = mulberry32(parseInt(process.env.MONKEY_SEED ?? '12345', 10))
  const pickFrom = <T>(a: T[]): T => a[Math.floor(rand() * a.length)]!

  const ctx = await bootstrap(api)
  try {
    const known = [ctx.bookId, ctx.actId, ctx.chapterId, ctx.sceneId, ctx.beatId]
    const knownCtx: string[] = []
    let unexpected = 0
    let serverErrors = 0
    const ITERATIONS = parseInt(process.env.MONKEY_ITERATIONS ?? '100', 10)
    const errorSamples: string[] = []

    for (let i = 0; i < ITERATIONS; i++) {
      const op = Math.floor(rand() * 8)
      let r: { status: number; body: unknown } | null = null
      try {
        switch (op) {
          case 0: { // create chapter
            r = await api.req('POST', `/api/documents/${ctx.documentId}/nodes`, {
              parent_id: ctx.actId, name: `m-${i}`, node_type: 'chapter',
            })
            if (r.status >= 200 && r.status < 300) known.push((r.body as { node: { id: string } }).node.id)
            break
          }
          case 1: { // rename
            const id = pickFrom(known)
            r = await api.req('PATCH', `/api/nodes/${id}`, { name: `mr-${i}` })
            break
          }
          case 2: { // edit summary
            const id = pickFrom(known)
            r = await api.req('PATCH', `/api/nodes/${id}`, { summary: `monkey ${i}` })
            break
          }
          case 3: { // status change
            const id = pickFrom(known)
            r = await api.req('PATCH', `/api/nodes/${id}`, { status: pickFrom(['draft', 'in_review', 'approved']) })
            break
          }
          case 4: { // toggle lock
            const id = pickFrom(known)
            r = await api.req('PATCH', `/api/nodes/${id}`, { locked: rand() < 0.5, lock_reason: 'monkey' })
            break
          }
          case 5: { // create context
            r = await api.req('POST', `/api/projects/${ctx.projectId}/context-nodes`, {
              scope: 'project',
              node_type: pickFrom(['character', 'location', 'organisation', 'theme', 'plot_thread', 'world']),
              name: `mc-${i}`,
            })
            if (r.status >= 200 && r.status < 300) knownCtx.push((r.body as { node: { id: string } }).node.id)
            break
          }
          case 6: { // link context
            if (knownCtx.length === 0) { i--; continue }
            const sId = pickFrom(known)
            const cId = pickFrom(knownCtx)
            r = await api.req('POST', `/api/nodes/${sId}/context-links`, { context_node_id: cId })
            break
          }
          case 7: { // fetch tree
            r = await api.req('GET', `/api/documents/${ctx.documentId}/nodes`)
            break
          }
        }
      } catch (e) {
        errorSamples.push(`step ${i} threw: ${e instanceof Error ? e.message : String(e)}`)
        unexpected++
        continue
      }
      if (r && r.status >= 500) {
        serverErrors++
        errorSamples.push(`step ${i} op${op}: ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`)
      }
      if (r && r.status >= 400 && r.status < 500 && r.status !== 409 && r.status !== 422 && r.status !== 423) {
        // Unexpected 4xx (not concurrency, not summary-required, not lock)
        unexpected++
        if (errorSamples.length < 5) errorSamples.push(`step ${i} op${op}: ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`)
      }
    }

    check('T8-MONKEY-01', `${ITERATIONS} monkey ops, no server errors`, serverErrors === 0, `${serverErrors} server errors: ${errorSamples.slice(0, 3).join(' | ')}`)
    // Unexpected 4xx is a soft signal — log but don't fail unless extreme
    if (unexpected > 0) console.log(`  ℹ ${unexpected} unexpected 4xx during monkey run (soft):`)
    for (const e of errorSamples.slice(0, 5)) console.log(`     ${e}`)

    // No orphans
    const { data: all } = await admin.from('nodes').select('id, parent_id').eq('project_id', ctx.projectId)
    const ids = new Set((all ?? []).map((n) => n.id))
    const orphans = (all ?? []).filter((n) => n.parent_id !== null && !ids.has(n.parent_id))
    check('T8-MONKEY-02', 'no orphaned nodes after monkey run', orphans.length === 0, `${orphans.length} orphans`)
  } finally { await teardown(ctx.projectId) }
}

// ── MAIN ───────────────────────────────────────────────────────────────

async function main() {
  const which = process.argv[2] ?? 'all'
  const session = await ensureUserAndSignIn()
  const api = new Api(session)

  if (which === 'tier1' || which === 'all') await tier1(api)
  if (which === 'tier2' || which === 'all') await tier2(api)
  if (which === 'tier3' || which === 'all') await tier3(api)
  if (which === 'tier4' || which === 'all') await tier4(api)
  if (which === 'tier5' || which === 'all') await tier5(api)
  if (which === 'tier6' || which === 'all') await tier6(api)
  if (which === 'tier8' || which === 'all') await tier8(api)

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
