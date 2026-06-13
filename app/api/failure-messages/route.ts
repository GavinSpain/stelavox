/**
 * GET /api/failure-messages — Phase 9.E (DR-020).
 *
 * Returns the failure-message template bundle (platform_config-backed)
 * so client surfaces (AgentTab, DirectorPanel, SchedulerPanel) can
 * render FailureToast / FailureBanner with the configured copy without
 * hardcoding templates client-side (H-12).
 *
 * Authenticated only — the templates aren't secret, but the endpoint
 * sits behind auth so anonymous callers can't poll platform_config.
 * Cached one hour at the edge; the templates change rarely (admin-only).
 */

import 'server-only'

import { NextResponse } from 'next/server'

import { getFailureMessageBundle } from '@/lib/ui/failureMessages'
import { createClient } from '@/lib/supabase/server'

export async function GET(): Promise<Response> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }

  const bundle = await getFailureMessageBundle()
  return NextResponse.json(bundle, {
    headers: { 'Cache-Control': 'private, max-age=3600' },
  })
}
