/**
 * Phase 8.5 — Mega-doc perf-measurement seeder.
 *
 * Creates a 500k-word "Mega Manuscript" project locally for perf
 * measurement. NOT a real novel; synthetic Lorem-style prose. The
 * point is *size*, not content quality.
 *
 * Shape:
 *   Project "Mega Manuscript"
 *     Document (novel layer_stack)
 *       Book 1
 *         Act 1..5
 *           Chapter 1..10 (per act)
 *             Scene 1..5 (per chapter)
 *               Beat 1..5 (per scene)  — ~400 words each
 *
 * Total:
 *   1 book + 5 acts + 50 chapters + 250 scenes + 1250 beats = 1556 nodes
 *   1250 × ~400 words = ~500k words total
 *
 * Usage:
 *   npm run script scripts/seed-mega-doc.ts
 *   npm run script scripts/seed-mega-doc.ts --reset
 *
 * Pattern mirrors scripts/seed-sample-novel.ts — service-role inserts,
 * dotenv loads .env.local, uses create_document_with_layer_stack RPC
 * so all the production hooks fire (Brief auto-create per V1.x-A.1,
 * layer_stack creation, etc.).
 *
 * Speed: bulk-inserts per layer (4 round-trips for structural nodes,
 * 5 chunked round-trips for beats) rather than one row at a time.
 * Target wall-clock under 90s on local Supabase.
 */

import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const PROJECT_NAME = 'Mega Manuscript'
const DOCUMENT_NAME = 'Mega Manuscript v1'
const DEFAULT_EMAIL = 'author@stelavox.local'
const DEFAULT_PASSWORD = 'Test1234!Test1234!'

// Structural fan-out.
const ACTS_PER_BOOK = 5
const CHAPTERS_PER_ACT = 10
const SCENES_PER_CHAPTER = 5
const BEATS_PER_SCENE = 5
const WORDS_PER_BEAT = 400

// Beats inserted in chunks so we don't slam Supabase with a 4MB payload.
const BEAT_CHUNK_SIZE = 250

// ─── Args ──────────────────────────────────────────────────────────────

function parseArgs(): { reset: boolean; userEmail: string } {
  const args = process.argv.slice(2)
  let reset = false
  let userEmail = DEFAULT_EMAIL
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--reset') reset = true
    else if (args[i] === '--user') userEmail = args[++i]
    else if (args[i] === '--help' || args[i] === '-h') {
      console.log('Usage: npm run script scripts/seed-mega-doc.ts [--reset] [--user <email>]')
      process.exit(0)
    }
  }
  return { reset, userEmail }
}

// ─── Synthetic prose generator ─────────────────────────────────────────

// Lorem-ipsum vocabulary. Drawn from public-domain corpora. Average
// word length ~5.2 chars, which matches English prose. No need for
// reproducibility — measurement runs against fixed corpus once seeded.
const LOREM_VOCAB = (
  'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod ' +
  'tempor incididunt ut labore et dolore magna aliqua enim ad minim veniam ' +
  'quis nostrud exercitation ullamco laboris nisi aliquip ex ea commodo ' +
  'consequat duis aute irure in reprehenderit voluptate velit esse cillum ' +
  'eu fugiat nulla pariatur excepteur sint occaecat cupidatat non proident ' +
  'sunt culpa qui officia deserunt mollit anim id est laborum the road ' +
  'was longer than the map had said the door was open she stood at the ' +
  'gate the lamp went with her he watched without approval or regret ' +
  'morning came over the hills the river held its breath a woman walked ' +
  'a man waited the village kept its secrets the bell rang twice the ' +
  'sky turned the colour of weather time passed in increments the keeper ' +
  'spoke softly the visitor listened the box was heavier than its size'
).split(/\s+/).filter(Boolean)

let rngState = 1
function rand(): number {
  // xorshift-style for cheap deterministic-enough variety
  rngState ^= rngState << 13
  rngState ^= rngState >>> 17
  rngState ^= rngState << 5
  return (rngState >>> 0) / 0xffffffff
}

function pickWord(): string {
  return LOREM_VOCAB[Math.floor(rand() * LOREM_VOCAB.length)]
}

function generateParagraph(words: number): string {
  const out: string[] = []
  for (let i = 0; i < words; i++) {
    let w = pickWord()
    if (i === 0) w = w[0]!.toUpperCase() + w.slice(1)
    out.push(w)
  }
  return out.join(' ') + '.'
}

/**
 * Build ~`targetWords` words spread across 5 paragraphs. Returns a
 * Tiptap doc JSON object. Word count is exact (we count what we
 * generated).
 */
function generateProse(targetWords: number): { doc: unknown; actualWords: number } {
  const paragraphsCount = 5
  const wordsPerPara = Math.floor(targetWords / paragraphsCount)
  const paragraphs: { type: string; content: { type: string; text: string }[] }[] = []
  let total = 0
  for (let i = 0; i < paragraphsCount; i++) {
    // Last paragraph absorbs the remainder.
    const w = i === paragraphsCount - 1 ? targetWords - total : wordsPerPara
    const text = generateParagraph(w)
    total += w
    paragraphs.push({ type: 'paragraph', content: [{ type: 'text', text }] })
  }
  return {
    doc: { type: 'doc', content: paragraphs },
    actualWords: total,
  }
}

