/**
 * Director corpus fixture seeder.
 *
 * Usage:
 *   npx tsx scripts/seed-director-fixture.ts --scenario j5-novel
 *   npx tsx scripts/seed-director-fixture.ts --scenario j5-novel --reset
 *
 * The --reset flag deletes any prior instance of the scenario for the
 * test user before seeding. Without --reset, the script aborts if a
 * scenario project of the same slug already exists.
 *
 * What the seeder does, in order:
 *   1. Loads .env.local for Supabase + service-role keys.
 *   2. Ensures the test user exists (creates via admin auth if not).
 *   3. Looks up the user's organisation (auto-created by H-03 trigger).
 *   4. Optionally deletes any prior project of the same scenario name.
 *   5. Creates a fresh project + document via the Phase 2 RPC.
 *   6. Inserts the structural tree from structure.ts, merging summaries
 *      and prose from content.ts.
 *   7. Inserts the document-scoped context nodes from context.ts.
 *   8. Locks any nodes flagged `locked: true` in structure.ts.
 *   9. Prints credentials and the dashboard URL.
 *
 * Idempotent with --reset. Without --reset, safely no-ops if the
 * project already exists (prints a hint to add --reset).
 */

import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })

import { createClient } from '@supabase/supabase-js'

import { ROOT_SLUG, STRUCTURE, type FixtureNodeRef } from '../fixtures/director-corpus/j5-novel/structure'
import { CONTENT, type NodeContent } from '../fixtures/director-corpus/j5-novel/content'
import { CONTEXT_NODES } from '../fixtures/director-corpus/j5-novel/context'

// ─── Config ────────────────────────────────────────────────────────────

const SCENARIO_REGISTRY: Record<string, ScenarioPack> = {
  'j5-novel': {
    slug: 'j5-novel',
    project_name: 'j5-novel',
    document_name: 'The November Set',
    document_type: 'novel',
    structure: STRUCTURE,
    content: CONTENT,
    context: CONTEXT_NODES,
    test_user: {
      email: 'j5-walk@example.com',
      password: 'Test1234!Test1234!',
    },
  },
}

interface ScenarioPack {
  slug: string
  project_name: string
  document_name: string
  document_type: string
  structure: FixtureNodeRef[]
  content: NodeContent[]
  context: typeof CONTEXT_NODES
  test_user: { email: string; password: string }
}

// ─── Args ──────────────────────────────────────────────────────────────

function parseArgs(): { scenario: string; reset: boolean } {
  const args = process.argv.slice(2)
  let scenario: string | undefined
  let reset = false
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--scenario') scenario = args[++i]
    else if (args[i] === '--reset') reset = true
    else if (args[i] === '--help' || args[i] === '-h') {
      console.log('Usage: npx tsx scripts/seed-director-fixture.ts --scenario <slug> [--reset]')
      console.log('Available scenarios:', Object.keys(SCENARIO_REGISTRY).join(', '))
      process.exit(0)
    }
  }
  if (!scenario) {
    console.error('error: --scenario <slug> is required')
    console.error('Available scenarios:', Object.keys(SCENARIO_REGISTRY).join(', '))
    process.exit(1)
  }
  if (!SCENARIO_REGISTRY[scenario]) {
    console.error(`error: unknown scenario "${scenario}"`)
    console.error('Available scenarios:', Object.keys(SCENARIO_REGISTRY).join(', '))
    process.exit(1)
  }
  return { scenario, reset }
}

// ─── Helpers ───────────────────────────────────────────────────────────

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    console.error('error: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env.local')
    process.exit(1)
  }
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
}

function countWords(s: string | undefined | null): number {
  if (!s) return 0
  return s.trim().split(/\s+/).filter(Boolean).length
}

/**
 * Convert plain-text content to a serialised Tiptap doc string. The
 * SummaryEditor and ProseEditor in the UI expect Tiptap JSON in the
 * `summary` / `prose` / `notes` columns — plain strings render as nothing
 * because the Tiptap renderer cannot parse them as a doc tree.
 *
 * Paragraphs are split on one-or-more blank lines. Each paragraph becomes
 * a single text node inside a paragraph node. No marks (bold, italic,
 * etc.) are applied — the j5-novel prose is unstyled by design.
 *
 * Returns null for empty / whitespace-only input.
 */
function toTiptapDoc(text: string | null | undefined): string | null {
  if (!text || !text.trim()) return null
  const paragraphs = text
    .split(/\n\s*\n+/)
    .map((p) => p.trim())
    .filter(Boolean)
  const doc = {
    type: 'doc',
    content: paragraphs.map((p) => ({
      type: 'paragraph',
      content: [{ type: 'text', text: p }],
    })),
  }
  return JSON.stringify(doc)
}

