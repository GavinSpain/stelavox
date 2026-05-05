// Spec: stelavox_phase5_api_contract_v1_0.md v1.2 §3.15 (GET agent-profiles)
//       stelavox_phase5_test_plan_v1_0.md TC-A-54..TC-A-57
//       stelavox_phase5_build_checklist_v1_0.md T-10.6

import { NextRequest, NextResponse } from 'next/server'

import { err } from '@/lib/api/errors'
import { createClient } from '@/lib/supabase/server'

const VALID_OPERATION_TYPES = new Set([
  'expand', 'synthesise', 'refine', 'generate_context',
])
const VALID_OPERATION_CLASSES = new Set(['single_node', 'document_operation'])

// system_prompt and output_format_instructions are SERVER-ONLY (per §2.14
// notes) and excluded from the response. Same for context_rules and
// node_scope_definition — internal config not for UI consumption.
const PROFILE_SELECT = `
  id, organisation_id, name, description,
  operation_class, operation_type, node_type,
  model_id, temperature, max_tokens, is_system_profile
`.trim()

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return err.unauthorised()

  const sp = request.nextUrl.searchParams
  const operationType = sp.get('operation_type')
  const nodeType = sp.get('node_type')
  const operationClass = sp.get('operation_class') ?? 'single_node'

  if (operationType && !VALID_OPERATION_TYPES.has(operationType)) return err.invalidQuery()
  if (operationClass && !VALID_OPERATION_CLASSES.has(operationClass)) return err.invalidQuery()

  // RLS (Migration 025) admits system profiles + own-org profiles
  let query = supabase
    .from('agent_profiles')
    .select(PROFILE_SELECT, { count: 'exact' })
    .eq('operation_class', operationClass)

  if (operationType) query = query.eq('operation_type', operationType)
  if (nodeType) {
    // Match exact node_type OR cross-type (NULL)
    query = query.or(`node_type.eq.${nodeType},node_type.is.null`)
  }

  // Order: own-org first (organisation_id NOT NULL first), then alpha by name
  const { data, error, count } = await query
    .order('organisation_id', { ascending: false, nullsFirst: false })
    .order('name', { ascending: true })

  if (error) {
    console.error('[agent-profiles GET] error', error)
    return err.internal()
  }

  return NextResponse.json({ agent_profiles: data ?? [], total: count ?? 0 })
}
