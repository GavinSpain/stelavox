// Spec: stelavox_phase5_api_contract_v1_0.md v1.2 §3.7 (POST accept — transactional)
//       stelavox_phase5_test_plan_v1_0.md TC-A-21..TC-A-27
//       stelavox_phase5_build_checklist_v1_0.md T-9.3
//
// Calls Migration 029's accept_agent_job() RPC, which performs the atomic
// transaction (FOR UPDATE on target node, version check, node_versions
// snapshot, target update + child node inserts, agent_jobs.status='accepted').
// Plain-text → Tiptap conversion happens in this route via plainTextToTiptap()
// before the RPC call — keeping the converter in TypeScript and the DB
// operations atomic per G-9.

import { NextRequest, NextResponse } from 'next/server'

import { plainTextToTiptap } from '@/lib/agent/prose-to-tiptap'
import { err } from '@/lib/api/errors'
import { createClient } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/supabase/service'
import { isValidUuid } from '@/lib/validation/uuid'

interface Context { params: Promise<{ jobId: string }> }

interface ChildNodeProposal {
  name?: string
  short_description?: string
  summary?: string
  metadata?: Record<string, unknown>
  word_count_target?: number
  position?: number
}

export async function POST(_request: NextRequest, { params }: Context) {
  const { jobId } = await params
  if (!isValidUuid(jobId)) return err.invalidUuid()

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return err.unauthorised()

  // Read job to check current state and pull result_*
  const { data: job } = await supabase
    .from('agent_jobs')
    .select('id, status, operation_type, result_summary, result_prose, result_notes, result_metadata, result_child_nodes')
    .eq('id', jobId)
    .maybeSingle()
  if (!job) return err.notFound()

  // Idempotent on already-accepted
  if (job.status === 'accepted') {
    const { data } = await supabase.from('agent_jobs').select('*').eq('id', jobId).single()
    return NextResponse.json({
      agent_job: data,
      applied: { node_id: null, new_version: null, child_nodes_created: [] },
    })
  }

  if (job.status !== 'completed') {
    return err.agentJobAlreadyTerminal(job.status)
  }

  // Convert plain-text result_* to Tiptap JSON strings (G-9)
  const tiptapSummary = job.result_summary
    ? JSON.stringify(plainTextToTiptap(job.result_summary))
    : null
  const tiptapProse = job.result_prose
    ? JSON.stringify(plainTextToTiptap(job.result_prose))
    : null
  const tiptapNotes = job.result_notes
    ? JSON.stringify(plainTextToTiptap(job.result_notes))
    : null

  // For expand: pre-convert each child node's summary to Tiptap JSON string
  let childNodesForRpc: unknown[] | null = null
  if (job.operation_type === 'expand' && Array.isArray(job.result_child_nodes)) {
    childNodesForRpc = (job.result_child_nodes as ChildNodeProposal[]).map((child) => ({
      name: child.name ?? null,
      short_description: child.short_description ?? '',
      summary: child.summary ? JSON.stringify(plainTextToTiptap(child.summary)) : null,
      metadata: child.metadata ?? {},
      word_count_target: child.word_count_target ?? null,
      position: child.position,
    }))
  }

  // Call the RPC via service-role (the procedure is SECURITY DEFINER)
  const svc = createServiceRoleClient()
  const { data: rpcResult, error: rpcErr } = await svc.rpc('accept_agent_job', {
    p_job_id: jobId,
    p_actor_id: user.id,
    p_target_summary: tiptapSummary,
    p_target_prose: tiptapProse,
    p_target_notes: tiptapNotes,
    p_target_metadata: job.result_metadata ?? null,
    p_child_nodes: childNodesForRpc ? JSON.stringify(childNodesForRpc) : null,
  })

  if (rpcErr) {
    const msg = rpcErr.message ?? ''
    if (msg.includes('target_version_mismatch')) {
      // Format: target_version_mismatch:<current>:<captured>
      const match = msg.match(/target_version_mismatch:(\d+):(\d+)/)
      const current = match ? parseInt(match[1], 10) : 0
      const captured = match ? parseInt(match[2], 10) : 0
      return err.targetVersionMismatch(current, captured)
    }
    if (msg.includes('agent_job_already_terminal')) {
      const m = msg.match(/agent_job_already_terminal:(\w+)/)
      return err.agentJobAlreadyTerminal(m?.[1] ?? 'unknown')
    }
    if (msg.includes('agent_job_not_found') || msg.includes('target_node_not_found')) {
      return err.notFound()
    }
    console.error('[agent-jobs accept] RPC error', rpcErr)
    return err.internal()
  }

  // Result shape: array of { out_node_id, out_new_version, out_child_node_ids }
  const r = Array.isArray(rpcResult) ? rpcResult[0] : rpcResult
  const { data: updatedJob } = await supabase
    .from('agent_jobs')
    .select('*')
    .eq('id', jobId)
    .single()

  return NextResponse.json({
    agent_job: updatedJob,
    applied: {
      node_id: r?.out_node_id ?? null,
      new_version: r?.out_new_version ?? null,
      child_nodes_created: r?.out_child_node_ids ?? [],
    },
  })
}