async function ensureTestUser(
  admin: ReturnType<typeof adminClient>,
  email: string,
  password: string,
): Promise<{ user_id: string; created: boolean }> {
  const { data: list } = await admin.auth.admin.listUsers({ perPage: 200 })
  const existing = (list?.users ?? []).find((u) => u.email === email)
  if (existing) return { user_id: existing.id, created: false }

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: email.split('@')[0] },
  })
  if (error || !data?.user) {
    console.error('error: failed to create test user:', error?.message)
    process.exit(1)
  }
  // Brief wait for the H-03 trigger to create the organisation + membership.
  await new Promise((r) => setTimeout(r, 500))
  return { user_id: data.user.id, created: true }
}

async function getUserOrg(
  admin: ReturnType<typeof adminClient>,
  user_id: string,
): Promise<string> {
  const { data } = await admin
    .from('organisation_members')
    .select('organisation_id')
    .eq('user_id', user_id)
    .single()
  if (!data) {
    console.error('error: user has no organisation_members row — H-03 trigger may have failed')
    process.exit(1)
  }
  return data.organisation_id
}

async function deletePriorScenarioProject(
  admin: ReturnType<typeof adminClient>,
  organisation_id: string,
  project_name: string,
): Promise<number> {
  const { data: priors } = await admin
    .from('projects')
    .select('id')
    .eq('organisation_id', organisation_id)
    .eq('name', project_name)
  const ids = (priors ?? []).map((p) => p.id)
  if (ids.length === 0) return 0
  // Cascade delete via the projects FK chain.
  const { error } = await admin.from('projects').delete().in('id', ids)
  if (error) {
    console.error('error: failed to delete prior scenario project(s):', error.message)
    process.exit(1)
  }
  return ids.length
}

// ─── Main ──────────────────────────────────────────────────────────────