function toTiptapPlain(text: string): unknown {
  return {
    type: 'doc',
    content: [{ type: 'paragraph', content: text.length > 0 ? [{ type: 'text', text }] : [] }],
  }
}

// ─── Lookup helpers (copied from seed-sample-novel.ts) ─────────────────

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
  if (!data) throw new Error(`User ${userId} has no organisation_members row.`)
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

// ─── Bulk-insert helpers ────────────────────────────────────────────────

interface BulkNodeRow {
  organisation_id: string
  project_id: string
  document_id: string
  parent_id: string
  node_category: 'structural'
  node_type: string
  order: number
  layer_index: number
  name: string
  summary: unknown
  prose: unknown | null
  status: 'draft'
  version: 1
  word_count_target: number | null
  word_count_actual: number | null
  metadata: { is_mega: true }
}

async function bulkInsertNodes(supabase: SupabaseClient, rows: BulkNodeRow[]): Promise<string[]> {
  const { data, error } = await supabase.from('nodes').insert(rows).select('id')
  if (error || !data) throw new Error(`bulk insert failed (${rows.length} rows): ${error?.message}`)
  if (data.length !== rows.length) {
    throw new Error(`bulk insert returned ${data.length} rows, expected ${rows.length}`)
  }
  return data.map((r) => r.id as string)
}

// ─── Main seed routine ─────────────────────────────────────────────────

