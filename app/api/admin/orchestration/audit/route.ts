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

  return NextResponse.json({
    clean: violations.length === 0,
    total_violations: violations.length,
    by_invariant: byInvariant,
    by_entity: byEntity,
    violations,
    audited_at: new Date().toISOString(),
  })
}
