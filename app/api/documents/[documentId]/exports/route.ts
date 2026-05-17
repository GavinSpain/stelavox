/**
 * Phase 7 — GET /api/documents/[id]/exports
 *
 * Lists export history for a document. Powers ExportHistoryPanel.
 * RLS-gated by organisation_id on documents.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { err } from '@/lib/api/errors'
import { isValidUuid } from '@/lib/validation/uuid'

interface Context { params: Promise<{ documentId: string }> }

export async function GET(request: NextRequest, { params }: Context) {
  try {
    const { documentId } = await params
    if (!isValidUuid(documentId)) return err.invalidUuid()

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return err.unauthorised()

    const url = new URL(request.url)
    const limit = Math.min(Number.parseInt(url.searchParams.get('limit') ?? '50', 10), 200)

    const { data, error } = await supabase
      .from('export_jobs')
      .select(
        `id, format, profile_id, status, progress, signed_url, signed_url_expires_at,
         error_message, attempt_count, total_chapters, created_at, completed_at`,
      )
      .eq('document_id', documentId)
      .order('created_at', { ascending: false })
      .limit(limit)

    if (error) return err.internal()

    return NextResponse.json({ exports: data ?? [] })
  } catch {
    return err.internal()
  }
}
