// Phase 8.5b B.1 — Document rollup endpoint.
//
// GET /api/documents/[documentId]/rollup
// Returns one DocumentRollup row computed by the Postgres RPC
// `get_document_rollup` (M-212). Replaces the TS-side row-sum patterns
// that hit the PostgREST 1000-row cap.
//
// Refs: docs/stelavox_document_load_architecture_v1_0.md §2.3
//       docs/stelavox_phase8_5b_build_checklist_v1_0.md §1 work item 7
//       lib/queries/rollups.ts

import { NextRequest, NextResponse } from 'next/server'

import { createClient } from '@/lib/supabase/server'
import { err } from '@/lib/api/errors'
import { isValidUuid } from '@/lib/validation/uuid'
import { getDocumentRollup } from '@/lib/queries/rollups'

interface Context {
  params: Promise<{ documentId: string }>
}

export async function GET(_request: NextRequest, { params }: Context) {
  try {
    const { documentId } = await params
    if (!isValidUuid(documentId)) return err.invalidUuid()

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return err.unauthorised()

    // The RPC itself handles RLS — a cross-org call returns zeros. We
    // don't 404 here because the rollup-of-nothing is a meaningful zero
    // response, not an error. The dashboard / document-header callers
    // render zero just fine.
    const rollup = await getDocumentRollup(supabase, documentId)
    return NextResponse.json(rollup)
  } catch {
    return err.internal()
  }
}
