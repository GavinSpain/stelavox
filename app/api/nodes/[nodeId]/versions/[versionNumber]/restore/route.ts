/**
 * Phase 6.C — POST /api/nodes/[id]/versions/[v]/restore
 *
 * Body: { expected_version: number }
 *
 * Calls restore_node_version RPC. Maps the RPC's discriminated result
 * to HTTP status codes:
 *   ok → 200 with { restored: true, new_version, restored_from }
 *   error='version_conflict' → 409 with { current_version, ... }
 *   error='version_not_found' → 404
 *   error='not_found' → 404
 *   error='author_locked' | 'node_in_use' | 'node_in_progress' → 423
 *   other → 500
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { err } from '@/lib/api/errors'
import { isValidUuid } from '@/lib/validation/uuid'
import { z } from 'zod'
import { restoreNodeVersion } from '@/lib/versioning/restore'

interface Context { params: Promise<{ nodeId: string; versionNumber: string }> }

const restoreSchema = z.object({
  expected_version: z.number().int().min(1),
}).strict()

export async function POST(request: NextRequest, { params }: Context) {
  try {
    const { nodeId, versionNumber } = await params
    if (!isValidUuid(nodeId)) return err.invalidUuid()

    const targetVersion = Number.parseInt(versionNumber, 10)
    if (!Number.isFinite(targetVersion) || targetVersion < 1) {
      return err.invalidVersionNumber()
    }

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return err.unauthorised()

    const ct = request.headers.get('content-type') ?? ''
    if (!ct.includes('application/json')) return err.invalidJson()

    let body: unknown
    try { body = await request.json() } catch { return err.invalidJson() }
    if (!body) return err.missingBody()

    const parsed = restoreSchema.safeParse(body)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      if (issue?.path?.[0] === 'expected_version') return err.invalidExpectedVersion()
      return err.invalidJson()
    }

    const result = await restoreNodeVersion(supabase, {
      nodeId,
      targetVersion,
      expectedVersion: parsed.data.expected_version,
    })

    if (result.ok) {
      return NextResponse.json({
        restored: true,
        new_version: result.newVersion,
        restored_from: result.restoredFrom,
      })
    }

    switch (result.error) {
      case 'version_conflict':
        return NextResponse.json(
          { error: 'version_conflict', details: result.details },
          { status: 409 },
        )
      case 'version_not_found':
        return err.versionNotFound()
      case 'not_found':
        return err.notFound()
      case 'author_locked':
        return err.nodeLocked(result.details)
      case 'node_in_use':
        return err.nodeInUse(result.details)
      case 'node_in_progress':
        return err.nodeInProgress(result.details)
      default:
        return err.internal()
    }
  } catch {
    return err.internal()
  }
}
