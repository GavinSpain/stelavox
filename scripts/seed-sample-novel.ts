/**
 * Sample novel seeder — very small functional fixture for Phase 8.01 testing.
 *
 * This is the testing-functionality drop-in sample, NOT the final
 * "Cartographer's Apprentice" production sample. The user has approved
 * shipping this small one for now so Phase 8.01 build pass has something
 * to point at when wiring "Try the sample novel" on the empty dashboard.
 *
 * Shape:
 *   Project "Sample Novel — The Quiet Door"
 *     Document (novel layer_stack)
 *       Book 1 — The Quiet Door
 *         Act 1 — Threshold
 *           Ch 1 — Arrival
 *             Sc 1 — The Door
 *               Bt 1, Bt 2 (with prose)
 *             Sc 2 — The Keeper
 *               Bt 1, Bt 2 (with prose)
 *           Ch 2 — Inside
 *             Sc 1 — The Hall
 *               Bt 1, Bt 2 (with prose)
 *             Sc 2 — The Decision
 *               Bt 1, Bt 2 (with prose)
 *
 *   Context nodes (document-scoped):
 *     Character — Mara (the visitor)
 *     Character — Ord (the keeper)
 *     Location  — The Door House
 *     Theme     — What belongs to whom
 *
 * Total: 16 structural nodes + 4 context nodes. 8 leaf beats with short
 * prose (~80 words each); ~640 words total. Tagged with metadata
 * { is_sample: true } so the V1 build pass can render a SAMPLE badge
 * (Component Spec v2.21 §18.6 SampleNovelImportModal lock).
 *
 * Usage:
 *   npm run script scripts/seed-sample-novel.ts
 *   npm run script scripts/seed-sample-novel.ts --reset
 *   npm run script scripts/seed-sample-novel.ts --user some.email@example.com
 *
 * Without --reset, refuses if a project named "Sample Novel — The Quiet
 * Door" already exists for the target user. --reset deletes the existing
 * project (FK cascade removes document + nodes + context links) before
 * reseeding.
 *
 * Pattern mirrors scripts/seed-shadow-protocol.ts (service-role inserts
 * against the live database, dotenv loads .env.local).
 */

import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const PROJECT_NAME = 'Sample Novel — The Quiet Door'
const DOCUMENT_NAME = 'The Quiet Door'
const DEFAULT_EMAIL = 'author@stelavox.local'
const DEFAULT_PASSWORD = 'Test1234!Test1234!'

// ─── Args ──────────────────────────────────────────────────────────────

function parseArgs(): { reset: boolean; userEmail: string } {
  const args = process.argv.slice(2)
  let reset = false
  let userEmail = DEFAULT_EMAIL
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--reset') reset = true
    else if (args[i] === '--user') userEmail = args[++i]
    else if (args[i] === '--help' || args[i] === '-h') {
      console.log('Usage: npm run script scripts/seed-sample-novel.ts [--reset] [--user <email>]')
      console.log(`  Default user: ${DEFAULT_EMAIL}`)
      process.exit(0)
    }
  }
  return { reset, userEmail }
}

// ─── Fixture content ───────────────────────────────────────────────────

interface BeatSpec {
  name: string
  summary: string
  prose: string
}
interface SceneSpec { name: string; summary: string; beats: BeatSpec[] }
interface ChapterSpec { name: string; summary: string; scenes: SceneSpec[] }
interface ActSpec { name: string; summary: string; chapters: ChapterSpec[] }
interface BookSpec { name: string; summary: string; acts: ActSpec[] }

