/**
 * /admin/models — Model Governance (P1).
 *
 * Server component: enforces the PLATFORM_ADMIN_EMAILS allowlist (the
 * (admin) layout also gates, but each admin page re-checks per the
 * established pattern). The client AdminModels component manages the
 * registry + assignments via /api/admin/models.
 */

import { redirect } from 'next/navigation'

import { AdminModels } from '@/components/admin/AdminModels'
import { isPlatformAdmin } from '@/lib/admin/isPlatformAdmin'
import { createClient } from '@/lib/supabase/server'

export default async function AdminModelsPage() {
  const supabase = await createClient()
  if (!(await isPlatformAdmin(supabase))) redirect('/dashboard')
  return <AdminModels />
}
