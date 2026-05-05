// DEV-ONLY MODEL COMPARISON HARNESS — gated by NODE_ENV !== production.
//
// Builds three identical-input novel documents in parallel using three
// different models (Haiku / Sonnet / Opus), running the full
// book→act→chapter→scene→beat→prose chain on each. Lets the operator
// read all three side-by-side and compare both craft quality and cost.
//
// POST /api/dev-comparative
//   Returns immediately with the 3 document IDs. The actual build runs
//   in the background (waitUntil). Poll /api/dev-comparative/status to
//   see progress.
//
// All work uses service-role — no session needed. Per-job model is set
// by UPDATEing agent_profiles between books (the runner picks model
// from the agent_profiles row at job-creation time).

import { NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'

import { runAgentJob } from '@/lib/agent/runner'
import { plainTextToTiptap } from '@/lib/agent/prose-to-tiptap'
import { createServiceRoleClient } from '@/lib/supabase/service'

const TEST_EMAIL = 'test@stelavox.local'

const SYNOPSIS = "Eleanor Marsh, a disgraced magistrate's daughter exiled to the windswept northern coast, discovers her father's old ledger hidden beneath the floorboards of her grandmother's house. The ledger reads like an accountant's shopping list — until she realises the names match those of forty-three people who drowned in the wreck of the Aurelia thirty years ago. As Eleanor pulls at the thread, the witnesses begin to die: an old fisherman, a former harbour-master, a woman who had been a child of seven on the morning of the wreck. The deaths are too clean to be coincidence and too quiet to be murder. Eleanor must decide whether to expose what her father did, knowing that the people who buried the truth thirty years ago are still in this town, still listening, still capable of arranging an accident. A slow-burn moral thriller about whether justice that comes too late is justice at all."

const ELENA_SUMMARY = "Eleanor Marsh, 38, was the magistrate's daughter — once. Now she is a woman who has spent three years in exile cataloguing other people's furniture for the auction house in Kirkwall, learning the small art of being unseen. She is intelligent, watchful, and morally rigorous in ways that have cost her everything. Her great wound is her father: she was the one who told the inquiry what she had overheard, and the family never forgave her, and her father went to his grave still calling her a Judas. The lie she now lives by is that exile is enough — that bearing witness once was sufficient and she owes the world nothing more. The story will dismantle this lie. Eleanor's voice is dry, precise, frequently funny in a way that surprises people who expect a victim. She watches rooms the way a chess player watches a board. Physically: thin, strong from years of walking the cliffs, hair the colour of wet rope, the kind of face that disappears in a crowd unless she chooses to be seen."

const LOCATION_SUMMARY = "The Mill House sits at the head of the cove where the Aurelia went down, three storeys of black slate and salt-pitted granite that has been in the Marsh family since 1812. The wind is the first thing you notice; it does not stop. The sea is the second; it is visible from every window. The kitchen smells permanently of woodsmoke and the brine that comes in on the south wind. The floors slope. The old harbour-master's chart of the bay is still pinned to the parlour wall, dated the year of the wreck, three faint pencil marks where someone has measured something. The house has the atmosphere of a museum to an accusation no one will speak aloud. For Eleanor, it is the house she was sent to die in slowly. For the town, it is the place from which the magistrate's daughter watches them, and they have not forgiven that either."

const MODELS = [
  { label: 'Haiku',  id: 'claude-haiku-4-5-20251001' },
  { label: 'Sonnet', id: 'claude-sonnet-4-6' },
  { label: 'Opus',   id: 'claude-opus-4-6' },
]

function tiptap(text: string): string {
  return JSON.stringify({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  })
}

export async function POST() {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'not_in_production' }, { status: 403 })
  }

  const supabase = createServiceRoleClient()

  // ─── Find or create the test user ────────────────────────────────────
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

  // ─── Create comparison project ───────────────────────────────────────
  const { data: project } = await supabase
    .from('projects')
    .insert({
      organisation_id: orgId,
      name: 'Model Comparison — The Northern Light',
      default_document_type: 'novel',
    })
    .select('id').single()
  if (!project) return NextResponse.json({ error: 'project create failed' }, { status: 500 })

  // ─── Three documents (Haiku / Sonnet / Opus) ─────────────────────────
  const docs: Array<{ label: string; modelId: string; documentId: string; bookNodeId: string }> = []
  for (const m of MODELS) {
    const { data: rpcRes, error: rpcErr } = await supabase.rpc(
      'create_document_with_layer_stack',
      {
        p_project_id: project.id,
        p_organisation_id: orgId,
        p_name: `${m.label} — The Northern Light`,
        p_description: `Model comparison build using ${m.id}`,
        p_document_type: 'novel',
        p_authors: [],
      },
    )
    if (rpcErr || !rpcRes) {
      return NextResponse.json({ error: `doc create ${m.label}: ${rpcErr?.message}` }, { status: 500 })
    }
    const r = rpcRes as { document?: { id?: string }; root_node?: { id?: string } }
    const documentId = r.document!.id!
    const bookNodeId = r.root_node!.id!

    // Backfill book root with synopsis (identical for all three)
    await supabase.from('nodes').update({
      name: 'The Northern Light',
      summary: tiptap(SYNOPSIS),
    }).eq('id', bookNodeId)

    docs.push({ label: m.label, modelId: m.id, documentId, bookNodeId })
  }

  // ─── Two project-scope context nodes (shared across all 3 docs) ─────
  const { data: elena } = await supabase.from('nodes').insert({
    organisation_id: orgId,
    project_id: project.id,
    document_id: null,
    parent_id: null,
    node_category: 'context',
    node_type: 'character',
    scope: 'project',
    name: 'Eleanor Marsh',
    short_description: "Protagonist; magistrate's daughter, exile.",
    summary: tiptap(ELENA_SUMMARY),
    metadata: {
      full_name: 'Eleanor Margaret Marsh', age: 38, role: 'protagonist',
      wound: 'Testified against her father at the inquiry; family disowned her.',
      lie: 'Bearing witness once was enough.',
      want: 'To be left alone in exile.',
      need: 'To complete the act of bearing witness.',
      arc_type: 'positive_change',
    },
    status: 'draft', version: 1,
  }).select('id').single()

  const { data: mill } = await supabase.from('nodes').insert({
    organisation_id: orgId,
    project_id: project.id,
    document_id: null,
    parent_id: null,
    node_category: 'context',
    node_type: 'location',
    scope: 'project',
    name: 'The Mill House',
    short_description: "Eleanor's grandmother's house at the head of the cove.",
    summary: tiptap(LOCATION_SUMMARY),
    metadata: {
      location_type: 'domestic interior with coastal exterior',
      atmosphere: 'A museum to an accusation no one will speak aloud.',
    },
    status: 'draft', version: 1,
  }).select('id').single()

  // Link both context nodes to each book root
  for (const doc of docs) {
    if (elena) {
      await supabase.from('node_context_links').insert({
        organisation_id: orgId,
        source_node_id: doc.bookNodeId,
        target_node_id: elena.id,
        link_type: 'structural_to_context',
      })
    }
    if (mill) {
      await supabase.from('node_context_links').insert({
        organisation_id: orgId,
        source_node_id: doc.bookNodeId,
        target_node_id: mill.id,
        link_type: 'structural_to_context',
      })
    }
  }

  // ─── Kick off background build chain ─────────────────────────────────
  waitUntil(buildAllChains(docs, orgId, user.id))

  return NextResponse.json({
    ok: true,
    message: 'Setup complete. Build chain running in background. Poll /api/dev-comparative/status for progress.',
    project_id: project.id,
    project_url: `/projects/${project.id}`,
    documents: docs.map((d) => ({
      label: d.label,
      model: d.modelId,
      document_id: d.documentId,
      url: `/projects/${project.id}/documents/${d.documentId}`,
    })),
    login: { email: TEST_EMAIL, password: 'test-password-123', url: 'http://localhost:3000/login' },
  })
}

