// Spec: stelavox_phase2_api_contract_v1_0.md §3.6 (PATCH /move)
//       stelavox_phase2_test_plan_v1_0.md TC-A-75 to TC-A-94
//       stelavox_phase2_build_checklist_v1_0.md v1.1 §3.3 T-3.5
//
// Thin route — all the heavy lifting is in the move_node RPC (M-021).
// This handler only:
//   1. validates the path UUID and session;
//   2. parses the body via nodeMoveSchema;
//   3. calls the RPC;
//   4. maps the RPC's token-prefixed error messages to HTTP status.
//
// move_node is SECURITY DEFINER, so RLS doesn't filter the moved-node
// SELECT. Cross-org callers reach the RPC's membership check and get a
// `forbidden:` error — which we surface as 404 (not 403) per the
// route-level boundary convention (don't leak existence). See TC-B-06.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { err } from '@/lib/api/errors'
import { isValidUuid } from '@/lib/validation/uuid'
import { nodeMoveSchema } from '@/lib/validation/nodes'

interface Context { params: Promise<{ nodeId: string }> }

export async function PATCH(request: NextRequest, { params }: Context) {
  try {
    const { nodeId } = await params
    if (!isValidUuid(nodeId)) return err.invalidUuid()

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return err.unauthorised()

    const contentType = request.headers.get('content-type') ?? ''
    if (!contentType.includes('application/json')) return err.invalidJson()

    let body: unknown
    try { body = await request.json() } catch { return err.invalidJson() }
    if (!body) return err.missingBody()

    const parsed = nodeMoveSchema.safeParse(body)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      if (issue?.code === 'unrecognized_keys') {
        const key = Array.isArray((issue as { keys?: unknown }).keys)
          ? String(((issue as { keys: unknown[] }).keys)[0] ?? '')
          : ''
        return err.unknownField(key)
      }
      const path0 = issue?.path[0]
      if (path0 === 'parent_id') {
        if (issue?.code === 'invalid_type') return err.missingParentId()
        return err.invalidUuid()
      }
      if (path0 === 'position') {
        // Per §3.6 failure modes, all position-shape issues collapse
        // to a single 400 invalid_position code.
        return err.invalidPosition()
      }
      return err.invalidPosition()
    }

    const { data: rpcResult, error: rpcError } = await supabase.rpc('move_node', {
      p_node_id:   nodeId,
      p_parent_id: parsed.data.parent_id,
      p_position:  parsed.data.position,
    })

    if (rpcError) {
      const msg = rpcError.message ?? ''
      // Order matters: more specific tokens first. The RPC raises
      // exceptions with `<token>: <detail>` messages — see M-021.
      if (msg.includes('not_found:'))         return err.notFound()
      if (msg.includes('forbidden:'))         return err.notFound()  // existence-leak guard
      if (msg.includes('cycle_detected:'))    return err.cycleDetected()
      if (msg.includes('layer_violation:'))   return err.layerViolation()
      if (msg.includes('invalid_position:'))  return err.invalidPosition()
      if (msg.includes('invalid_parent:'))    return err.invalidParent()
      if (msg.includes('node_locked:'))       return err.nodeLocked()
      if (msg.includes('parent_locked:'))     return err.parentLocked()
      return err.internal()
    }

    // The RPC returns JSONB { node, renumbered_count } per API Contract §3.6.
    return NextResponse.json(rpcResult)
  } catch {
    return err.internal()
  }
}
