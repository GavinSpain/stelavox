// One-shot character generate retry — for T-15 debugging only.

import { NextResponse } from 'next/server'
import { runAgentJob } from '@/lib/agent/runner'
import { createServiceRoleClient } from '@/lib/supabase/service'

export async function POST() {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'not_in_production' }, { status: 403 })
  }
  const supabase = createServiceRoleClient()

  // Find the most recent empty character context node
  const { data: char } = await supabase
    .from('nodes')
    .select('id, organisation_id, project_id, document_id, version')
    .eq('node_category', 'context')
    .eq('node_type', 'character')
    .eq('name', 'Empty character for review')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!char) return NextResponse.json({ error: 'no character found' }, { status: 404 })

  const { data: profile } = await supabase
    .from('agent_profiles')
    .select('id').eq('name', 'generate_context_character').single()

  const { data: users } = await supabase.auth.admin.listUsers()
  const user = users.users.find((u) => u.email === 'test@stelavox.local')!

  const { data: job } = await supabase
    .from('agent_jobs')
    .insert({
      organisation_id: char.organisation_id,
      node_id: char.id,
      document_id: char.document_id,
      profile_id: profile!.id,
      operation_type: 'generate_context',
      operation_class: 'single_node',
      status: 'pending',
      triggered_by: user.id,
      target_node_version_at_capture: char.version,
      context_snapshot: { dynamic: { agent_instruction: '' } },
    })
    .select('id').single()

  await runAgentJob(job!.id)

  const { data: finalJob } = await supabase
    .from('agent_jobs')
    .select('status, result_summary, result_metadata, error_message, tokens_input, tokens_output, cost_usd')
    .eq('id', job!.id).single()

  return NextResponse.json({ job_id: job!.id, ...finalJob })
}