// ─────────────────────────────────────────────────────────────────────────
// Background build orchestration
// ─────────────────────────────────────────────────────────────────────────

async function buildAllChains(
  docs: Array<{ label: string; modelId: string; documentId: string; bookNodeId: string }>,
  orgId: string,
  userId: string,
) {
  const supabase = createServiceRoleClient()
  for (const doc of docs) {
    console.log(`[comparative] === Starting ${doc.label} (${doc.modelId}) ===`)
    try {
      // Set ALL system profile model_ids to this book's model.
      await supabase
        .from('agent_profiles')
        .update({ model_id: doc.modelId })
        .eq('is_system_profile', true)

      await buildOneBook(supabase, doc, orgId, userId)
      console.log(`[comparative] === ${doc.label} complete ===`)
    } catch (err) {
      console.error(`[comparative] ${doc.label} chain failed`, err)
    }
  }
  console.log('[comparative] === All books complete ===')
}

async function buildOneBook(
  supabase: ReturnType<typeof createServiceRoleClient>,
  doc: { label: string; modelId: string; documentId: string; bookNodeId: string },
  orgId: string,
  userId: string,
) {
  // Step 1: expand book → acts
  await runAndAccept(supabase, {
    nodeId: doc.bookNodeId, documentId: doc.documentId, orgId, userId,
    operationType: 'expand', profileName: 'expand_book_into_acts',
  })
  const act1 = await getFirstChild(supabase, doc.bookNodeId)
  if (!act1) throw new Error(`${doc.label}: act1 not found after expand`)

  // Step 2: expand act → chapters
  await runAndAccept(supabase, {
    nodeId: act1.id, documentId: doc.documentId, orgId, userId,
    operationType: 'expand', profileName: 'expand_act_into_chapters',
  })
  const chapter1 = await getFirstChild(supabase, act1.id)
  if (!chapter1) throw new Error(`${doc.label}: chapter1 not found`)

  // Step 3: expand chapter → scenes
  await runAndAccept(supabase, {
    nodeId: chapter1.id, documentId: doc.documentId, orgId, userId,
    operationType: 'expand', profileName: 'expand_chapter_into_scenes',
  })
  const scene1 = await getFirstChild(supabase, chapter1.id)
  if (!scene1) throw new Error(`${doc.label}: scene1 not found`)

  // Step 4: expand scene → beats
  await runAndAccept(supabase, {
    nodeId: scene1.id, documentId: doc.documentId, orgId, userId,
    operationType: 'expand', profileName: 'expand_scene_into_beats',
  })
  const beats = await getChildren(supabase, scene1.id)
  if (beats.length === 0) throw new Error(`${doc.label}: no beats produced`)

  // Step 5: synthesise prose for each beat
  for (const beat of beats) {
    await runAndAccept(supabase, {
      nodeId: beat.id, documentId: doc.documentId, orgId, userId,
      operationType: 'synthesise', profileName: 'synthesise_beat',
    })
  }
}

