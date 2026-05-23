/**
 * Shadow Protocol context-link enrichment.
 *
 * The May-13 archive had all 14 context nodes linked only to the Book
 * root — a seed-time shortcut. This biases the Director's
 * get_context_for_node tool toward returning every context node for any
 * query. This script replaces those links with mention-based links so
 * each context node is connected to the structural nodes where it
 * actually appears.
 *
 * Strategy:
 *   - For each Character: scan all beats' prose for the character's
 *     name (first + last + any aliases). Link the beat's parent
 *     CHAPTER to the character (de-duped per chapter).
 *   - For each Location: same scan; link the beat's parent SCENE.
 *   - For each Plot Thread: link to all 3 Acts (plot threads are
 *     act-spanning by nature).
 *   - For each Theme: link to all 3 Acts.
 *   - For World: link to the Book root (1 link).
 *
 * Usage:
 *   npm run script scripts/relink-shadow-protocol-context.ts
 *
 * Idempotent: deletes existing node_context_links for the project
 * before inserting fresh ones.
 */

import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const TEST_EMAIL = 'author@stelavox.local'

// Hand-curated alias table — first word + obvious variations.
// Match is case-insensitive substring against prose plain text.
const ALIASES: Record<string, string[]> = {
  'Captain Kael Voss': ['kael', 'voss'],
  'Dr Mira Kane': ['mira', 'kane'],
  'Derelict Alien Probe': ['alien probe', 'derelict', 'the probe'],
  'Europa Research Colony': ['europa research', 'research colony', 'europa colony'],
  'Nexus Prime Corporate Arcology (Mars)': ['nexus prime', 'arcology', 'mars'],
  'The Ice Warrens (Europa Sub-surface)': ['ice warrens', 'warrens', 'sub-surface'],
  'The Iron Ghost (Kael’s Salvage Ship)': ['iron ghost', 'salvage ship'],
}

interface NodeRow {
  id: string
  parent_id: string | null
  node_category: 'structural' | 'context'
  node_type: string
  depth: number
  name: string | null
  prose: unknown | null
}

function adminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
  return createClient(url, serviceKey, { auth: { persistSession: false } })
}

function proseToText(prose: unknown): string {
  // Tiptap doc → plain text. Walk content recursively concatenating text nodes.
  if (!prose || typeof prose !== 'object') return ''
  let out = ''
  function walk(n: unknown) {
    if (!n || typeof n !== 'object') return
    const obj = n as Record<string, unknown>
    if (typeof obj.text === 'string') out += obj.text + ' '
    if (Array.isArray(obj.content)) {
      for (const child of obj.content) walk(child)
    }
  }
  walk(prose)
  return out
}

async function findAncestor(
  nodeId: string,
  ancestorType: string,
  byId: Map<string, NodeRow>,
): Promise<NodeRow | null> {
  let cursor = byId.get(nodeId)
  while (cursor) {
    if (cursor.node_type === ancestorType) return cursor
    if (!cursor.parent_id) return null
    cursor = byId.get(cursor.parent_id)
  }
  return null
}

