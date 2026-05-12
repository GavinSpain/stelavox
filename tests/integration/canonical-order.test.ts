// V1.x-LB B1 regression — get_nodes_by_layer returns canonical depth-first order.
//
// The 2026-05-10 launch test surfaced that the Director's
// `get_nodes_by_layer` tool returned scenes ordered by intra-parent
// `"order"` integer only, with implementation-defined cross-parent
// tiebreak. A "next 10 scenes" batch landed at canonical positions
// {39, 46, 47, 77, 83, 84, 89, 90, 95, 109} — scattered, not contiguous.
//
// Fix: Migration 047 adds a `nodes_canonical` VIEW exposing an
// `ordinal_path INTEGER[]` column. Ordering by ordinal_path produces
// canonical depth-first order. `execGetNodesByLayer` now sources from
// the VIEW.
//
// This test forces the bug condition by inserting scenes in a
// non-canonical creation order (clustered by scene-index, not
// canonically by act → chapter → scene). Before the fix, a query
// ordered only by `"order"` would have returned them clustered by
// `"order"` value. After the fix, they come back in canonical depth-
// first order.
//
// Runs against the local Supabase admin client. Skipped automatically
// when SUPABASE_SERVICE_ROLE_KEY is missing (CI safe).

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/types/database'
import { execGetDocumentState, execGetNodesByLayer } from '@/lib/director/tools/read'
import type { DirectorSession } from '@/lib/director/types'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const hasLocalDb = Boolean(SUPABASE_URL && SUPABASE_SERVICE_KEY)

// Tree shape — 3 acts × 4 chapters × 3 scenes = 36 scenes (plus 1 book +
// 3 acts + 12 chapters). Multi-act and multi-chapter so the canonical
// order is non-trivially distinct from intra-parent order.
const ACTS = 3
const CHAPTERS_PER_ACT = 4
const SCENES_PER_CHAPTER = 3

let admin: SupabaseClient<Database>
let testOrgId: string
let testProjectId: string
let testDocumentId: string
let bookNodeId: string
// Map from canonical-tuple key ("a:1,c:1,s:1") to inserted scene id.
const sceneIds = new Map<string, string>()

const directorSession = (): DirectorSession => ({
  conversation_id: '00000000-0000-0000-0000-000000000000',
  document_id: testDocumentId,
  organisation_id: testOrgId,
  user_id: '00000000-0000-0000-0000-000000000000',
})

