/**
 * Phase 5 T-7 + T-8 smoke test.
 *
 * Bootstraps a minimal fixture (user → org → project → document → book → chapter),
 * inserts an agent_jobs row directly via service-role, invokes runAgentJob(),
 * waits for completion, and prints the resulting cost + token counts +
 * result_child_nodes preview.
 *
 * Run with:
 *   npx tsx scripts/smoke-agent-runner.ts
 *
 * Requires .env.local with ANTHROPIC_API_KEY + Supabase keys + canary token.
 */

import { config } from 'dotenv'
config({ path: '.env.local' })

import { createClient } from '@supabase/supabase-js'
import { runAgentJob } from '../lib/agent/runner'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

async function main() {
  console.log('=== Phase 5 Agent Runner Smoke Test ===\n')

  // Verify env
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY missing from .env.local')
    process.exit(1)
  }
  if (!process.env.PROMPT_CANARY_TOKEN) {
    console.error('PROMPT_CANARY_TOKEN missing from .env.local')
    process.exit(1)
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  // ── Bootstrap fixture ─────────────────────────────────────────────────
  console.log('1. Bootstrapping fixture user + org + project + document + nodes...')

  const { data: authUser, error: authErr } = await supabase.auth.admin.createUser({
    email: `smoke-${Date.now()}@example.com`,
    password: 'smoke-password-123',
    email_confirm: true,
  })
  if (authErr || !authUser.user) throw new Error(`createUser failed: ${authErr?.message}`)
  const userId = authUser.user.id
  console.log(`   user: ${userId}`)

  // The handle_new_user trigger (Migration 002) creates org + membership.
  await new Promise((r) => setTimeout(r, 500))
  const { data: membership } = await supabase
    .from('organisation_members')
    .select('organisation_id')
    .eq('user_id', userId)
    .single()
  if (!membership) throw new Error('membership not auto-created')
  const orgId = membership.organisation_id
  console.log(`   org:  ${orgId}`)

  // Create project
  const { data: project, error: projErr } = await supabase
    .from('projects')
    .insert({ organisation_id: orgId, name: 'Smoke Project', default_document_type: 'novel' })
    .select('id').single()
  if (projErr || !project) throw new Error(`project create: ${projErr?.message}`)
  console.log(`   project: ${project.id}`)

  // Create document via the RPC (handles layer_stack + root node).
  // F-253 (round-3 audit): pre-fix called this with `p_title`,
  // `p_root_node_name`, `p_root_node_summary` — none of which exist on
  // the RPC. The actual signature is documented in Migrations
  // 015/017/018/020: p_project_id / p_organisation_id / p_name /
  // p_description / p_document_type / p_authors. Returns a JSONB
  // object with `document.id`, `layer_stack.id`, and `root_node.id`.
  const { data: docResult, error: docErr } = await supabase.rpc(
    'create_document_with_layer_stack',
    {
      p_project_id: project.id,
      p_organisation_id: orgId,
      p_name: 'Smoke Novel',
      p_description: 'A disgraced magistrate\'s daughter, exiled to the northern coast, discovers her father\'s old ledger and must decide whether to expose his complicity in a thirty-year-old shipwreck.',
      p_document_type: 'novel',
      p_authors: [],
    },
  )
  if (docErr || !docResult) throw new Error(`document create: ${docErr?.message}`)
  const r = docResult as unknown as {
    document?: { id: string }
    root_node?: { id: string }
  }
  const documentId = r.document?.id
  const bookNodeId = r.root_node?.id
  if (!documentId || !bookNodeId) throw new Error(`document RPC missing IDs: ${JSON.stringify(r)}`)
  console.log(`   document: ${documentId}`)
  console.log(`   book node: ${bookNodeId}`)

  // ── Insert an expand_book_into_acts agent_jobs row ───────────────────
  console.log('\n2. Loading expand_book_into_acts profile...')
  const { data: profile, error: profErr } = await supabase
    .from('agent_profiles')
    .select('id, model_id')
    .eq('name', 'expand_book_into_acts')
    .single()
  if (profErr || !profile) throw new Error(`profile load: ${profErr?.message}`)
  console.log(`   profile: ${profile.id} (model: ${profile.model_id})`)

  console.log('\n3. Inserting agent_jobs row (status=pending)...')
  const { data: bookNode } = await supabase
    .from('nodes')
    .select('version')
    .eq('id', bookNodeId)
    .single()
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
  console.log(`   job: ${job.id}`)

  // ── Invoke runAgentJob ─────────────────────────────────────────────────
  console.log('\n4. Invoking runAgentJob() — this will call the LLM...')
  const startedAt = Date.now()
  await runAgentJob(job.id)
  const elapsedMs = Date.now() - startedAt
  console.log(`   completed in ${elapsedMs}ms`)

  // ── Read result ────────────────────────────────────────────────────────
  console.log('\n5. Reading agent_jobs result...')
  const { data: finalJob } = await supabase
    .from('agent_jobs')
    .select('status, model_id, provider, tokens_input, tokens_output, tokens_cache_write, tokens_cache_read, cost_usd, result_child_nodes, error_message')
    .eq('id', job.id)
    .single()
  if (!finalJob) throw new Error('final job read failed')

  console.log(`   status:        ${finalJob.status}`)
  console.log(`   model:         ${finalJob.model_id}`)
  console.log(`   provider:      ${finalJob.provider}`)
  console.log(`   tokens_input:  ${finalJob.tokens_input}`)
  console.log(`   tokens_output: ${finalJob.tokens_output}`)
  console.log(`   cache_write:   ${finalJob.tokens_cache_write}`)
  console.log(`   cache_read:    ${finalJob.tokens_cache_read}`)
  console.log(`   cost_usd:      $${finalJob.cost_usd}`)
  if (finalJob.error_message) {
    console.log(`   error:         ${finalJob.error_message}`)
  }
  if (finalJob.result_child_nodes) {
    const arr = finalJob.result_child_nodes as Array<{ name?: string; short_description?: string; position: number }>
    console.log(`\n   result_child_nodes (${arr.length} acts proposed):`)
    arr.forEach((act) => {
      console.log(`     [${act.position}] ${act.name ?? '(unnamed)'} — ${act.short_description ?? ''}`)
    })
  }

  // Cleanup
  console.log('\n6. Cleanup (deleting fixture)...')
  await supabase.auth.admin.deleteUser(userId)
  console.log('   done.\n')

  if (finalJob.status === 'completed') {
    console.log('=== SMOKE PASSED ===')
    process.exit(0)
  } else {
    console.log('=== SMOKE FAILED ===')
    process.exit(1)
  }
}

main().catch((err) => {
  console.error('SMOKE ERROR:', err)
  process.exit(1)
})