async function runAndAccept(
  supabase: ReturnType<typeof createServiceRoleClient>,
  args: {
    nodeId: string; documentId: string; orgId: string; userId: string
    operationType: string; profileName: string
  },
): Promise<void> {
  // Find profile
  const { data: profile } = await supabase
    .from('agent_profiles')
    .select('id, model_id')
    .eq('name', args.profileName)
    .single()
  if (!profile) throw new Error(`profile ${args.profileName} not found`)

  // Get current node version
  const { data: node } = await supabase
    .from('nodes')
    .select('version, name')
    .eq('id', args.nodeId)
    .single()
  if (!node) throw new Error(`node ${args.nodeId} not found`)

  console.log(`[comparative]   ${args.operationType} on "${node.name}" (model: ${profile.model_id})`)

  // Insert agent_jobs row
  const { data: job } = await supabase
    .from('agent_jobs')
    .insert({
      organisation_id: args.orgId,
      node_id: args.nodeId,
      document_id: args.documentId,
      profile_id: profile.id,
      operation_type: args.operationType,
      operation_class: 'single_node',
      status: 'pending',
      triggered_by: args.userId,
      target_node_version_at_capture: node.version,
      context_snapshot: { dynamic: { agent_instruction: '' } },
    })
    .select('id').single()
  if (!job) throw new Error('job insert failed')

  // Run synchronously
  await runAgentJob(job.id)

  // Poll until complete (should be instant after runAgentJob returns, but defensive)
  type FinalJob = {
    status: string
    result_summary: string | null
    result_prose: string | null
    result_metadata: Record<string, unknown> | null
    result_child_nodes: unknown[] | null
    cost_usd: number | null
    error_message: string | null
  }
  let finalJob: FinalJob | null = null
  for (let i = 0; i < 30; i++) {
    const { data: j } = await supabase
      .from('agent_jobs')
      .select('status, result_summary, result_prose, result_metadata, result_child_nodes, cost_usd, error_message')
      .eq('id', job.id).single()
    const jj = j as unknown as FinalJob | null
    if (jj && jj.status !== 'pending' && jj.status !== 'running') {
      finalJob = jj
      break
    }
    await new Promise((r) => setTimeout(r, 1000))
  }
  if (!finalJob) throw new Error(`job ${job.id} did not reach terminal state`)
  if (finalJob.status !== 'completed') {
    throw new Error(`job failed: ${finalJob.error_message ?? finalJob.status}`)
  }

  // Accept via RPC (same path as the API route)
  const tiptapSummary = finalJob.result_summary ? JSON.stringify(plainTextToTiptap(finalJob.result_summary)) : null
  const tiptapProse = finalJob.result_prose ? JSON.stringify(plainTextToTiptap(finalJob.result_prose)) : null
  const childNodesForRpc = Array.isArray(finalJob.result_child_nodes)
    ? (finalJob.result_child_nodes as Array<Record<string, unknown>>).map((c) => ({
        name: c.name ?? null,
        short_description: c.short_description ?? '',
        summary: typeof c.summary === 'string' ? JSON.stringify(plainTextToTiptap(c.summary)) : null,
        metadata: c.metadata ?? {},
        word_count_target: c.word_count_target ?? null,
        position: c.position,
      }))
    : null

  const { error: rpcErr } = await supabase.rpc('accept_agent_job', {
    p_job_id: job.id,
    p_actor_id: args.userId,
    p_target_summary: tiptapSummary,
    p_target_prose: tiptapProse,
    p_target_notes: null,
    p_target_metadata: finalJob.result_metadata ?? null,
    p_child_nodes: childNodesForRpc,
  })
  if (rpcErr) throw new Error(`accept RPC: ${rpcErr.message}`)

  console.log(`[comparative]     done · cost $${finalJob.cost_usd?.toFixed(4)}`)
}

async function getFirstChild(
  supabase: ReturnType<typeof createServiceRoleClient>,
  parentId: string,
): Promise<{ id: string; name: string | null } | null> {
  const { data } = await supabase
    .from('nodes')
    .select('id, name')
    .eq('parent_id', parentId)
    .eq('node_category', 'structural')
    .order('order', { ascending: true })
    .limit(1)
    .maybeSingle()
  return data ?? null
}

async function getChildren(
  supabase: ReturnType<typeof createServiceRoleClient>,
  parentId: string,
): Promise<Array<{ id: string; name: string | null }>> {
  const { data } = await supabase
    .from('nodes')
    .select('id, name')
    .eq('parent_id', parentId)
    .eq('node_category', 'structural')
    .order('order', { ascending: true })
  return data ?? []
}
