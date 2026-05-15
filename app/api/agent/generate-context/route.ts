// Spec: stelavox_phase5_api_contract_v1_0.md v1.2 §3.4 (POST /api/agent/generate-context)
//       stelavox_phase5_test_plan_v1_0.md TC-A-17..TC-A-20
//       stelavox_phase5_build_checklist_v1_0.md T-8.4

import { NextRequest } from 'next/server'

import {
  checkConcurrency,
  createJobAndDispatch,
  validateAgentInstruction,
  validateProfile,
} from '@/lib/api/agent-operation-helper'
import { err } from '@/lib/api/errors'
import { getNode } from '@/lib/data/nodes'
import { checkTokenBudget } from '@/lib/llm/token-budget'
import { createClient } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/supabase/service'
import { generateContextBodySchema } from '@/lib/validation/agent-operations'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return err.unauthorised()

  const ct = request.headers.get('content-type') ?? ''
  if (!ct.includes('application/json')) return err.invalidJson()

  let body: unknown
  try { body = await request.json() } catch { return err.invalidJson() }
  if (!body) return err.missingBody()

  const parsed = generateContextBodySchema.safeParse(body)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    if (issue?.code === 'unrecognized_keys') {
      const keys = (issue as { keys?: unknown[] }).keys
      return err.unknownField(String(keys?.[0] ?? ''))
    }
    if (issue?.path?.[0] === 'agent_instruction') return err.invalidAgentInstruction()
    return err.invalidUuid()
  }
  const data = parsed.data

  const { data: node } = await getNode(supabase, data.node_id)
  if (!node) return err.notFound()

  // SU-J14-7 (2026-05-09): refuse dispatch on locked node.
  if (node.locked) return err.nodeLocked()

  // generate_context: context node only
  if (node.node_category !== 'context') return err.invalidOperationForNodeType()

  if (data.expected_version !== undefined && node.version !== data.expected_version) {
    return err.versionConflict(node, data.expected_version, node.version)
  }

  const profileResult = await validateProfile(
    supabase,
    'generate_context',
    node.node_type,
    data.profile_id,
  )
  if (profileResult instanceof Response) return profileResult
  const profile = profileResult

  const scanResult = validateAgentInstruction(data.agent_instruction, node.id)
  if (scanResult) return scanResult

  const concurrencyResult = await checkConcurrency(supabase, data.node_id)
  if (concurrencyResult) return concurrencyResult

  const svc = createServiceRoleClient()
  const { data: org } = await svc
    .from('organisations')
    .select('id, plan, current_period_start')
    .eq('id', node.organisation_id)
    .single()
  if (!org) return err.internal()
  const budgetOk = await checkTokenBudget(
    { id: org.id, plan: org.plan ?? 'trial', current_period_start: org.current_period_start },
    profile.max_tokens + 4096,
    profile.model_id,
  )
  if (!budgetOk) return err.tokenBudgetExceeded()

  return createJobAndDispatch({
    organisationId: node.organisation_id,
    nodeId: data.node_id,
    documentId: node.document_id,
    profile,
    triggeredBy: user.id,
    targetNodeVersion: node.version,
    dynamicContext: {
      agent_instruction: data.agent_instruction ?? '',
    },
  })
}
