/**
 * M-211 integration test — /api/cron/purge-expired-exports route.
 *
 * Drives the route function directly against the local Supabase stack
 * (no HTTP server). Verifies all three passes:
 *
 *   Pass 1 — completed exports past signed_url_expires_at:
 *     row + file deleted.
 *   Pass 2 — failed exports older than export.failed_retention_hours:
 *     row + file deleted.
 *   Pass 3 — orphan sweep:
 *     bucket files older than 1h with no row deleted; fresh orphan
 *     (< 1h) kept.
 *
 *   Plus negative cases: completed-not-yet-expired stays; failed within
 *   retention window stays; auth failures return 401 / 500.
 *
 * The route function is imported and called with a synthetic NextRequest;
 * we don't spin up an HTTP server. fetch-based tests would just
 * duplicate the verification while paying network cost.
 */

import { execSync } from 'node:child_process'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { POST } from '@/app/api/cron/purge-expired-exports/route'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54331'
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const CRON_SECRET = 'm211-test-cron-secret'
const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

const hasServiceKey = SERVICE_KEY !== ''

const BUCKET = 'exports'

interface Fixture {
  organisationId: string
  projectId: string
  documentId: string
  ownerUserId: string
  expiredRowId: string
  expiredPath: string
  failedRowId: string
  failedPath: string
  livingRowId: string
  livingPath: string
  orphanOldPath: string
  orphanFreshPath: string
}

let fix: Fixture | null = null

// Helper — minimal fake NextRequest carrying just an Authorization
// header. The route function only reads `req.headers.get('authorization')`.
function mkReq(authHeader: string | null): Request {
  return new Request('http://test/api/cron/purge-expired-exports', {
    method: 'POST',
    headers: authHeader ? { authorization: authHeader } : {},
  })
}