const BOOK: BookSpec = {
  name: 'The Quiet Door',
  summary:
    'Mara walks to a house she has never seen before and asks for what is hers. Ord, the keeper, says nothing she expects.',
  acts: [
    {
      name: 'Threshold',
      summary: 'Mara arrives, is met, and learns the terms.',
      chapters: [
        {
          name: 'Arrival',
          summary: 'Mara reaches the house and is admitted.',
          scenes: [
            {
              name: 'The Door',
              summary: 'Mara stands at the door and waits.',
              beats: [
                {
                  name: 'The Walk',
                  summary: 'Mara walks the last quarter mile.',
                  prose:
                    'The road was longer than the map had said, and by the time Mara reached the bend in the fence she had stopped counting her own footsteps. The house was small. It was painted the colour of weather, not the colour of paint. She stood at the gate for a long moment before she pushed it open.',
                },
                {
                  name: 'The Knock',
                  summary: 'She knocks. The door answers.',
                  prose:
                    'There was a brass weight at the centre of the door, shaped like a hand. She lifted it. She held it. She let it fall. The sound was not loud. From inside, after a pause she could not have measured, a voice said: "It is open." So she opened it.',
                },
              ],
            },
            {
              name: 'The Keeper',
              summary: 'Mara meets Ord, who has been waiting.',
              beats: [
                {
                  name: 'The Room',
                  summary: 'Inside is warmer than expected.',
                  prose:
                    'The room had two chairs and a table and a fire that should not have been lit at that hour. Ord did not stand. He looked at her once, briefly, and gestured to the second chair. "Sit," he said, and the word arrived without weight. "You have walked far." She did not say no.',
                },
                {
                  name: 'The Question',
                  summary: 'Mara asks why he was expecting her.',
                  prose:
                    '"You knew I was coming." It was not a question, although she had meant to make it one. Ord put down the cup he had been holding. "I knew someone would come," he said. "I did not know it would be you. That is a small difference." She thought about this for some time before she answered.',
                },
              ],
            },
          ],
        },
        {
          name: 'Inside',
          summary: 'Mara is given terms, and chooses.',
          scenes: [
            {
              name: 'The Hall',
              summary: 'Ord shows her the room with the box.',
              beats: [
                {
                  name: 'The Lamp',
                  summary: 'Ord takes a lamp and leads her down a hall.',
                  prose:
                    'He lit a lamp the old way, with a long taper, although the wires in the wall were live and the switch was visible. "Habit," he said when he saw her look. The hall behind the room was longer than the room itself. She wondered, but did not ask, whether the house was strictly inside its own outside.',
                },
                {
                  name: 'The Box',
                  summary: 'A black box sits on a small table.',
                  prose:
                    'The box was the size of a loaf of bread and the colour of nothing. Ord set the lamp beside it. "This is what you came for," he said. "Or what came for you. I have not yet decided which way that sentence runs." Mara looked at the box for a long moment before she reached.',
                },
              ],
            },
            {
              name: 'The Decision',
              summary: 'Mara is offered a choice and takes it.',
              beats: [
                {
                  name: 'The Terms',
                  summary: 'Ord explains what taking it means.',
                  prose:
                    '"It is not yours to keep," Ord said. "It is yours to carry. There is a difference, and the difference is the whole shape of what happens next. If you carry it, you will know things you did not ask to know. If you do not, you will leave through the door you came in by, and the road home will be exactly as long as the road here was."',
                },
                {
                  name: 'The Lifting',
                  summary: 'Mara lifts the box. She turns to the door.',
                  prose:
                    'She lifted the box. It was heavier than its size and lighter than its colour, and she did not yet know what was inside it. Ord watched her, not with approval and not with regret, but with a kind of small attention she would think about for a long time. She turned, and walked back through the hall, and the lamp went with her, although neither of them had moved it.',
                },
              ],
            },
          ],
        },
      ],
    },
  ],
}

const CONTEXT_NODES = [
  {
    node_type: 'character',
    name: 'Mara',
    short_description: 'The visitor. Late twenties, walked here on foot from somewhere not described.',
  },
  {
    node_type: 'character',
    name: 'Ord',
    short_description: 'The keeper. Indeterminate age. Lights lamps with a taper despite electric wiring.',
  },
  {
    node_type: 'location',
    name: 'The Door House',
    short_description: 'A small weathered house on a road. Interior larger than exterior would suggest.',
  },
  {
    node_type: 'theme',
    name: 'What belongs to whom',
    short_description: 'The story turns on the difference between keeping and carrying.',
  },
]

// ─── Plain-text → Tiptap JSON helper ───────────────────────────────────

function toTiptap(text: string): unknown {
  return {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: text.length > 0 ? [{ type: 'text', text }] : [],
      },
    ],
  }
}

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length
}

