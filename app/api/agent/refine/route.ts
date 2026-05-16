// Spec: stelavox_phase5_api_contract_v1_0.md v1.2 §3.3 (POST /api/agent/refine)
//       stelavox_phase5_test_plan_v1_0.md TC-A-11..TC-A-15
//       stelavox_phase5_build_checklist_v1_0.md T-8.3

import { NextRequest } from 'next/server'

import {
  checkConcurrency,
  createJobAndDispatch,
  validateAgentInstruction,
  validateProfile,
} from '@/lib/api/agent-operation-helper'
import { err } from '@/lib/api/errors'
import { getDocumentMaxLayerIndex, getNode, decorateWithLeaf } from '@/lib/data/nodes'
import { extractPlainText } from '@/lib/llm/tiptap-text'
import { checkTokenBudget } from '@/lib/llm/token-budget'
import {
  hasHighSeverityMatch,
  logScanMatches,
  scanContent,
} from '@/lib/security/injection-scanner'
import { createClient } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/supabase/service'
import { refineBodySchema } from '@/lib/validation/agent-operations'
import { enforceWritable } from '@/lib/locking/enforceWritable'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return err.unauthorised()

  const ct = request.headers.get('content-type') ?? ''
  if (!ct.includes('application/json')) return err.invalidJson()

  let body: unknown
  try { body = await request.json() } catch { return err.invalidJson() }
  if (!body) return err.missingBody()

  const parsed = refineBodySchema.safeParse(body)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    if (issue?.code === 'unrecognized_keys') {
      const keys = (issue as { keys?: unknown[] }).keys
      return err.unknownField(String(keys?.[0] ?? ''))
    }
    if (issue?.path?.[0] === 'target_field') return err.invalidTargetField()
    if (issue?.path?.[0] === 'refinement_instruction') return err.invalidRefinementInstruction()
    if (issue?.path?.[0] === 'agent_instruction') return err.invalidAgentInstruction()
    return err.invalidUuid()
  }
  const data = parsed.data

  const { data: node } = await getNode(supabase, data.node_id)
  if (!node) return err.notFound()

  // Phase 6 D11: unified write-gate covers SU-J14-7 (Author Lock) +
  // Phase 6 D3 (no new agent work on a node already In-Flight or held
  // in an Edit Session by a different user). Replaces bespoke
  // node.locked check.
  const block = await enforceWritable(supabase, data.node_id, user.id)
  if (block) return block

  // target_field validation against node category/leaf-ness
  if (data.target_field === 'prose') {
    if (node.node_category !== 'structural') return err.invalidOperationForNodeType()
    const maxLayer = await getDocumentMaxLayerIndex(supabase, node.document_id ?? '')
    const decorated = decorateWithLeaf(node, maxLayer)
    if (!decorated.is_leaf) return err.notALeafNode()
  }

  // refine_empty_field: the field must have non-empty existing content
  const existingContent = data.target_field === 'summary'
    ? extractPlainText(node.summary)
    : data.target_field === 'prose'
      ? extractPlainText(node.prose)
      : extractPlainText(node.notes)
  if (!existingContent.trim()) return err.refineEmptyField()

  if (data.expected_version !== undefined && node.version !== data.expected_version) {
    return err.versionConflict(node, data.expected_version, node.version)
  }

  const profileResult = await validateProfile(supabase, 'refine', node.node_type, data.profile_id)
  if (profileResult instanceof Response) return profileResult
  const profile = profileResult

  // refinement_instruction injection scan
  const refScan = scanContent(data.refinement_instruction)
  logScanMatches(refScan, { fieldName: 'refinement_instruction', nodeId: node.id })
  if (hasHighSeverityMatch(refScan)) return err.injectionBlocked()

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
      target_field: data.target_field,
      refinement_instruction: data.refinement_instruction,
    },
  })
}
