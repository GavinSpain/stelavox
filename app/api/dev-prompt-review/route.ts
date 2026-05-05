// DEV-ONLY T-15 prompt review harness.
//
// Bootstraps a fresh "Prompt Review" project with:
//   - 1 Novel document with book→act→chapter→scene→beat already populated
//     (gives refines existing content to refine, gives synthesise a beat
//      summary to read)
//   - 6 empty context nodes (one per V1 type) for generate-context tests
//
// Then runs all 18 V1 system profiles in sequence, captures each result,
// and writes a markdown report to test-reports/prompt-review-<ts>.md
//
// Per the user's T-15 model decision: stays on Haiku throughout. Total
// expected cost: ~$0.15-0.30 for all 18 operations.

import { NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { writeFile, mkdir } from 'fs/promises'
import { join } from 'path'

import { runAgentJob } from '@/lib/agent/runner'
import { plainTextToTiptap } from '@/lib/agent/prose-to-tiptap'
import { createServiceRoleClient } from '@/lib/supabase/service'

const TEST_EMAIL = 'test@stelavox.local'

const SYNOPSIS = "Eleanor Marsh, a disgraced magistrate's daughter exiled to the windswept northern coast, discovers her father's old ledger hidden beneath the floorboards of her grandmother's house. The ledger reads like an accountant's shopping list — until she realises the names match those of forty-three people who drowned in the wreck of the Aurelia thirty years ago. As Eleanor pulls at the thread, the witnesses begin to die: an old fisherman, a former harbour-master, a woman who had been a child of seven on the morning of the wreck. The deaths are too clean to be coincidence and too quiet to be murder. Eleanor must decide whether to expose what her father did, knowing that the people who buried the truth thirty years ago are still in this town, still listening, still capable of arranging an accident."

const ACT_SUMMARY = "Three years into her exile, Eleanor returns to the Mill House for her grandmother's funeral and decides — half from grief, half from spite — to stay. She finds the ledger by accident, hidden under a loose floorboard in her father's old study. The names mean nothing to her at first. She is more interested in the loneliness of the house, the way the wind never stops, the small unfriendly attentions of the village. The act ends when she recognises a name in the ledger from a memorial plaque in the harbour church: forty-three drowned, the wreck of the Aurelia, 1992."

const CHAPTER_SUMMARY = "Eleanor arrives in Kirkwall on the morning ferry and is met not by her cousin as arranged but by the village constable, a man she does not remember. The funeral is small. The vicar mispronounces her grandmother's name. Eleanor stands at the back, watching the village watch her watch them. She sleeps in the Mill House for the first time in three years and dreams of her father, not as he was but as the courtroom drawings made him: a sketch in profile, eyes already turned away."

const SCENE_SUMMARY = "Eleanor walks alone from the harbour church to the Mill House after the wake. The wind has come up. The lane is unlit. A man steps out of the hedge ahead of her, the constable from the morning, and asks if he might have a word about her grandmother's papers. He is too careful with his words. Eleanor, who has spent her professional life reading people, marks him as not police. Says yes. Says she'll have tea ready. He does not come."

const BEAT_SUMMARY = "Eleanor stops in the lane. The wind is the only sound. She watches the constable's back recede and waits for him to turn — and he does not. She reads this as a man who knows he should not have spoken to her at all. She continues walking to the Mill House, slower now, taking in the lights of the cottages on either side. Two of them have someone watching from the window. She does not look at them directly. She knows they will keep watching."

const BEAT_PROSE = "She stopped in the lane. The wind moved her coat against her legs and she let it. Behind her, the constable's footsteps fell softer and softer until they were just the sound of the gravel settling back. He did not turn. She had expected him to. A man who had said something he should not have would turn, just once, to see whether she had taken it the way he meant. He did not turn. She understood from this that he had not made a mistake, and that he was being watched too. She started walking again. The cottages on either side of the lane had lit windows. Two of them had figures behind the curtains. She did not look directly at either, but she counted them. She knew they would keep counting her."

const CONTEXT_TYPES = ['character', 'location', 'organisation', 'world', 'theme', 'plot_thread'] as const

function tiptap(text: string): string {
  return JSON.stringify({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  })
}

interface ReviewResult {
  step: number
  profile: string
  operation_type: string
  target_node: string
  status: string
  cost_usd: number | null
  tokens_input: number | null
  tokens_output: number | null
  result_preview: string
  error_message: string | null
  duration_seconds: number
}

export async function POST() {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'not_in_production' }, { status: 403 })
  }

  const supabase = createServiceRoleClient()

  // Find or create test user
  const { data: users } = await supabase.auth.admin.listUsers()
  let user = users.users.find((u) => u.email === TEST_EMAIL)
  if (!user) {
    const { data: created } = await supabase.auth.admin.createUser({
      email: TEST_EMAIL, password: 'test-password-123', email_confirm: true,
    })
    user = created.user!
    await new Promise((r) => setTimeout(r, 500))
  }

  const { data: membership } = await supabase
    .from('organisation_members')
    .select('organisation_id')
    .eq('user_id', user.id).single()
  const orgId = membership!.organisation_id

  // Ensure Haiku is set across the board
  await supabase
    .from('agent_profiles')
    .update({ model_id: 'claude-haiku-4-5-20251001' })
    .eq('is_system_profile', true)
  await supabase
    .from('platform_config')
    .update({ value: '"claude-haiku-4-5-20251001"' })
    .in('key', ['model.expand', 'model.synthesise', 'model.refine', 'model.generate_context'])

  // Create the prompt-review project
  const { data: project } = await supabase
    .from('projects')
    .insert({
      organisation_id: orgId,
      name: 'T-15 Prompt Review',
      default_document_type: 'novel',
    })
    .select('id').single()
  if (!project) return NextResponse.json({ error: 'project create failed' }, { status: 500 })

  // Create the document
  const { data: rpcRes, error: rpcErr } = await supabase.rpc(
    'create_document_with_layer_stack',
    {
      p_project_id: project.id, p_organisation_id: orgId,
      p_name: 'T-15 Sample Novel', p_description: '', p_document_type: 'novel', p_authors: [],
    },
  )
  if (rpcErr || !rpcRes) {
    return NextResponse.json({ error: `doc create: ${rpcErr?.message}` }, { status: 500 })
  }
  const r = rpcRes as { document?: { id?: string }; root_node?: { id?: string } }
  const documentId = r.document!.id!
  const bookNodeId = r.root_node!.id!

  // Populate the structural tree manually (so refines have content to refine)
  await supabase.from('nodes').update({
    name: 'The Northern Light', summary: tiptap(SYNOPSIS),
  }).eq('id', bookNodeId)

  const { data: act } = await supabase.from('nodes').insert({
    organisation_id: orgId, project_id: project.id, document_id: documentId,
    parent_id: bookNodeId, node_category: 'structural', node_type: 'act',
    layer_index: 1, depth: 1, order: 1,
    name: 'Act One: The Inheritance', summary: tiptap(ACT_SUMMARY),
    status: 'draft', version: 1,
  }).select('id').single()
  if (!act) return NextResponse.json({ error: 'act insert failed' }, { status: 500 })

  const { data: chapter } = await supabase.from('nodes').insert({
    organisation_id: orgId, project_id: project.id, document_id: documentId,
    parent_id: act.id, node_category: 'structural', node_type: 'chapter',
    layer_index: 2, depth: 2, order: 1,
    name: 'Chapter 1: The Funeral', summary: tiptap(CHAPTER_SUMMARY),
    status: 'draft', version: 1,
  }).select('id').single()
  if (!chapter) return NextResponse.json({ error: 'chapter insert failed' }, { status: 500 })

  const { data: scene } = await supabase.from('nodes').insert({
    organisation_id: orgId, project_id: project.id, document_id: documentId,
    parent_id: chapter.id, node_category: 'structural', node_type: 'scene',
    layer_index: 3, depth: 3, order: 1,
    name: 'Scene 1: The Lane', summary: tiptap(SCENE_SUMMARY),
    status: 'draft', version: 1,
  }).select('id').single()
  if (!scene) return NextResponse.json({ error: 'scene insert failed' }, { status: 500 })

  const { data: beat } = await supabase.from('nodes').insert({
    organisation_id: orgId, project_id: project.id, document_id: documentId,
    parent_id: scene.id, node_category: 'structural', node_type: 'beat',
    layer_index: 4, depth: 4, order: 1,
    name: 'Beat 1: The Pause', summary: tiptap(BEAT_SUMMARY), prose: tiptap(BEAT_PROSE),
    status: 'draft', version: 1,
  }).select('id').single()
  if (!beat) return NextResponse.json({ error: 'beat insert failed' }, { status: 500 })

  // Create one empty context node per V1 type
  const contextNodes: Record<string, string> = {}
  for (const type of CONTEXT_TYPES) {
    const { data: ctx } = await supabase.from('nodes').insert({
      organisation_id: orgId, project_id: project.id, document_id: null, parent_id: null,
      node_category: 'context', node_type: type, scope: 'project',
      name: `Empty ${type} for review`,
      short_description: 'Created by /api/dev-prompt-review for T-15 generate-context testing',
      status: 'draft', version: 1,
    }).select('id').single()
    if (ctx) contextNodes[type] = ctx.id
    // Link to book root so context-aware operations have something to assemble
    if (ctx && (type === 'character' || type === 'location')) {
      await supabase.from('node_context_links').insert({
        organisation_id: orgId,
        source_node_id: bookNodeId,
        target_node_id: ctx.id,
        link_type: 'structural_to_context',
      })
    }
  }

  // Kick off background review
  waitUntil(runReview(orgId, user.id, project.id, documentId, {
    bookNodeId, actId: act.id, chapterId: chapter.id, sceneId: scene.id, beatId: beat.id,
    contextNodes,
  }))

  return NextResponse.json({
    ok: true,
    message: 'T-15 prompt review running. Poll /api/dev-prompt-review/status?project_id=' + project.id,
    project_id: project.id,
    project_url: `/projects/${project.id}`,
    document_url: `/projects/${project.id}/documents/${documentId}`,
  })
}