async function main() {
  const { scenario, reset } = parseArgs()
  const pack = SCENARIO_REGISTRY[scenario]
  const admin = adminClient()

  console.log(`=== seeding scenario ${pack.slug} ===\n`)

  // Step 1: ensure test user.
  const { user_id, created } = await ensureTestUser(admin, pack.test_user.email, pack.test_user.password)
  console.log(`user ${pack.test_user.email}: ${created ? 'created' : 'already existed'} (id ${user_id.slice(0, 8)}…)`)

  // Step 2: get organisation.
  const organisation_id = await getUserOrg(admin, user_id)
  console.log(`organisation: ${organisation_id.slice(0, 8)}…`)

  // Step 3: optionally clear prior scenario.
  if (reset) {
    const deleted = await deletePriorScenarioProject(admin, organisation_id, pack.project_name)
    console.log(`prior scenario projects deleted: ${deleted}`)
  } else {
    const { data: priors } = await admin
      .from('projects')
      .select('id')
      .eq('organisation_id', organisation_id)
      .eq('name', pack.project_name)
    if ((priors ?? []).length > 0) {
      console.error(`\nerror: project "${pack.project_name}" already exists for this user.`)
      console.error('       re-run with --reset to delete and recreate.\n')
      process.exit(1)
    }
  }

  // Step 4: create project.
  const { data: project, error: projectError } = await admin
    .from('projects')
    .insert({ organisation_id, name: pack.project_name })
    .select('id')
    .single()
  if (projectError || !project) {
    console.error('error: failed to create project:', projectError?.message)
    process.exit(1)
  }
  console.log(`project: ${project.id.slice(0, 8)}…`)

  // Step 5: create document via RPC (auto-creates root node).
  const { data: rpc, error: rpcError } = await admin.rpc('create_document_with_layer_stack', {
    p_project_id: project.id,
    p_organisation_id: organisation_id,
    p_name: pack.document_name,
    p_description: null as unknown as string,
    p_document_type: pack.document_type,
    p_authors: [],
  })
  if (rpcError || !rpc) {
    console.error('error: create_document_with_layer_stack failed:', rpcError?.message)
    process.exit(1)
  }
  const setup = rpc as unknown as { document: { id: string; name: string }; root_node: { id: string } }
  const document_id = setup.document.id
  const root_node_id = setup.root_node.id
  console.log(`document: ${document_id.slice(0, 8)}… ("${setup.document.name}")`)
  console.log(`root node: ${root_node_id.slice(0, 8)}…`)

  // Step 6: build slug → uuid map starting with the auto-created root.
  const slugToId = new Map<string, string>()
  slugToId.set(ROOT_SLUG, root_node_id)

  // Step 7: index content by slug.
  const contentBySlug = new Map<string, NodeContent>()
  for (const c of pack.content) contentBySlug.set(c.slug, c)

  // Update root node with the act-1 summary if applicable. The j5-novel
  // pack does not specifically supply a root summary, but a future scenario
  // might; handle gracefully.
  const rootContent = contentBySlug.get(ROOT_SLUG)
  if (rootContent?.summary) {
    await admin.from('nodes').update({ summary: toTiptapDoc(rootContent.summary) }).eq('id', root_node_id)
  }

  // Step 8: insert structural nodes in depth-then-order so parents exist
  // when children reference them. The structure file is already authored
  // in roughly the right order, but sort defensively.
  const sorted = [...pack.structure].sort((a, b) => {
    if (a.depth !== b.depth) return a.depth - b.depth
    return a.order - b.order
  })

  for (const ref of sorted) {
    const parent_id = ref.parent_slug ? slugToId.get(ref.parent_slug) : null
    if (ref.parent_slug && !parent_id) {
      console.error(`error: parent slug "${ref.parent_slug}" not yet inserted for node "${ref.slug}"`)
      process.exit(1)
    }
    const c = contentBySlug.get(ref.slug)
    const word_count = countWords(c?.prose)
    const insert = {
      organisation_id,
      project_id: project.id,
      document_id,
      parent_id,
      node_category: 'structural' as const,
      node_type: ref.node_type,
      order: ref.order,
      depth: ref.depth,
      layer_index: ref.layer_index,
      name: ref.name,
      summary: toTiptapDoc(c?.summary),
      prose: toTiptapDoc(c?.prose),
      notes: toTiptapDoc(c?.notes),
      word_count_actual: word_count > 0 ? word_count : null,
      status: 'draft' as const,
      version: 1,
      locked: ref.locked === true,
      lock_reason: ref.locked === true ? 'Locked by j5-novel fixture (engineered for §J5 lock scenario)' : null,
    }
    const { data: row, error: insertError } = await admin
      .from('nodes')
      .insert(insert)
      .select('id')
      .single()
    if (insertError || !row) {
      console.error(`error: insert failed for "${ref.slug}":`, insertError?.message)
      process.exit(1)
    }
    slugToId.set(ref.slug, row.id)
  }
  console.log(`structural nodes inserted: ${sorted.length}`)

  // Step 9: insert context nodes.
  for (const ctx of pack.context) {
    const insert = {
      organisation_id,
      project_id: project.id,
      document_id,
      node_category: 'context' as const,
      node_type: ctx.node_type,
      parent_id: null,
      scope: 'document' as const,
      name: ctx.name,
      short_description: ctx.short_description,
      summary: toTiptapDoc(ctx.summary),
      metadata: ctx.metadata as never,
      tags: ctx.tags ?? [],
      status: 'draft' as const,
      version: 1,
    }
    const { error: ctxError } = await admin.from('nodes').insert(insert)
    if (ctxError) {
      console.error(`error: context node insert failed for "${ctx.slug}":`, ctxError.message)
      process.exit(1)
    }
  }
  console.log(`context nodes inserted: ${pack.context.length}`)

  // Step 10: report word counts (useful for L2-PACING-02 verification).
  const chapterCounts = new Map<string, number>()
  for (const ref of sorted) {
    if (ref.node_type !== 'beat') continue
    const chapterSlug = ref.parent_slug?.split('-sc-')[0] // e.g. 'ch-3-sc-2-bt-1' → parent 'ch-3-sc-2' → chapter 'ch-3'
    if (!chapterSlug) continue
    const c = contentBySlug.get(ref.slug)
    const w = countWords(c?.prose)
    chapterCounts.set(chapterSlug, (chapterCounts.get(chapterSlug) ?? 0) + w)
  }
  console.log('\nchapter word counts (beat prose only):')
  for (const [chapter, count] of [...chapterCounts.entries()].sort()) {
    console.log(`  ${chapter}: ${count}`)
  }

  // Step 11: print credentials.
  const appUrl = process.env.APP_URL ?? 'http://localhost:3000'
  console.log('\n=== seed complete ===')
  console.log(`\nlog in at: ${appUrl}/login`)
  console.log(`  email:    ${pack.test_user.email}`)
  console.log(`  password: ${pack.test_user.password}`)
  console.log(`\nproject: "${pack.project_name}"`)
  console.log(`document: "${pack.document_name}"`)
  console.log(`document id: ${document_id}`)
}

main().catch((err) => {
  console.error('\nseed failed with error:')
  console.error(err)
  process.exit(1)
})
