/**
 * /admin/orchestration — Apollo state-machine observability.
 *
 * Source: docs/stelavox_brief_orchestration_v1_0.md §13.2.
 *
 * Server component: enforces PLATFORM_ADMIN_EMAILS allowlist. The
 * client OrchestrationAudit component polls the three orchestration
 * admin routes (audit / reconcile / force-reset).
 */

import { redirect } from 'next/navigation'

import { OrchestrationAudit } from '@/components/admin/OrchestrationAudit'
import { isPlatformAdmin } from '@/lib/admin/isPlatformAdmin'
import { createClient } from '@/lib/supabase/server'

export default async function OrchestrationAuditPage() {
  const supabase = await createClient()
  const isAdmin = await isPlatformAdmin(supabase)
  if (!isAdmin) redirect('/dashboard')

  return <OrchestrationAudit />
}