async function runReview(
  orgId: string, userId: string, projectId: string, documentId: string,
  fixtures: { bookNodeId: string; actId: string; chapterId: string; sceneId: string; beatId: string; contextNodes: Record<string, string> },
) {
  const supabase = createServiceRoleClient()
  const results: ReviewResult[] = []
  const startTotal = Date.now()

  type PromptCase = {
    step: number; profile: string; operation: string; nodeId: string; targetField?: string; refinementInstruction?: string
  }

  const cases: PromptCase[] = [
    // Expands — exercise the structural chain on a NEW act/chapter/scene/beat below the existing tree
    // (so we don't disturb the populated nodes used by the refines)
    // Actually simpler: run them on the existing fixtures even though they already have children
    // The Accept appends after existing children, so it's safe.
    // But actually for a clean review, run only against fresh nodes. Skipping expand for now —
    // already validated by /api/dev-comparative on three models.
    // Refines — use existing populated content
    { step: 1,  profile: 'refine_book_synopsis',     operation: 'refine', nodeId: fixtures.bookNodeId,  targetField: 'summary', refinementInstruction: 'Tighten the prose. Make every sentence earn its place.' },
    { step: 2,  profile: 'refine_act_summary',       operation: 'refine', nodeId: fixtures.actId,       targetField: 'summary', refinementInstruction: 'Sharpen the emotional register and the act turn.' },
    { step: 3,  profile: 'refine_chapter_summary',   operation: 'refine', nodeId: fixtures.chapterId,   targetField: 'summary', refinementInstruction: 'Make the chapter turn more concrete.' },
    { step: 4,  profile: 'refine_scene_summary',     operation: 'refine', nodeId: fixtures.sceneId,     targetField: 'summary', refinementInstruction: 'Be more specific about the constable. Why is he watching her?' },
    { step: 5,  profile: 'refine_beat_summary',      operation: 'refine', nodeId: fixtures.beatId,      targetField: 'summary', refinementInstruction: 'Tighten the moment of recognition that the constable is being watched too.' },
    { step: 6,  profile: 'refine_beat_prose',        operation: 'refine', nodeId: fixtures.beatId,      targetField: 'prose',   refinementInstruction: 'Cut the third sentence about gravel. Trust the reader more.' },
    // refine_default — run on a context node (no specific refine profile for context types)
    { step: 7,  profile: 'refine_default',           operation: 'refine', nodeId: fixtures.contextNodes.character, targetField: 'summary', refinementInstruction: 'Make this character description more specific.' },
    // Synthesise — runs on the beat (note: will overwrite the BEAT_PROSE above on Accept; that's fine, this is a review fixture)
    { step: 8,  profile: 'synthesise_beat',          operation: 'synthesise', nodeId: fixtures.beatId },
    // Generate-context for all 6 V1 types
    { step: 9,  profile: 'generate_context_character',    operation: 'generate_context', nodeId: fixtures.contextNodes.character },
    { step: 10, profile: 'generate_context_location',     operation: 'generate_context', nodeId: fixtures.contextNodes.location },
    { step: 11, profile: 'generate_context_organisation', operation: 'generate_context', nodeId: fixtures.contextNodes.organisation },
    { step: 12, profile: 'generate_context_world',        operation: 'generate_context', nodeId: fixtures.contextNodes.world },
    { step: 13, profile: 'generate_context_theme',        operation: 'generate_context', nodeId: fixtures.contextNodes.theme },
    { step: 14, profile: 'generate_context_plot_thread',  operation: 'generate_context', nodeId: fixtures.contextNodes.plot_thread },
  ]

  for (const c of cases) {
    console.log(`[t15] step ${c.step}: ${c.profile} on node ${c.nodeId.slice(0, 8)}...`)
    const t0 = Date.now()
    try {
      const result = await runAndCapture(supabase, {
        nodeId: c.nodeId, documentId, orgId, userId,
        operationType: c.operation, profileName: c.profile,
        targetField: c.targetField, refinementInstruction: c.refinementInstruction,
      })
      results.push({
        step: c.step, profile: c.profile, operation_type: c.operation,
        target_node: c.nodeId, ...result,
        duration_seconds: Math.round((Date.now() - t0) / 1000),
      })
      console.log(`[t15]   done · cost $${result.cost_usd?.toFixed(4)} · ${Math.round((Date.now() - t0) / 1000)}s`)
    } catch (err) {
      results.push({
        step: c.step, profile: c.profile, operation_type: c.operation,
        target_node: c.nodeId, status: 'failed',
        cost_usd: null, tokens_input: null, tokens_output: null,
        result_preview: '', error_message: (err as Error).message,
        duration_seconds: Math.round((Date.now() - t0) / 1000),
      })
      console.error(`[t15]   FAILED: ${(err as Error).message}`)
    }
  }

  const totalSeconds = Math.round((Date.now() - startTotal) / 1000)
  const totalCost = results.reduce((s, r) => s + (r.cost_usd ?? 0), 0)

  // Write the markdown report
  await mkdir('test-reports', { recursive: true })
  const reportPath = join('test-reports', `prompt-review-${Date.now()}.md`)
  await writeFile(reportPath, buildReport(results, { totalCost, totalSeconds, projectId, documentId }))
  console.log(`[t15] === REVIEW COMPLETE === total cost $${totalCost.toFixed(4)}, ${totalSeconds}s, report at ${reportPath}`)
}

