/**
 * Admin route group layout — the self-contained operational interface.
 *
 * Detached from the (app) AppShell: no project/node panels, no app nav,
 * no trial-expiry / past-due gating (those are author concerns). Gates
 * on logged-in + isPlatformAdmin, then renders AdminShell (its own
 * left-rail navigation). See wireframe_admin_shell_v1.html.
 */

import { redirect } from 'next/navigation'

import { createClient } from '@/lib/supabase/server'
import { isPlatformAdmin } from '@/lib/admin/isPlatformAdmin'
import { AdminShell } from '@/components/admin/AdminShell'

export default async function AdminGroupLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  if (!(await isPlatformAdmin(supabase))) redirect('/login')

  return <AdminShell userEmail={user.email ?? ''}>{children}</AdminShell>
}