async function main() {
  const admin = adminClient()

  console.log('=== Shadow Protocol context relink ===\n')

  // Resolve user → org → project.
  const { data: users } = await admin.auth.admin.listUsers({ perPage: 200 })
  const user = (users?.users ?? []).find((u) => u.email === TEST_EMAIL)
  if (!user) {
    console.error(`error: ${TEST_EMAIL} not found`)
    process.exit(1)
  }
  const { data: org } = await admin
    .from('organisation_members')
    .select('organisation_id')
    .eq('user_id', user.id)
    .single()
  const { data: project } = await admin
    .from('projects')
    .select('id')
    .eq('organisation_id', org!.organisation_id)
    .eq('name', 'Shadow Protocol')
    .single()
  if (!project) {
    console.error('error: Shadow Protocol project not found')
    process.exit(1)
  }
  console.log(`project: ${project.id.slice(0, 8)}…`)

  // Load all nodes for the project.
  const { data: nodesRaw } = await admin
    .from('nodes')
    .select('id, parent_id, node_category, node_type, depth, name, prose')
    .eq('project_id', project.id)
  const nodes: NodeRow[] = nodesRaw as unknown as NodeRow[]
  const byId = new Map<string, NodeRow>()
  for (const n of nodes) byId.set(n.id, n)
  console.log(`nodes loaded: ${nodes.length}`)

  // Partition into structural + context.
  const structural = nodes.filter((n) => n.node_category === 'structural')
  const context = nodes.filter((n) => n.node_category === 'context')
  const beats = structural.filter((n) => n.node_type === 'beat' && n.prose != null)
  const acts = structural.filter((n) => n.node_type === 'act')
  const book = structural.find((n) => n.node_type === 'book')
  console.log(`structural: ${structural.length}, context: ${context.length}, beats-with-prose: ${beats.length}, acts: ${acts.length}\n`)

  // Step 1: delete existing context links for this project.
  const { error: delError, count: deleted } = await admin
    .from('node_context_links')
    .delete({ count: 'exact' })
    .in('source_node_id', structural.map((n) => n.id))
  if (delError) {
    console.error('error: failed to clear existing links:', delError.message)
    process.exit(1)
  }
  console.log(`existing links deleted: ${deleted ?? 0}\n`)

  // Step 2: build new links.
  const links: Array<{ source: string; target: string; reason: string }> = []
  const dedup = new Set<string>()

  function addLink(sourceId: string, targetId: string, reason: string) {
    const key = `${sourceId}|${targetId}`
    if (dedup.has(key)) return
    dedup.add(key)
    links.push({ source: sourceId, target: targetId, reason })
  }

  // Pre-cache beat plain texts to avoid recomputing.
  const beatText = new Map<string, string>()
  for (const beat of beats) {
    beatText.set(beat.id, proseToText(beat.prose).toLowerCase())
  }

  // Characters → CHAPTER (de-duped per chapter)
  // Locations → SCENE (de-duped per scene)
  for (const ctx of context) {
    if (ctx.node_type !== 'character' && ctx.node_type !== 'location') continue
    if (!ctx.name) continue
    const aliases = ALIASES[ctx.name] ?? [ctx.name.toLowerCase().split(' ')[0]]
    const targetAncestorType = ctx.node_type === 'character' ? 'chapter' : 'scene'
    let hits = 0
    for (const beat of beats) {
      const text = beatText.get(beat.id) ?? ''
      if (aliases.some((a) => text.includes(a))) {
        const ancestor = await findAncestor(beat.id, targetAncestorType, byId)
        if (ancestor) {
          addLink(ancestor.id, ctx.id, `${ctx.node_type} mention`)
          hits++
        }
      }
    }
    console.log(`  ${ctx.node_type.padEnd(8)} "${ctx.name}": ${hits} beat mentions → ${aliases.length} aliases`)
  }

  // Plot threads → ALL acts
  for (const ctx of context.filter((c) => c.node_type === 'plot_thread')) {
    for (const act of acts) {
      addLink(act.id, ctx.id, 'plot_thread → all acts')
    }
  }
  console.log(`  plot_thread: linked to all ${acts.length} acts each (${context.filter((c) => c.node_type === 'plot_thread').length} threads)`)

  // Themes → ALL acts
  for (const ctx of context.filter((c) => c.node_type === 'theme')) {
    for (const act of acts) {
      addLink(act.id, ctx.id, 'theme → all acts')
    }
  }
  console.log(`  theme:       linked to all ${acts.length} acts each (${context.filter((c) => c.node_type === 'theme').length} themes)`)

  // World → BOOK root only (single link)
  for (const ctx of context.filter((c) => c.node_type === 'world')) {
    if (book) addLink(book.id, ctx.id, 'world → book')
  }
  console.log(`  world:       linked to book root (${context.filter((c) => c.node_type === 'world').length} world nodes)\n`)

  // Step 3: insert.
  console.log(`total new links to insert: ${links.length}\n`)
  const { error: insError, count: inserted } = await admin
    .from('node_context_links')
    .insert(
      links.map((l) => ({
        organisation_id: org!.organisation_id,
        source_node_id: l.source,
        target_node_id: l.target,
        link_type: 'structural_to_context' as const,
      })),
      { count: 'exact' },
    )
  if (insError) {
    console.error('error: insert failed:', insError.message)
    process.exit(1)
  }
  console.log(`links inserted: ${inserted}\n`)

  // Step 4: report per-context summary.
  const perContext = new Map<string, number>()
  for (const l of links) {
    perContext.set(l.target, (perContext.get(l.target) ?? 0) + 1)
  }
  console.log('=== per-context-node link counts ===')
  for (const ctx of context) {
    const count = perContext.get(ctx.id) ?? 0
    console.log(`  ${ctx.node_type.padEnd(12)} ${(ctx.name ?? '?').slice(0, 40).padEnd(42)} ${count} links`)
  }
}

main().catch((err) => {
  console.error('\nrelink failed:')
  console.error(err)
  process.exit(1)
})