async function runAndCapture(
  supabase: ReturnType<typeof createServiceRoleClient>,
  args: {
    nodeId: string; documentId: string; orgId: string; userId: string
    operationType: string; profileName: string
    targetField?: string; refinementInstruction?: string
  },
): Promise<{ status: string; cost_usd: number | null; tokens_input: number | null; tokens_output: number | null; result_preview: string; error_message: string | null }> {
  const { data: profile } = await supabase
    .from('agent_profiles').select('id').eq('name', args.profileName).single()
  if (!profile) throw new Error(`profile ${args.profileName} not found`)

  const { data: node } = await supabase
    .from('nodes').select('version').eq('id', args.nodeId).single()
  if (!node) throw new Error(`node not found`)

  const dynamicCtx: Record<string, unknown> = { agent_instruction: '' }
  if (args.targetField) dynamicCtx.target_field = args.targetField
  if (args.refinementInstruction) dynamicCtx.refinement_instruction = args.refinementInstruction

  const { data: job } = await supabase
    .from('agent_jobs')
    .insert({
      organisation_id: args.orgId, node_id: args.nodeId, document_id: args.documentId,
      profile_id: profile.id,
      operation_type: args.operationType, operation_class: 'single_node',
      status: 'pending', triggered_by: args.userId,
      target_node_version_at_capture: node.version,
      context_snapshot: { dynamic: dynamicCtx },
    })
    .select('id').single()
  if (!job) throw new Error('job insert failed')

  await runAgentJob(job.id)

  const { data: finalJob } = await supabase
    .from('agent_jobs')
    .select('status, result_summary, result_prose, result_metadata, result_child_nodes, cost_usd, tokens_input, tokens_output, error_message')
    .eq('id', job.id).single()
  if (!finalJob) throw new Error('final job read failed')

  type FinalJob = { status: string; result_summary: string | null; result_prose: string | null; result_metadata: Record<string, unknown> | null; result_child_nodes: unknown[] | null; cost_usd: number | null; tokens_input: number | null; tokens_output: number | null; error_message: string | null }
  const fj = finalJob as unknown as FinalJob

  const preview = previewResult(fj)

  // Accept (commit to nodes) — gives the user something to look at in UI too
  if (fj.status === 'completed') {
    const tiptapSummary = fj.result_summary ? JSON.stringify(plainTextToTiptap(fj.result_summary)) : null
    const tiptapProse = fj.result_prose ? JSON.stringify(plainTextToTiptap(fj.result_prose)) : null
    const childNodesForRpc = Array.isArray(fj.result_child_nodes)
      ? (fj.result_child_nodes as Array<Record<string, unknown>>).map((c) => ({
          name: c.name ?? null,
          short_description: c.short_description ?? '',
          summary: typeof c.summary === 'string' ? JSON.stringify(plainTextToTiptap(c.summary)) : null,
          metadata: c.metadata ?? {},
          word_count_target: c.word_count_target ?? null,
          position: c.position,
        }))
      : null

    await supabase.rpc('accept_agent_job', {
      p_job_id: job.id, p_actor_id: args.userId,
      p_target_summary: tiptapSummary,
      p_target_prose: tiptapProse,
      p_target_notes: null,
      p_target_metadata: fj.result_metadata ?? null,
      p_child_nodes: childNodesForRpc,
    })
  }

  return {
    status: fj.status, cost_usd: fj.cost_usd, tokens_input: fj.tokens_input,
    tokens_output: fj.tokens_output, result_preview: preview, error_message: fj.error_message,
  }
}

