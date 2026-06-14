/**
 * GET  /api/admin/orchestration/audit
 *
 * Apollo Phase 6 admin surface — returns the current output of
 * audit_orchestration_state(). Empty array = system is in a known
 * consistent state. Any row = drift; investigate via the entity_id
 * + violation message; repair via the entity's force-reset or
 * cancel_brief cascade.
 *
 * Source: docs/stelavox_brief_orchestration_v1_0.md §13.
 *
 * Auth: PLATFORM_ADMIN_EMAILS allowlist (same as /api/admin/dashboard).
 */

import 'server-only'

import { NextResponse, type NextRequest } from 'next/server'

import { isPlatformAdmin } from '@/lib/admin/isPlatformAdmin'
import { createClient } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest): Promise<Response> {
  const supabase = await createClient()
  const isAdmin = await isPlatformAdmin(supabase)
  if (!isAdmin) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const svc = createServiceRoleClient()
  const { data, error } = await svc.rpc('audit_orchestration_state')
  if (error) {
    return NextResponse.json({ error: 'audit_rpc_failed', message: error.message }, { status: 500 })
  }

  const violations = (data ?? []) as Array<{
    invariant_id: string
    entity_table: string
    entity_id: string
    violation: string
    details: unknown
  }>

  // Group for the UI.
  const byInvariant: Record<string, number> = {}
  const byEntity: Record<string, number> = {}
  for (const v of violations) {
    byInvariant[v.invariant_id] = (byInvariant[v.invariant_id] ?? 0) + 1
    byEntity[v.entity_table] = (byEntity[v.entity_table] ?? 0) + 1
  }

  // Issue #3 — enrich each violation with the flagged entity's timestamp
  // so the operator can tell current vs old-test residue. The audit RPC is
  // a live state scan and carries no timestamp. workflow_steps has no
  // created_at (only started_at); other tables use created_at.
  const TS_COL: Record<string, string> = {
    agent_jobs: 'created_at',
    workflows: 'created_at',
    briefs: 'created_at',
    brief_stages: 'created_at',
    director_turns: 'created_at',
    workflow_steps: 'started_at',
  }
  const idsByTable = new Map<string, Set<string>>()
  for (const v of violations) {
    if (!TS_COL[v.entity_table]) continue
    let set = idsByTable.get(v.entity_table)
    if (!set) { set = new Set(); idsByTable.set(v.entity_table, set) }
    set.add(v.entity_id)
  }
  const tsLookup = new Map<string, string | null>()
  await Promise.all(
    [...idsByTable.entries()].map(async ([table, ids]) => {
      const col = TS_COL[table]
      const { data: rows } = await svc
        .from(table as 'agent_jobs')   // dynamic table; cast for the typed client
        .select(`id, ${col}`)
        .in('id', [...ids])
      for (const r of (rows ?? []) as unknown as Array<Record<string, unknown>>) {
        tsLookup.set(`${table}:${String(r.id)}`, (r[col] as string | null) ?? null)
      }
    }),
  )
  const enriched = violations.map((v) => ({
    ...v,
    entity_ts: tsLookup.get(`${v.entity_table}:${v.entity_id}`) ?? null,
  }))

  return NextResponse.json({
    clean: violations.length === 0,
    total_violations: violations.length,
    by_invariant: byInvariant,
    by_entity: byEntity,
    violations: enriched,
    audited_at: new Date().toISOString(),
  })
}
