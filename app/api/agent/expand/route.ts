// Spec: stelavox_phase5_api_contract_v1_0.md v1.2 §3.1 (POST /api/agent/expand)
//       stelavox_phase5_test_plan_v1_0.md TC-A-01..TC-A-06
//       stelavox_phase5_build_checklist_v1_0.md T-8.1

import { NextRequest } from 'next/server'

import {
  checkConcurrency,
  createJobAndDispatch,
  validateAgentInstruction,
  validateProfile,
} from '@/lib/api/agent-operation-helper'
import { err } from '@/lib/api/errors'
import { getDocumentMaxLayerIndex, getNode, decorateWithLeaf } from '@/lib/data/nodes'
import { checkTokenBudget } from '@/lib/llm/token-budget'
import { createClient } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/supabase/service'
import { expandBodySchema } from '@/lib/validation/agent-operations'

export async function POST(request: NextRequest) {
  // Auth
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return err.unauthorised()

  // Content-Type
  const ct = request.headers.get('content-type') ?? ''
  if (!ct.includes('application/json')) return err.invalidJson()

  // Body
  let body: unknown
  try { body = await request.json() } catch { return err.invalidJson() }
  if (!body) return err.missingBody()

  const parsed = expandBodySchema.safeParse(body)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    if (issue?.code === 'unrecognized_keys') {
      const keys = (issue as { keys?: unknown[] }).keys
      return err.unknownField(String(keys?.[0] ?? ''))
    }
    if (issue?.path?.[0] === 'agent_instruction') return err.invalidAgentInstruction()
    if (issue?.path?.[0] === 'target_layer_count') return err.invalidTargetLayerCount()
    return err.invalidUuid()
  }
  const data = parsed.data

  // Target node exists + visible
  const { data: node } = await getNode(supabase, data.node_id)
  if (!node) return err.notFound()

  // SU-J14-7 (round-3 hardening 2026-05-09): expand/synthesise/refine/
  // generate-context were silently accepting dispatch on locked nodes.
  // The Accept path would later 423, but the LLM call had already run
  // and the author saw an apparent success. Refuse at dispatch.
  if (node.locked) return err.nodeLocked()

  // Structural + non-leaf check
  if (node.node_category !== 'structural') return err.invalidOperationForNodeType()
  const maxLayer = await getDocumentMaxLayerIndex(supabase, node.document_id ?? '')
  const decorated = decorateWithLeaf(node, maxLayer)
  if (decorated.is_leaf) return err.invalidOperationForNodeType()

  // expected_version
  if (data.expected_version !== undefined && node.version !== data.expected_version) {
    return err.versionConflict(node, data.expected_version, node.version)
  }

  // Profile resolution
  const profileResult = await validateProfile(supabase, 'expand', node.node_type, data.profile_id)
  if (profileResult instanceof Response) return profileResult
  const profile = profileResult

  // agent_instruction scan
  const scanResult = validateAgentInstruction(data.agent_instruction, node.id)
  if (scanResult) return scanResult

  // Concurrency
  const concurrencyResult = await checkConcurrency(supabase, data.node_id)
  if (concurrencyResult) return concurrencyResult

  // Token budget gate (H-07)
  const orgId = node.organisation_id
  const svc = createServiceRoleClient()
  const { data: org } = await svc
    .from('organisations')
    .select('id, plan, current_period_start')
    .eq('id', orgId)
    .single()
  if (!org) return err.internal()
  const budgetOk = await checkTokenBudget(
    { id: org.id, plan: org.plan ?? 'trial', current_period_start: org.current_period_start },
    profile.max_tokens + 4096, // assembly headroom
    profile.model_id,
  )
  if (!budgetOk) return err.tokenBudgetExceeded()

  // Create job + dispatch
  return createJobAndDispatch({
    organisationId: orgId,
    nodeId: data.node_id,
    documentId: node.document_id,
    profile,
    triggeredBy: user.id,
    targetNodeVersion: node.version,
    dynamicContext: {
      agent_instruction: data.agent_instruction ?? '',
      target_layer_count: data.target_layer_count,
    },
  })
}