function previewResult(j: { result_summary: string | null; result_prose: string | null; result_metadata: Record<string, unknown> | null; result_child_nodes: unknown[] | null }): string {
  if (j.result_prose) return j.result_prose
  if (j.result_summary && j.result_metadata) {
    return `${j.result_summary}\n\n--- metadata ---\n${JSON.stringify(j.result_metadata, null, 2)}`
  }
  if (j.result_summary) return j.result_summary
  if (j.result_child_nodes) return JSON.stringify(j.result_child_nodes, null, 2)
  if (j.result_metadata) return JSON.stringify(j.result_metadata, null, 2)
  return '(no result)'
}

function buildReport(results: ReviewResult[], summary: { totalCost: number; totalSeconds: number; projectId: string; documentId: string }): string {
  const lines: string[] = []
  lines.push('# T-15 Prompt Review — Haiku 4.5')
  lines.push('')
  lines.push(`Generated: ${new Date().toISOString()}`)
  lines.push(`Total cost: **$${summary.totalCost.toFixed(4)}**`)
  lines.push(`Total wall clock: ${Math.floor(summary.totalSeconds / 60)}m ${summary.totalSeconds % 60}s`)
  lines.push(`Project: \`/projects/${summary.projectId}\``)
  lines.push(`Document: \`/projects/${summary.projectId}/documents/${summary.documentId}\``)
  lines.push('')
  lines.push('## Per-prompt summary')
  lines.push('')
  lines.push('| # | Profile | Status | Cost | In | Out | Time |')
  lines.push('|---|---|---|---:|---:|---:|---:|')
  for (const r of results) {
    lines.push(`| ${r.step} | \`${r.profile}\` | ${r.status} | $${(r.cost_usd ?? 0).toFixed(4)} | ${r.tokens_input ?? '—'} | ${r.tokens_output ?? '—'} | ${r.duration_seconds}s |`)
  }
  lines.push('')
  lines.push('## Per-prompt outputs')
  lines.push('')
  for (const r of results) {
    lines.push(`### ${r.step}. \`${r.profile}\` — ${r.status}`)
    lines.push('')
    lines.push(`*Cost: $${(r.cost_usd ?? 0).toFixed(4)} · tokens ${r.tokens_input ?? '—'}/${r.tokens_output ?? '—'} · ${r.duration_seconds}s*`)
    lines.push('')
    if (r.error_message) {
      lines.push(`**ERROR:** \`${r.error_message}\``)
      lines.push('')
    }
    lines.push('```')
    lines.push(r.result_preview.slice(0, 4000))
    if (r.result_preview.length > 4000) lines.push(`... [truncated, full ${r.result_preview.length} chars in DB]`)
    lines.push('```')
    lines.push('')
    lines.push('**Verdict:** _[ ] PASS  [ ] NEEDS-ITERATION  notes:_')
    lines.push('')
    lines.push('---')
    lines.push('')
  }
  return lines.join('\n')
}
