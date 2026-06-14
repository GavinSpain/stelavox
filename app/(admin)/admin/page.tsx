/**
 * /admin — V1.x-E platform-operator dashboard.
 *
 * Source: Component Spec §17.5 · wireframe_admin_dashboard_v1.html.
 *
 * Server component: enforces PLATFORM_ADMIN_EMAILS allowlist via
 * isPlatformAdmin() and redirects non-admins to the regular dashboard.
 * The client AdminDashboard component handles polling /api/admin/dashboard
 * + rendering all sections (live counters / queue / headroom /
 * dispatch sparkline / failures / spend / alerts / probes).
 */

import { redirect } from 'next/navigation'

import { AdminDashboard } from '@/components/admin/AdminDashboard'
import { isPlatformAdmin } from '@/lib/admin/isPlatformAdmin'
import { createClient } from '@/lib/supabase/server'

export default async function AdminPage() {
  const supabase = await createClient()
  const isAdmin = await isPlatformAdmin(supabase)
  if (!isAdmin) redirect('/dashboard')

  return <AdminDashboard />
}