// ─── Main seed routine ────────────────────────────────────────────────

async function ensureUser(supabase: SupabaseClient, email: string): Promise<string> {
  const { data: list, error: listErr } = await supabase.auth.admin.listUsers({ perPage: 200 })
  if (listErr) throw new Error(`auth.admin.listUsers failed: ${listErr.message}`)
  const existing = list.users.find((u) => u.email === email)
  if (existing) return existing.id

  const { data: created, error: createErr } = await supabase.auth.admin.createUser({
    email,
    password: DEFAULT_PASSWORD,
    email_confirm: true,
  })
  if (createErr || !created.user) throw new Error(`auth.admin.createUser failed: ${createErr?.message}`)
  return created.user.id
}

async function findOrganisationForUser(supabase: SupabaseClient, userId: string): Promise<string> {
  const { data, error } = await supabase
    .from('organisation_members')
    .select('organisation_id')
    .eq('user_id', userId)
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(`organisation_members query failed: ${error.message}`)
  if (!data) throw new Error(`User ${userId} has no organisation_members row (H-03 trigger?).`)
  return data.organisation_id
}

async function deleteExistingProject(supabase: SupabaseClient, orgId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('projects')
    .select('id')
    .eq('organisation_id', orgId)
    .eq('name', PROJECT_NAME)
    .maybeSingle()
  if (error) throw new Error(`projects lookup failed: ${error.message}`)
  if (!data) return false
  const { error: delErr } = await supabase.from('projects').delete().eq('id', data.id)
  if (delErr) throw new Error(`project delete failed: ${delErr.message}`)
  return true
}

async function createSampleNovel(
  supabase: SupabaseClient,
  orgId: string,
  _userId: string,
): Promise<{ projectId: string; documentId: string }> {
  // 1. Create the project. projects has no created_by column — see
  //    supabase/migrations/20260503000001_core_tables.sql.
  const { data: project, error: projErr } = await supabase
    .from('projects')
    .insert({
      organisation_id: orgId,
      name: PROJECT_NAME,
      description: 'A very small functional sample. Not the final sample novel.',
      metadata: { is_sample: true, sample_kind: 'small-functional' },
    })
    .select('id')
    .single()
  if (projErr || !project) throw new Error(`project insert failed: ${projErr?.message}`)
  const projectId: string = project.id

  // 2. Create the document + tree via the standard RPC. Signature per
  //    supabase/migrations/20260513000085_create_document_with_profile.sql.
  //    Returns JSONB { document, layer_stack, root_node, project_profile }.
  const { data: rpcResult, error: rpcErr } = await supabase.rpc('create_document_with_layer_stack', {
    p_project_id: projectId,
    p_organisation_id: orgId,
    p_name: DOCUMENT_NAME,
    p_description: 'Small functional sample for Phase 8.01 testing.',
    p_document_type: 'novel',
    p_authors: ['Sample Author'],
  })
  if (rpcErr || !rpcResult) {
    throw new Error(`create_document_with_layer_stack failed: ${rpcErr?.message}`)
  }
  const setup = rpcResult as {
    document: { id: string }
    root_node: { id: string }
    layer_stack: { id: string }
  }
  const documentId: string = setup.document.id
  const bookId: string = setup.root_node.id

  // 3. Update the auto-created root with the sample's content.
  const { error: rootUpdErr } = await supabase
    .from('nodes')
    .update({
      name: BOOK.name,
      summary: toTiptap(BOOK.summary),
      metadata: { is_sample: true },
    })
    .eq('id', bookId)
  if (rootUpdErr) throw new Error(`root-node update failed: ${rootUpdErr.message}`)

  // Recursive child insert. depth is auto-derived by the M-173 trigger.
  async function insertChild(
    parentId: string,
    layerIndex: number,
    nodeType: string,
    order: number,
    name: string,
    summary: string,
    prose: string | null,
    isLeaf: boolean,
  ): Promise<string> {
    const wordTarget = isLeaf ? 100 : null
    const wordActual = prose ? wordCount(prose) : null
    // Structural nodes MUST have scope = NULL per M-024
    // nodes_scope_conditional_not_null. Context nodes set scope below.
    const { data, error } = await supabase
      .from('nodes')
      .insert({
        organisation_id: orgId,
        project_id: projectId,
        document_id: documentId,
        parent_id: parentId,
        node_category: 'structural',
        node_type: nodeType,
        order,
        layer_index: layerIndex,
        name,
        summary: toTiptap(summary),
        prose: prose ? toTiptap(prose) : null,
        status: 'draft',
        version: 1,
        word_count_target: wordTarget,
        word_count_actual: wordActual,
        metadata: { is_sample: true },
      })
      .select('id')
      .single()
    if (error || !data) throw new Error(`node insert ${nodeType} '${name}' failed: ${error?.message}`)
    return data.id
  }

  for (let ai = 0; ai < BOOK.acts.length; ai++) {
    const act = BOOK.acts[ai]
    const actId = await insertChild(bookId, 1, 'act', ai + 1, act.name, act.summary, null, false)
    for (let ci = 0; ci < act.chapters.length; ci++) {
      const chapter = act.chapters[ci]
      const chapterId = await insertChild(
        actId, 2, 'chapter', ci + 1, chapter.name, chapter.summary, null, false,
      )
      for (let si = 0; si < chapter.scenes.length; si++) {
        const scene = chapter.scenes[si]
        const sceneId = await insertChild(
          chapterId, 3, 'scene', si + 1, scene.name, scene.summary, null, false,
        )
        for (let bi = 0; bi < scene.beats.length; bi++) {
          const beat = scene.beats[bi]
          await insertChild(
            sceneId, 4, 'beat', bi + 1, beat.name, beat.summary, beat.prose, true,
          )
        }
      }
    }
  }

  // 4. Insert document-scoped context nodes (parent_id NULL, category=context).
  for (let i = 0; i < CONTEXT_NODES.length; i++) {
    const ctx = CONTEXT_NODES[i]
    const { error: ctxErr } = await supabase.from('nodes').insert({
      organisation_id: orgId,
      project_id: projectId,
      document_id: documentId,
      parent_id: null,
      node_category: 'context',
      node_type: ctx.node_type,
      order: i + 1,
      layer_index: null,
      scope: 'document',
      name: ctx.name,
      short_description: ctx.short_description,
      summary: toTiptap(ctx.short_description),
      status: 'draft',
      version: 1,
      metadata: { is_sample: true },
    })
    if (ctxErr) throw new Error(`context insert ${ctx.name} failed: ${ctxErr.message}`)
  }

  return { projectId, documentId }
}

