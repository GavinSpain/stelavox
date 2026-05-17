/**
 * Phase 7 — PATCH/DELETE /api/export-profiles/[id]
 *
 * Built-in profiles are immutable (M-160 RPCs reject is_builtin=TRUE).
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { err } from '@/lib/api/errors'
import { isValidUuid } from '@/lib/validation/uuid'
import { updateExportProfile, deleteExportProfile } from '@/lib/export/profiles'
import type { ProfileConfig } from '@/lib/export/types'

interface Context { params: Promise<{ profileId: string }> }

const profilePatchSchema = z.object({
  name: z.string().min(1).max(200),
  config: z.record(z.string(), z.unknown()),
}).strict()

export async function PATCH(request: NextRequest, { params }: Context) {
  try {
    const { profileId } = await params
    if (!isValidUuid(profileId)) return err.invalidUuid()

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return err.unauthorised()

    const ct = request.headers.get('content-type') ?? ''
    if (!ct.includes('application/json')) return err.invalidJson()

    let body: unknown
    try { body = await request.json() } catch { return err.invalidJson() }
    const parsed = profilePatchSchema.safeParse(body)
    if (!parsed.success) return err.invalidJson()

    try {
      await updateExportProfile(supabase, {
        id: profileId,
        name: parsed.data.name,
        config: parsed.data.config as unknown as ProfileConfig,
      })
      return NextResponse.json({ ok: true })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (msg.startsWith('forbidden:')) {
        return NextResponse.json(
          { error: 'forbidden', message: msg },
          { status: 403 },
        )
      }
      if (msg.startsWith('not_found:')) return err.notFound()
      return err.internal()
    }
  } catch {
    return err.internal()
  }
}

export async function DELETE(_request: NextRequest, { params }: Context) {
  try {
    const { profileId } = await params
    if (!isValidUuid(profileId)) return err.invalidUuid()

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return err.unauthorised()

    try {
      await deleteExportProfile(supabase, profileId)
      return NextResponse.json({ ok: true })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (msg.startsWith('forbidden:')) {
        return NextResponse.json(
          { error: 'forbidden', message: msg },
          { status: 403 },
        )
      }
      if (msg.startsWith('not_found:')) return err.notFound()
      return err.internal()
    }
  } catch {
    return err.internal()
  }
}