beforeAll(async () => {
  if (!hasLocalDb) return
  admin = createClient<Database>(SUPABASE_URL!, SUPABASE_SERVICE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  // Pick a seeded user. Same pattern as tests/integration/db-constraints.test.ts.
  const { data: users } = await admin.auth.admin.listUsers({ perPage: 200 })
  const user =
    users?.users?.find((u) => u.email === 'test-a@example.com') ??
    users?.users?.find((u) => u.email === 'j5-walk@example.com') ??
    users?.users?.[0]
  if (!user) throw new Error('no seeded user found; run scripts/seed-director-fixture.ts or Playwright globalSetup first')

  const { data: member } = await admin
    .from('organisation_members')
    .select('organisation_id')
    .eq('user_id', user.id)
    .maybeSingle()
  if (!member) throw new Error('seeded user has no organisation_members row')
  testOrgId = member.organisation_id

  // Fresh project + document for isolation.
  const { data: proj, error: projErr } = await admin
    .from('projects')
    .insert({ organisation_id: testOrgId, name: `canonical-order-test-${Date.now()}` })
    .select('id')
    .single()
  if (projErr || !proj) throw new Error(`project create failed: ${projErr?.message}`)
  testProjectId = proj.id

  const { data: docRpc, error: docErr } = await admin.rpc('create_document_with_layer_stack', {
    p_project_id: testProjectId,
    p_organisation_id: testOrgId,
    p_name: 'canonical-order-test',
    p_description: '',
    p_document_type: 'novel',
    p_authors: [],
  })
  if (docErr) throw new Error(`document create failed: ${docErr.message}`)
  testDocumentId = (docRpc as unknown as { document: { id: string } }).document.id

  // The RPC creates a root book node. Find it.
  const { data: book } = await admin
    .from('nodes')
    .select('id')
    .eq('document_id', testDocumentId)
    .eq('node_type', 'book')
    .single()
  if (!book) throw new Error('book root not found after document RPC')
  bookNodeId = book.id

  // ─── Build the tree ─────────────────────────────────────────────────
  // Pass 1: acts (canonical order)
  const actIds: string[] = []
  for (let a = 1; a <= ACTS; a++) {
    const { data, error } = await admin
      .from('nodes')
      .insert({
        organisation_id: testOrgId,
        project_id: testProjectId,
        document_id: testDocumentId,
        parent_id: bookNodeId,
        order: a,
        depth: 1,
        layer_index: 1,
        node_type: 'act',
        node_category: 'structural',
        name: `Act ${a}`,
      })
      .select('id')
      .single()
    if (error || !data) throw new Error(`act ${a} insert failed: ${error?.message}`)
    actIds.push(data.id)
  }

  // Pass 2: chapters (canonical order under each act)
  const chapterIds: string[][] = [] // chapterIds[a-1][c-1]
  for (let a = 1; a <= ACTS; a++) {
    chapterIds.push([])
    for (let c = 1; c <= CHAPTERS_PER_ACT; c++) {
      const { data, error } = await admin
        .from('nodes')
        .insert({
          organisation_id: testOrgId,
          project_id: testProjectId,
          document_id: testDocumentId,
          parent_id: actIds[a - 1]!,
          order: c,
          depth: 2,
          layer_index: 2,
          node_type: 'chapter',
          node_category: 'structural',
          name: `Ch ${a}.${c}`,
        })
        .select('id')
        .single()
      if (error || !data) throw new Error(`chapter ${a}.${c} insert failed: ${error?.message}`)
      chapterIds[a - 1]!.push(data.id)
    }
  }

  // Pass 3: scenes (NON-CANONICAL creation order to force the bug condition).
  // Outer loop = scene index → all "scene 1"s first, then "scene 2"s, etc.
  // This guarantees that two scenes share `"order" = s` but live under
  // different chapters; the buggy query (order by `"order"` only) would
  // cluster them by `"order"` value, not canonically by act → chapter → scene.
  for (let s = 1; s <= SCENES_PER_CHAPTER; s++) {
    for (let a = 1; a <= ACTS; a++) {
      for (let c = 1; c <= CHAPTERS_PER_ACT; c++) {
        const { data, error } = await admin
          .from('nodes')
          .insert({
            organisation_id: testOrgId,
            project_id: testProjectId,
            document_id: testDocumentId,
            parent_id: chapterIds[a - 1]![c - 1]!,
            order: s,
            depth: 3,
            layer_index: 3,
            node_type: 'scene',
            node_category: 'structural',
            name: `Sc ${a}.${c}.${s}`,
          })
          .select('id')
          .single()
        if (error || !data) throw new Error(`scene ${a}.${c}.${s} insert failed: ${error?.message}`)
        sceneIds.set(`${a}.${c}.${s}`, data.id)
      }
    }
  }
})

afterAll(async () => {
  if (!hasLocalDb || !testProjectId) return
  await admin.from('projects').delete().eq('id', testProjectId)
})

describe.skipIf(!hasLocalDb)('V1.x-LB B1 — get_nodes_by_layer returns canonical depth-first order', () => {
  it('returns scenes in (act, chapter, scene) canonical order', async () => {
    const result = await execGetNodesByLayer({ layer_index: 3 }, directorSession())

    if (!result.ok) {
      throw new Error(`execGetNodesByLayer failed: ${(result as { error: string }).error}`)
    }
    const nodes = (result.data as { nodes: Array<{ id: string; name: string }> }).nodes
    expect(nodes).toHaveLength(ACTS * CHAPTERS_PER_ACT * SCENES_PER_CHAPTER)

    // Build the expected canonical sequence of scene ids.
    const expected: string[] = []
    for (let a = 1; a <= ACTS; a++) {
      for (let c = 1; c <= CHAPTERS_PER_ACT; c++) {
        for (let s = 1; s <= SCENES_PER_CHAPTER; s++) {
          expected.push(sceneIds.get(`${a}.${c}.${s}`)!)
        }
      }
    }

    const actualIds = nodes.map((n) => n.id)
    expect(actualIds).toEqual(expected)

    // Sanity check the human-readable names too — `Sc 1.1.1`, `Sc 1.1.2`,
    // `Sc 1.1.3`, `Sc 1.2.1`, ... in lexicographic-on-tuple order.
    const actualNames = nodes.map((n) => n.name)
    const expectedNames: string[] = []
    for (let a = 1; a <= ACTS; a++) {
      for (let c = 1; c <= CHAPTERS_PER_ACT; c++) {
        for (let s = 1; s <= SCENES_PER_CHAPTER; s++) {
          expectedNames.push(`Sc ${a}.${c}.${s}`)
        }
      }
    }
    expect(actualNames).toEqual(expectedNames)
  })

  it('returns scenes within a single chapter in scene-order (parent_node_id filter)', async () => {
    // Scoping to a single chapter — the legacy code path also worked
    // for this case because there's no cross-parent contention. This
    // is a regression guard against accidentally breaking intra-parent
    // order when fixing cross-parent order.
    const chapter11ParentScenes = Array.from(sceneIds.entries())
      .filter(([k]) => k.startsWith('1.1.'))
      .map(([, v]) => v)

    // Find Ch 1.1's id.
    const { data: ch11 } = await admin
      .from('nodes')
      .select('id')
      .eq('document_id', testDocumentId)
      .eq('name', 'Ch 1.1')
      .single()
    if (!ch11) throw new Error('Ch 1.1 not found')

    const result = await execGetNodesByLayer(
      { layer_index: 3, parent_node_id: ch11.id },
      directorSession(),
    )
    if (!result.ok) throw new Error(`execGetNodesByLayer failed`)
    const nodes = (result.data as { nodes: Array<{ id: string }> }).nodes
    expect(nodes.map((n) => n.id)).toEqual(chapter11ParentScenes)
  })

  it('returns chapters in (act, chapter) canonical order across all acts', async () => {
    const result = await execGetNodesByLayer({ layer_index: 2 }, directorSession())
    if (!result.ok) throw new Error(`execGetNodesByLayer failed`)
    const nodes = (result.data as { nodes: Array<{ name: string }> }).nodes
    expect(nodes).toHaveLength(ACTS * CHAPTERS_PER_ACT)

    const expectedNames: string[] = []
    for (let a = 1; a <= ACTS; a++) {
      for (let c = 1; c <= CHAPTERS_PER_ACT; c++) {
        expectedNames.push(`Ch ${a}.${c}`)
      }
    }
    expect(nodes.map((n) => n.name)).toEqual(expectedNames)
  })

  it('canonical contiguity — any contiguous slice of N scenes is a contiguous canonical range', async () => {
    // The original launch-test bug surfaced as a non-contiguous slice
    // (positions 39, 46, 47, 77, 83, ...). This assertion encodes the
    // property the Director's "next 10 scenes" workflow assumed: the
    // first N nodes of the returned list cover canonical positions 1..N.
    const result = await execGetNodesByLayer({ layer_index: 3 }, directorSession())
    if (!result.ok) throw new Error(`execGetNodesByLayer failed`)
    const nodes = (result.data as { nodes: Array<{ name: string }> }).nodes

    // For any contiguous slice nodes[i..j], the implied (a, c, s) tuples
    // are strictly increasing in lexicographic order. We check via the
    // names, which encode the tuple as "Sc a.c.s".
    function tupleOf(name: string): [number, number, number] {
      const m = name.match(/Sc (\d+)\.(\d+)\.(\d+)/)
      if (!m) throw new Error(`unexpected scene name: ${name}`)
      return [Number(m[1]), Number(m[2]), Number(m[3])]
    }
    for (let i = 1; i < nodes.length; i++) {
      const prev = tupleOf(nodes[i - 1]!.name)
      const curr = tupleOf(nodes[i]!.name)
      const isStrictlyGreater =
        curr[0] > prev[0] ||
        (curr[0] === prev[0] && curr[1] > prev[1]) ||
        (curr[0] === prev[0] && curr[1] === prev[1] && curr[2] > prev[2])
      expect(isStrictlyGreater, `pair ${i - 1}→${i}: ${nodes[i - 1]!.name} → ${nodes[i]!.name}`).toBe(true)
    }
  })
})

// ─── B3 — get_document_state.progress.by_layer ──────────────────────────
//
// Expands the first 6 scenes in canonical order (Sc 1.1.1, 1.1.2, 1.1.3,
// Sc 1.2.1, 1.2.2, 1.2.3) by inserting beats under them. The seventh
// scene in canonical order is Sc 1.3.1, which must be reported as the
// next un-expanded scene.

const EXPANDED_SCENE_TUPLES: Array<[number, number, number]> = [
  [1, 1, 1], [1, 1, 2], [1, 1, 3],
  [1, 2, 1], [1, 2, 2], [1, 2, 3],
]
const FIRST_UNEXPANDED_TUPLE: [number, number, number] = [1, 3, 1]

describe.skipIf(!hasLocalDb)('V1.x-LB B3 — get_document_state.progress.by_layer', () => {
  beforeAll(async () => {
    if (!hasLocalDb) return
    // Insert one beat under each of the first 6 canonical scenes.
    for (const [a, c, s] of EXPANDED_SCENE_TUPLES) {
      const sceneId = sceneIds.get(`${a}.${c}.${s}`)!
      const { error } = await admin
        .from('nodes')
        .insert({
          organisation_id: testOrgId,
          project_id: testProjectId,
          document_id: testDocumentId,
          parent_id: sceneId,
          order: 1,
          depth: 4,
          layer_index: 4,
          node_type: 'beat',
          node_category: 'structural',
          name: `Bt ${a}.${c}.${s}.1`,
        })
      if (error) throw new Error(`beat insert failed for Sc ${a}.${c}.${s}: ${error.message}`)
    }
  })

  it('reports total_nodes and nodes_with_children per layer', async () => {
    const result = await execGetDocumentState({}, directorSession())
    if (!result.ok) throw new Error(`execGetDocumentState failed`)
    const data = result.data as {
      progress: {
        by_layer: Array<{
          layer_index: number
          total_nodes: number
          nodes_with_children: number
          is_leaf_layer: boolean
        }>
      }
    }
    const byIdx = new Map(data.progress.by_layer.map((l) => [l.layer_index, l]))

    // Layer 0 (book): 1 total, 1 with children (the 3 acts).
    expect(byIdx.get(0)).toMatchObject({ total_nodes: 1, nodes_with_children: 1 })
    // Layer 1 (acts): 3 total, 1 with children (Act 1 has chapters; Act 2 + 3
    // also have chapters — all three acts have children in our fixture).
    expect(byIdx.get(1)).toMatchObject({
      total_nodes: ACTS,
      nodes_with_children: ACTS,
    })
    // Layer 2 (chapters): 12 total, 12 with children (every chapter has 3 scenes).
    expect(byIdx.get(2)).toMatchObject({
      total_nodes: ACTS * CHAPTERS_PER_ACT,
      nodes_with_children: ACTS * CHAPTERS_PER_ACT,
    })
    // Layer 3 (scenes): 36 total, 6 with children (only the first 6 canonical
    // scenes have beats).
    expect(byIdx.get(3)).toMatchObject({
      total_nodes: ACTS * CHAPTERS_PER_ACT * SCENES_PER_CHAPTER,
      nodes_with_children: EXPANDED_SCENE_TUPLES.length,
    })
  })

  it('reports next_unexpanded for the scenes layer (Sc 1.3.1 at layer_rank 7)', async () => {
    const result = await execGetDocumentState({}, directorSession())
    if (!result.ok) throw new Error(`execGetDocumentState failed`)
    const data = result.data as {
      progress: {
        by_layer: Array<{
          layer_index: number
          next_unexpanded: {
            layer_rank: number
            node_id: string
            node_name: string | null
            canonical_position: number | null
          } | null
        }>
      }
    }
    const scenes = data.progress.by_layer.find((l) => l.layer_index === 3)
    expect(scenes?.next_unexpanded).not.toBeNull()
    expect(scenes?.next_unexpanded?.layer_rank).toBe(EXPANDED_SCENE_TUPLES.length + 1)

    const [a, c, s] = FIRST_UNEXPANDED_TUPLE
    expect(scenes?.next_unexpanded?.node_id).toBe(sceneIds.get(`${a}.${c}.${s}`))
    expect(scenes?.next_unexpanded?.node_name).toBe(`Sc ${a}.${c}.${s}`)
  })

  it('reports next_unexpanded === null for fully-expanded layers (chapters)', async () => {
    const result = await execGetDocumentState({}, directorSession())
    if (!result.ok) throw new Error(`execGetDocumentState failed`)
    const data = result.data as {
      progress: {
        by_layer: Array<{ layer_index: number; next_unexpanded: unknown }>
      }
    }
    const chapters = data.progress.by_layer.find((l) => l.layer_index === 2)
    expect(chapters?.next_unexpanded).toBeNull()
  })
})
