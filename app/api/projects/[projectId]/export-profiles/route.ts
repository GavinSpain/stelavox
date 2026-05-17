/**
 * Phase 7 — GET/POST /api/projects/[id]/export-profiles
 *
 * GET — list profiles available for a project (built-in + author-saved).
 * POST — create new author-saved profile via save_export_profile RPC.
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { err } from '@/lib/api/errors'
import { isValidUuid } from '@/lib/validation/uuid'
import { listProfilesForProject, saveExportProfile } from '@/lib/export/profiles'
import type { ProfileConfig } from '@/lib/export/types'

interface Context { params: Promise<{ projectId: string }> }

const profilePostSchema = z.object({
  name: z.string().min(1).max(200),
  format: z.enum(['docx', 'epub', 'json', 'outline']),
  config: z.record(z.string(), z.unknown()),
}).strict()

export async function GET(_request: NextRequest, { params }: Context) {
  try {
    const { projectId } = await params
    if (!isValidUuid(projectId)) return err.invalidUuid()

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return err.unauthorised()

    const profiles = await listProfilesForProject(supabase, projectId)
    return NextResponse.json({ profiles })
  } catch {
    return err.internal()
  }
}

export async function POST(request: NextRequest, { params }: Context) {
  try {
    const { projectId } = await params
    if (!isValidUuid(projectId)) return err.invalidUuid()

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return err.unauthorised()

    const ct = request.headers.get('content-type') ?? ''
    if (!ct.includes('application/json')) return err.invalidJson()

    let body: unknown
    try { body = await request.json() } catch { return err.invalidJson() }
    if (!body) return err.missingBody()

    const parsed = profilePostSchema.safeParse(body)
    if (!parsed.success) return err.invalidJson()

    try {
      const result = await saveExportProfile(supabase, {
        projectId,
        name: parsed.data.name,
        format: parsed.data.format,
        config: parsed.data.config as unknown as ProfileConfig,
      })
      return NextResponse.json(result, { status: 201 })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (msg.startsWith('forbidden:')) return err.unauthorised()
      if (msg.startsWith('not_found:')) return err.notFound()
      return err.internal()
    }
  } catch {
    return err.internal()
  }
}
