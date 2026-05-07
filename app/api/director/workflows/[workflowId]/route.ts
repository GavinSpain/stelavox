/**
 * GET /api/director/workflows/[workflowId]
 *
 * Source: stelavox_phase5b_api_contract_v1_0.md §3.5.
 * Build Checklist: T-13.1.
 *
 * Returns full workflow + ordered steps.
 */

import 'server-only'

import { NextResponse, type NextRequest } from 'next/server'

import {
  apiError,
  formatWorkflowResponse,
  loadWorkflowWithSteps,
} from '@/lib/director/route-helpers'
import { createClient } from '@/lib/supabase/server'

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ workflowId: string }> },
): Promise<Response> {
  const { workflowId } = await context.params

  const userClient = await createClient()
  const {
    data: { user },
  } = await userClient.auth.getUser()
  if (!user) return apiError(401, 'unauthenticated')

  const result = await loadWorkflowWithSteps(userClient, workflowId)
  if (result instanceof NextResponse) return result

  return NextResponse.json(formatWorkflowResponse(result.workflow, result.steps))
}
