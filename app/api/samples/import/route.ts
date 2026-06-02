// Phase 8.01.D T-9 — POST /api/samples/import
//
// Imports the small "Quiet Door" sample novel for the caller's org.
// Per OQ-3 lock: every invocation creates a new sample copy (suffix
// `(2)`, `(3)`, … as needed; lowest-available reused after delete).

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { importSampleNovel } from '@/lib/samples/sampleNovel'

export async function POST(): Promise<Response> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }
  const { data: membership } = await supabase
    .from('organisation_members')
    .select('organisation_id')
    .eq('user_id', user.id)
    .limit(1)
    .maybeSingle<{ organisation_id: string }>()
  if (!membership) {
    return NextResponse.json({ error: 'no_organisation' }, { status: 403 })
  }
  try {
    const result = await importSampleNovel(supabase, membership.organisation_id)
    return NextResponse.json(result, { status: 201 })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: 'import_failed', message: msg }, { status: 500 })
  }
}