async function createMegaManuscript(
  supabase: SupabaseClient,
  orgId: string,
): Promise<{ projectId: string; documentId: string; counts: Record<string, number>; words: number }> {
  const t0 = Date.now()

  // 1. Create the project.
  const { data: project, error: projErr } = await supabase
    .from('projects')
    .insert({
      organisation_id: orgId,
      name: PROJECT_NAME,
      description: 'Phase 8.5 perf-measurement fixture. Lorem-ipsum-style prose; not a real novel.',
      metadata: { is_mega: true, purpose: 'perf-baseline' },
    })
    .select('id')
    .single()
  if (projErr || !project) throw new Error(`project insert failed: ${projErr?.message}`)
  const projectId: string = project.id
  console.log(`[mega] project created: ${projectId}`)

  // 2. Create the document + root via RPC.
  const { data: rpcResult, error: rpcErr } = await supabase.rpc('create_document_with_layer_stack', {
    p_project_id: projectId,
    p_organisation_id: orgId,
    p_name: DOCUMENT_NAME,
    p_description: 'Mega manuscript v1 — synthetic perf fixture.',
    p_document_type: 'novel',
    p_authors: ['Mega Author'],
  })
  if (rpcErr || !rpcResult) throw new Error(`create_document_with_layer_stack failed: ${rpcErr?.message}`)
  const setup = rpcResult as {
    document: { id: string }
    root_node: { id: string }
  }
  const documentId: string = setup.document.id
  const bookId: string = setup.root_node.id
  console.log(`[mega] document created: ${documentId}; root book node: ${bookId}`)

  // 3. Update the auto-created root.
  const { error: rootUpdErr } = await supabase
    .from('nodes')
    .update({
      name: 'The Mega Manuscript',
      summary: toTiptapPlain('A 500k-word synthetic perf fixture spanning 5 acts.'),
      metadata: { is_mega: true },
    })
    .eq('id', bookId)
  if (rootUpdErr) throw new Error(`root-node update failed: ${rootUpdErr.message}`)

  // 4. Insert acts.
  const actRows: BulkNodeRow[] = []
  for (let a = 0; a < ACTS_PER_BOOK; a++) {
    actRows.push({
      organisation_id: orgId,
      project_id: projectId,
      document_id: documentId,
      parent_id: bookId,
      node_category: 'structural',
      node_type: 'act',
      order: a + 1,
      layer_index: 1,
      name: `Act ${a + 1}`,
      summary: toTiptapPlain(`Synthetic act ${a + 1} of the mega manuscript.`),
      prose: null,
      status: 'draft',
      version: 1,
      word_count_target: null,
      word_count_actual: null,
      metadata: { is_mega: true },
    })
  }
  const t1 = Date.now()
  const actIds = await bulkInsertNodes(supabase, actRows)
  console.log(`[mega] inserted ${actIds.length} acts in ${Date.now() - t1}ms`)

  // 5. Insert chapters.
  const chapterRows: BulkNodeRow[] = []
  for (let a = 0; a < ACTS_PER_BOOK; a++) {
    for (let c = 0; c < CHAPTERS_PER_ACT; c++) {
      chapterRows.push({
        organisation_id: orgId,
        project_id: projectId,
        document_id: documentId,
        parent_id: actIds[a]!,
        node_category: 'structural',
        node_type: 'chapter',
        order: c + 1,
        layer_index: 2,
        name: `Chapter ${a + 1}.${c + 1}`,
        summary: toTiptapPlain(`Synthetic chapter ${c + 1} of act ${a + 1}.`),
        prose: null,
        status: 'draft',
        version: 1,
        word_count_target: null,
        word_count_actual: null,
        metadata: { is_mega: true },
      })
    }
  }
  const t2 = Date.now()
  const chapterIds = await bulkInsertNodes(supabase, chapterRows)
  console.log(`[mega] inserted ${chapterIds.length} chapters in ${Date.now() - t2}ms`)

  // 6. Insert scenes.
  const sceneRows: BulkNodeRow[] = []
  for (let i = 0; i < chapterIds.length; i++) {
    for (let s = 0; s < SCENES_PER_CHAPTER; s++) {
      sceneRows.push({
        organisation_id: orgId,
        project_id: projectId,
        document_id: documentId,
        parent_id: chapterIds[i]!,
        node_category: 'structural',
        node_type: 'scene',
        order: s + 1,
        layer_index: 3,
        name: `Scene ${i + 1}.${s + 1}`,
        summary: toTiptapPlain(`Synthetic scene ${s + 1}.`),
        prose: null,
        status: 'draft',
        version: 1,
        word_count_target: null,
        word_count_actual: null,
        metadata: { is_mega: true },
      })
    }
  }
  const t3 = Date.now()
  const sceneIds = await bulkInsertNodes(supabase, sceneRows)
  console.log(`[mega] inserted ${sceneIds.length} scenes in ${Date.now() - t3}ms`)

  // 7. Insert beats (with prose). Chunked.
  console.log(`[mega] generating ${sceneIds.length * BEATS_PER_SCENE} beats with ~${WORDS_PER_BEAT} words each ...`)
  const t4 = Date.now()
  let totalWords = 0
  let totalBeats = 0
  for (let sceneStart = 0; sceneStart < sceneIds.length; sceneStart += BEAT_CHUNK_SIZE / BEATS_PER_SCENE) {
    const sceneEnd = Math.min(sceneStart + BEAT_CHUNK_SIZE / BEATS_PER_SCENE, sceneIds.length)
    const chunk: BulkNodeRow[] = []
    for (let i = sceneStart; i < sceneEnd; i++) {
      for (let b = 0; b < BEATS_PER_SCENE; b++) {
        const { doc, actualWords } = generateProse(WORDS_PER_BEAT)
        totalWords += actualWords
        chunk.push({
          organisation_id: orgId,
          project_id: projectId,
          document_id: documentId,
          parent_id: sceneIds[i]!,
          node_category: 'structural',
          node_type: 'beat',
          order: b + 1,
          layer_index: 4,
          name: `Beat ${i + 1}.${b + 1}`,
          summary: toTiptapPlain(`Synthetic beat ${b + 1}.`),
          prose: doc,
          status: 'draft',
          version: 1,
          word_count_target: WORDS_PER_BEAT,
          word_count_actual: actualWords,
          metadata: { is_mega: true },
        })
      }
    }
    await bulkInsertNodes(supabase, chunk)
    totalBeats += chunk.length
    process.stdout.write(`\r[mega] beats ${totalBeats}/${sceneIds.length * BEATS_PER_SCENE} (${totalWords.toLocaleString()} words) `)
  }
  process.stdout.write('\n')
  console.log(`[mega] inserted ${totalBeats} beats in ${Date.now() - t4}ms — total prose: ${totalWords.toLocaleString()} words`)

  console.log(`[mega] TOTAL TIME: ${Date.now() - t0}ms`)

  return {
    projectId,
    documentId,
    counts: {
      acts: actIds.length,
      chapters: chapterIds.length,
      scenes: sceneIds.length,
      beats: totalBeats,
    },
    words: totalWords,
  }
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

  console.log(`[mega] target user: ${userEmail}`)
  const userId = await ensureUser(supabase, userEmail)
  const orgId = await findOrganisationForUser(supabase, userId)
  console.log(`[mega] user_id=${userId} org_id=${orgId}`)

  if (reset) {
    const deleted = await deleteExistingProject(supabase, orgId)
    console.log(`[mega] reset: existing project ${deleted ? 'deleted' : 'not found'}`)
  } else {
    const { data: existing } = await supabase
      .from('projects')
      .select('id, name')
      .eq('organisation_id', orgId)
      .eq('name', PROJECT_NAME)
      .maybeSingle()
    if (existing) {
      console.log(`[mega] project "${PROJECT_NAME}" already exists (id=${existing.id}).`)
      console.log('[mega] Re-run with --reset to delete and reseed.')
      process.exit(0)
    }
  }

  console.log('[mega] seeding...')
  const result = await createMegaManuscript(supabase, orgId)
  console.log('[mega] DONE.')
  console.log(`[mega]   project = ${result.projectId}`)
  console.log(`[mega]   document = ${result.documentId}`)
  console.log(`[mega]   counts = ${JSON.stringify(result.counts)}`)
  console.log(`[mega]   words = ${result.words.toLocaleString()}`)
  console.log(`[mega]   login: ${userEmail} / ${DEFAULT_PASSWORD}`)
}

main().catch((err) => {
  console.error('[mega] FATAL:', err.message)
  process.exit(1)
})
