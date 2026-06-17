/**
 * /admin/payments — Phase 9.B admin payments dashboard.
 *
 * Server component: enforces PLATFORM_ADMIN_EMAILS allowlist via
 * isPlatformAdmin() and redirects non-admins. Loads every read surface
 * via loadAdminPaymentsData() and hands to the client AdminPayments
 * component which handles tab state.
 */

import { redirect } from 'next/navigation'

import { AdminPayments } from '@/components/admin/AdminPayments'
import { isPlatformAdmin } from '@/lib/admin/isPlatformAdmin'
import { loadAdminPaymentsData } from '@/lib/admin/payments/data'
import { createClient } from '@/lib/supabase/server'

export default async function AdminPaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>
}) {
  const supabase = await createClient()
  const isAdmin = await isPlatformAdmin(supabase)
  if (!isAdmin) redirect('/dashboard')

  const data = await loadAdminPaymentsData()
  const params = await searchParams
  const initialTab = params.tab ?? 'configuration'

  return <AdminPayments data={data} initialTab={initialTab} />
}
