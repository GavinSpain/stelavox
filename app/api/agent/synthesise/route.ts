// Spec: stelavox_phase5_api_contract_v1_0.md v1.2 §3.2 (POST /api/agent/synthesise)
//       stelavox_phase5_test_plan_v1_0.md TC-A-07..TC-A-10
//       stelavox_phase5_build_checklist_v1_0.md T-8.2

import { NextRequest } from 'next/server'

import {
  checkConcurrency,
  checkSummaryNonEmpty,
  createJobAndDispatch,
  validateAgentInstruction,
  validateProfile,
} from '@/lib/api/agent-operation-helper'
import { err } from '@/lib/api/errors'
import { getDocumentMaxLayerIndex, getNode, decorateWithLeaf } from '@/lib/data/nodes'
import { checkTokenBudget } from '@/lib/llm/token-budget'
import { createClient } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/supabase/service'
import { synthesiseBodySchema } from '@/lib/validation/agent-operations'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return err.unauthorised()

  const ct = request.headers.get('content-type') ?? ''
  if (!ct.includes('application/json')) return err.invalidJson()

  let body: unknown
  try { body = await request.json() } catch { return err.invalidJson() }
  if (!body) return err.missingBody()

  const parsed = synthesiseBodySchema.safeParse(body)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    if (issue?.code === 'unrecognized_keys') {
      const keys = (issue as { keys?: unknown[] }).keys
      return err.unknownField(String(keys?.[0] ?? ''))
    }
    if (issue?.path?.[0] === 'prose_target_words') return err.invalidProseTargetWords()
    if (issue?.path?.[0] === 'agent_instruction') return err.invalidAgentInstruction()
    return err.invalidUuid()
  }
  const data = parsed.data

  const { data: node } = await getNode(supabase, data.node_id)
  if (!node) return err.notFound()

  // Synthesise: structural AND leaf only (H-15)
  if (node.node_category !== 'structural') return err.invalidOperationForNodeType()
  const maxLayer = await getDocumentMaxLayerIndex(supabase, node.document_id ?? '')
  const decorated = decorateWithLeaf(node, maxLayer)
  if (!decorated.is_leaf) return err.notALeafNode()

  // SU-J14-6: pre-flight summary check.
  const summaryGate = checkSummaryNonEmpty(node.summary)
  if (summaryGate) return summaryGate

  if (data.expected_version !== undefined && node.version !== data.expected_version) {
    return err.versionConflict(node, data.expected_version, node.version)
  }

  const profileResult = await validateProfile(supabase, 'synthesise', node.node_type, data.profile_id)
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
      prose_target_words: data.prose_target_words,
    },
  })
}
