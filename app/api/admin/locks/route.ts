/**
 * Phase 6.B — GET /api/admin/locks
 *
 * Lists all Author Locks across the authenticated user's
 * organisation(s). Powers the /settings/locks admin surface for
 * org owners (Phase 6 wireframe §08).
 *
 * RLS on node_author_locks restricts to org members. Owner role check
 * for force-unlock action lives in force_unlock RPC, not here.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { err } from '@/lib/api/errors'

export async function GET(_request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return err.unauthorised()

    // Inner join to nodes to surface name + node_type, and to
    // auth.users metadata for the locker's email (lightly).
    const { data, error } = await supabase
      .from('node_author_locks')
      .select(`
        node_id,
        organisation_id,
        locked_by_user_id,
        locked_at,
        lock_reason,
        bulk_operation_id,
        nodes!inner(name, node_type, document_id)
      `)
      .order('locked_at', { ascending: false })

    if (error) return err.internal()

    return NextResponse.json({ locks: data ?? [] })
  } catch {
    return err.internal()
  }
}