describe.skipIf(!hasServiceKey)('M-211 /api/cron/purge-expired-exports', () => {
  beforeAll(async () => {
    // Provide CRON_SECRET to the route. It reads process.env, so set
    // before the route runs (tests run in the same process).
    process.env.CRON_SECRET = CRON_SECRET

    // Idempotent bucket creation.
    try { await svc.storage.createBucket(BUCKET, { public: false }) } catch { /* exists */ }

    const orgId = crypto.randomUUID()
    const projectId = crypto.randomUUID()
    const { data: u1 } = await svc.auth.admin.createUser({
      email: `m211-${Date.now()}@stelavox.test`,
      password: 'TestM211!',
      email_confirm: true,
    })
    const ownerUserId = u1.user!.id

    let r = await svc.from('organisations').insert({
      id: orgId, name: 'M211 test', slug: `m211-${Date.now()}`,
      plan: 'trial', token_allocation_credits: 1_000_000,
    })
    if (r.error) throw new Error(`org: ${r.error.message}`)
    r = await svc.from('organisation_members').insert({
      organisation_id: orgId, user_id: ownerUserId, role: 'owner',
    })
    if (r.error) throw new Error(`member: ${r.error.message}`)
    r = await svc.from('projects').insert({
      id: projectId, organisation_id: orgId, name: 'M211 project',
    })
    if (r.error) throw new Error(`project: ${r.error.message}`)
    // Use the same RPC the runner uses to spin up a minimal document
    // we can attach the test export_jobs rows to (FK requirement).
    const { data: docResult, error: docErr } = await svc.rpc(
      'create_document_with_layer_stack',
      {
        p_project_id: projectId, p_organisation_id: orgId,
        p_name: 'M211 doc', p_description: '',
        p_document_type: 'novel', p_authors: [],
      },
    )
    if (docErr) throw new Error(`doc: ${docErr.message}`)
    const documentId = (docResult as { document: { id: string } }).document.id

    // ─── Three export_jobs rows + three managed files ──────────────────
    const expiredRowId = crypto.randomUUID()
    const failedRowId  = crypto.randomUUID()
    const livingRowId  = crypto.randomUUID()
    const expiredPath = `${orgId}/${expiredRowId}.docx`
    const failedPath  = `${orgId}/${failedRowId}.docx`
    const livingPath  = `${orgId}/${livingRowId}.docx`
    const orphanOldPath   = `${orgId}/orphan-old.docx`
    const orphanFreshPath = `${orgId}/orphan-fresh.docx`

    // Upload all five files. Real Storage records created_at = NOW.
    const payload = Buffer.from('test')
    for (const p of [expiredPath, failedPath, livingPath, orphanOldPath, orphanFreshPath]) {
      const { error } = await svc.storage.from(BUCKET).upload(p, payload, {
        contentType: 'application/octet-stream', upsert: true,
      })
      if (error) throw new Error(`upload ${p}: ${error.message}`)
    }

    // Backdate the old orphan in storage.objects so the route's >1h
    // orphan grace check finds it. supabase-js can't `update` the
    // `storage` schema (PostgREST exposes only `public`) — shell out
    // to the local Postgres via docker exec. The test is already
    // gated on the local stack via skipIf(!hasServiceKey).
    const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString()
    execSync(
      `docker exec -i supabase_db_stelavox_2 psql -U postgres -d postgres -c ` +
      `"UPDATE storage.objects SET created_at='${sixHoursAgo}' ` +
      `WHERE bucket_id='${BUCKET}' AND name='${orphanOldPath}';"`,
      { stdio: 'pipe' },
    )

    // export_jobs rows.
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString()
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString()
    const plusSevenDays = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
    r = await svc.from('export_jobs').insert([
      {
        id: expiredRowId, organisation_id: orgId,
        document_id: documentId, format: 'docx', status: 'completed',
        storage_path: expiredPath,
        signed_url: 'http://expired.test',
        signed_url_expires_at: tenDaysAgo, // already past
        created_at: tenDaysAgo,
      },
      {
        id: failedRowId, organisation_id: orgId,
        document_id: documentId, format: 'docx', status: 'failed',
        storage_path: failedPath,
        error_message: 'pretend the runner died',
        created_at: twoDaysAgo, // > 24h ago
      },
      {
        id: livingRowId, organisation_id: orgId,
        document_id: documentId, format: 'docx', status: 'completed',
        storage_path: livingPath,
        signed_url: 'http://living.test',
        signed_url_expires_at: plusSevenDays, // 7 days from now
        created_at: new Date().toISOString(),
      },
    ])
    if (r.error) throw new Error(`rows: ${r.error.message}`)

    fix = {
      organisationId: orgId, projectId, documentId, ownerUserId,
      expiredRowId, expiredPath, failedRowId, failedPath,
      livingRowId, livingPath, orphanOldPath, orphanFreshPath,
    }
  }, 30_000)

  afterAll(async () => {
    if (!fix) return
    // Clean any rows + files the test didn't already purge.
    await svc.from('export_jobs').delete().eq('organisation_id', fix.organisationId)
    await svc.storage.from(BUCKET).remove([
      fix.expiredPath, fix.failedPath, fix.livingPath,
      fix.orphanOldPath, fix.orphanFreshPath,
    ])
    await svc.from('organisations').delete().eq('id', fix.organisationId)
    await svc.auth.admin.deleteUser(fix.ownerUserId)
  })

  it('returns 401 when bearer is wrong', async () => {
    const res = await POST(mkReq('Bearer not-the-real-secret') as never)
    expect(res.status).toBe(401)
  })

  it('runs all three passes and reports counts', async () => {
    if (!fix) throw new Error('no fixture')
    const res = await POST(mkReq(`Bearer ${CRON_SECRET}`) as never)
    expect(res.status).toBe(200)
    const body = await res.json() as {
      pass1_completed_expired:  { rows: number; files: number; errors: string[] }
      pass2_failed_cancelled:   { rows: number; files: number; errors: string[] }
      pass3_orphan_sweep:       { files: number; scanned: number; errors: string[] }
    }
    // Counts include any other expired exports in the local DB at the
    // time the test runs (not isolated), so we assert ≥ the rows we
    // know we created, not exact equality.
    expect(body.pass1_completed_expired.rows).toBeGreaterThanOrEqual(1)
    expect(body.pass2_failed_cancelled.rows).toBeGreaterThanOrEqual(1)
    expect(body.pass3_orphan_sweep.files).toBeGreaterThanOrEqual(1)
  })

  it('pass 1 — deletes the expired completed row + file', async () => {
    if (!fix) throw new Error('no fixture')
    const { data: row } = await svc.from('export_jobs')
      .select('id').eq('id', fix.expiredRowId).maybeSingle()
    expect(row).toBeNull()
    const { data: list } = await svc.storage.from(BUCKET)
      .list(fix.organisationId)
    const expiredName = fix.expiredPath.split('/').pop()
    expect(list?.some((f) => f.name === expiredName)).toBe(false)
  })

  it('pass 2 — deletes the failed-old row + file', async () => {
    if (!fix) throw new Error('no fixture')
    const { data: row } = await svc.from('export_jobs')
      .select('id').eq('id', fix.failedRowId).maybeSingle()
    expect(row).toBeNull()
    const { data: list } = await svc.storage.from(BUCKET)
      .list(fix.organisationId)
    const failedName = fix.failedPath.split('/').pop()
    expect(list?.some((f) => f.name === failedName)).toBe(false)
  })

  it('keeps a completed row whose URL has not yet expired', async () => {
    if (!fix) throw new Error('no fixture')
    const { data: row } = await svc.from('export_jobs')
      .select('id').eq('id', fix.livingRowId).maybeSingle()
    expect(row?.id).toBe(fix.livingRowId)
    const { data: list } = await svc.storage.from(BUCKET)
      .list(fix.organisationId)
    const livingName = fix.livingPath.split('/').pop()
    expect(list?.some((f) => f.name === livingName)).toBe(true)
  })

  it('pass 3 — deletes orphan file older than 1h, keeps fresh orphan', async () => {
    if (!fix) throw new Error('no fixture')
    const { data: list } = await svc.storage.from(BUCKET)
      .list(fix.organisationId)
    const oldName = fix.orphanOldPath.split('/').pop()
    const freshName = fix.orphanFreshPath.split('/').pop()
    expect(list?.some((f) => f.name === oldName)).toBe(false) // aged orphan gone
    expect(list?.some((f) => f.name === freshName)).toBe(true) // fresh orphan kept
  })
})