// ─── Entry ─────────────────────────────────────────────────────────────

async function main() {
  const { reset, userEmail } = parseArgs()

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env.local')
  }
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  console.log(`[sample-novel] target user: ${userEmail}`)
  const userId = await ensureUser(supabase, userEmail)
  const orgId = await findOrganisationForUser(supabase, userId)
  console.log(`[sample-novel] user_id=${userId} org_id=${orgId}`)

  if (reset) {
    const deleted = await deleteExistingProject(supabase, orgId)
    console.log(`[sample-novel] reset: existing project ${deleted ? 'deleted' : 'not found'}`)
  } else {
    const { data: existing } = await supabase
      .from('projects')
      .select('id, name')
      .eq('organisation_id', orgId)
      .eq('name', PROJECT_NAME)
      .maybeSingle()
    if (existing) {
      console.log(`[sample-novel] project "${PROJECT_NAME}" already exists (id=${existing.id}).`)
      console.log('[sample-novel] Re-run with --reset to delete and reseed.')
      process.exit(0)
    }
  }

  console.log('[sample-novel] seeding...')
  const { projectId, documentId } = await createSampleNovel(supabase, orgId, userId)
  console.log(`[sample-novel] DONE. project=${projectId} document=${documentId}`)
  console.log(`[sample-novel] login: ${userEmail} / ${DEFAULT_PASSWORD}`)
  console.log(`[sample-novel] dashboard: ${supabaseUrl.includes('localhost') ? 'http://localhost:3000' : 'production URL'}/dashboard`)
}

main().catch((err) => {
  console.error('[sample-novel] FATAL:', err.message)
  process.exit(1)
})
