// PHASE 5 SMOKE TEST ENDPOINT — DELETE BEFORE MERGE
//
// Bootstraps a minimal fixture, fires runAgentJob() inline, returns the
// result. Hit via:
//   curl -s http://localhost:3000/api/_smoke
//
// This route bypasses auth and uses service-role for the entire flow.
// It is gated by NODE_ENV !== 'production' to prevent accidental
// production exposure. It WILL be removed before Phase 5 merges.

import { NextResponse } from 'next/server'

import { runAgentJob } from '@/lib/agent/runner'
import { createServiceRoleClient } from '@/lib/supabase/service'

export const maxDuration = 120 // seconds — synthesise calls can take a while

export async function GET() {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'not_in_production' }, { status: 403 })
  }

  const supabase = createServiceRoleClient()
  const log: string[] = []

  try {
    // ─── Bootstrap fixture ─────────────────────────────────────────────
    log.push('1. Bootstrapping fixture user + org + project + document + nodes...')

    const { data: authUser, error: authErr } = await supabase.auth.admin.createUser({
      email: `smoke-${Date.now()}@example.com`,
      password: 'smoke-password-123',
      email_confirm: true,
    })
    if (authErr || !authUser.user) {
      throw new Error(`createUser failed: ${authErr?.message}`)
    }
    const userId = authUser.user.id
    log.push(`   user: ${userId}`)

    // The handle_new_user trigger creates org + membership.
    await new Promise((r) => setTimeout(r, 500))
    const { data: membership } = await supabase
      .from('organisation_members')
      .select('organisation_id')
      .eq('user_id', userId)
      .single()
    if (!membership) throw new Error('membership not auto-created')
    const orgId = membership.organisation_id
    log.push(`   org: ${orgId}`)

    const { data: project } = await supabase
      .from('projects')
      .insert({ organisation_id: orgId, name: 'Smoke Project', default_document_type: 'novel' })
      .select('id').single()
    if (!project) throw new Error('project create failed')
    log.push(`   project: ${project.id}`)

    const { data: docResult, error: docErr } = await supabase.rpc(
      'create_document_with_layer_stack',
      {
        p_project_id: project.id,
        p_organisation_id: orgId,
        p_name: 'Smoke Novel',
        p_description: '',
        p_document_type: 'novel',
        p_authors: [],
      },
    )
    if (docErr || !docResult) throw new Error(`document RPC: ${docErr?.message}`)
    const r = docResult as { document?: { id?: string }; root_node?: { id?: string } }
    const documentId = r.document?.id
    const bookNodeId = r.root_node?.id
    if (!documentId || !bookNodeId) {
      throw new Error(`RPC missing IDs: ${JSON.stringify(r)}`)
    }
    log.push(`   document: ${documentId}`)
    log.push(`   book node: ${bookNodeId}`)

    // Backfill the root node summary so the agent has substance to expand.
    const synopsis = JSON.stringify({
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [{
          type: 'text',
          text: "A disgraced magistrate's daughter, exiled to the northern coast, discovers her father's old ledger and must decide whether to expose his complicity in a thirty-year-old shipwreck. As she investigates, she finds the witnesses are dying — one by one — and the only people who know the truth are the ones who buried it. The book is a slow-burn moral thriller about whether justice that comes too late is justice at all.",
        }],
      }],
    })
    await supabase.from('nodes').update({
      name: 'The Northern Light',
      summary: synopsis,
    }).eq('id', bookNodeId)

    // ─── Find profile + insert job ────────────────────────────────────
    const { data: profile } = await supabase
      .from('agent_profiles')
      .select('id, model_id')
      .eq('name', 'expand_book_into_acts')
      .single()
    if (!profile) throw new Error('profile not found')
    log.push(`\n2. Profile: ${profile.id} (model: ${profile.model_id})`)

    const { data: bookNode } = await supabase
      .from('nodes').select('version').eq('id', bookNodeId).single()

    const { data: job, error: jobErr } = await supabase
      .from('agent_jobs')
      .insert({
        organisation_id: orgId,
        node_id: bookNodeId,
        document_id: documentId,
        profile_id: profile.id,
        operation_type: 'expand',
        operation_class: 'single_node',
        status: 'pending',
        triggered_by: userId,
        target_node_version_at_capture: bookNode?.version ?? 1,
        context_snapshot: { dynamic: { agent_instruction: '' } },
      })
      .select('id').single()
    if (jobErr || !job) throw new Error(`job insert: ${jobErr?.message}`)
    log.push(`3. Job inserted: ${job.id}`)

    // ─── Run synchronously (so we can return the result) ───────────────
    log.push('\n4. Calling runAgentJob() — invoking real LLM...')
    const startedAt = Date.now()
    await runAgentJob(job.id)
    const elapsedMs = Date.now() - startedAt
    log.push(`   completed in ${elapsedMs}ms`)

    // ─── Read result ──────────────────────────────────────────────────
    const { data: finalJob } = await supabase
      .from('agent_jobs')
      .select('status, model_id, provider, tokens_input, tokens_output, tokens_cache_write, tokens_cache_read, cost_usd, result_child_nodes, error_message')
      .eq('id', job.id)
      .single()

    // Cleanup
    await supabase.auth.admin.deleteUser(userId)

    return NextResponse.json({
      log,
      result: finalJob,
      elapsedMs,
    })
  } catch (err) {
    return NextResponse.json(
      { log, error: (err as Error).message, stack: (err as Error).stack },
      { status: 500 },
    )
  }
}
