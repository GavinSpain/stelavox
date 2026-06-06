// Phase 8.01.D wireframe-review — data-path regression guard for the
// getProjectAggregates server helper.
//
// The pre-fix bug: `.eq('is_leaf', true)` in the project-grid word-count
// aggregation. Silently swallowed → every ProjectCard reported
// wordsDrafted=0 and wordsTarget=0 regardless of state.
//
// These tests assert:
//   T-1  the helper does NOT query `.eq('is_leaf', ...)` on `nodes`
//   T-2  it DOES query `layer_stacks` for max-index resolution
//   T-3  leaf rows drive wordsDrafted / wordsTarget
//   T-4  non-leaf rows are correctly excluded from word totals
//   T-5  rows still drive lastUpdatedAt regardless of leaf-ness
//   T-6  document counts come from `documents`, not from inference

import { describe, expect, it } from 'vitest'

import { getProjectAggregates } from '@/lib/dashboard/projectAggregates'

interface NodeRow {
  project_id: string
  document_id: string
  parent_id: string | null
  word_count_actual: number | null
  word_count_target: number | null
  updated_at: string
  layer_index: number | null
}
interface DocRow {
  id: string
  project_id: string
}
interface ProjectRow {
  id: string
  name: string
  description: string | null
  default_document_type: string | null
  metadata: Record<string, unknown> | null
}
interface LayerStackRow {
  document_id: string
  layers: unknown
}

function mockSupabase(opts: {
  projects: ProjectRow[]
  documents: DocRow[]
  nodes: NodeRow[]
  layerStacks: LayerStackRow[]
}) {
  const eqCalls: Array<{ table: string; col: string; val: unknown }> = []
  const tablesQueried = new Set<string>()

  function client() {
    return {
      from(table: string) {
        tablesQueried.add(table)
        if (table === 'projects') return projectsChain(opts.projects, eqCalls)
        if (table === 'documents') return docsChain(opts.documents, eqCalls)
        if (table === 'nodes') return nodesChain(opts.nodes, eqCalls)
        if (table === 'layer_stacks') return layerStackChain(opts.layerStacks, eqCalls)
        throw new Error(`unexpected table: ${table}`)
      },
    }
  }
  return { client: client(), eqCalls, tablesQueried }
}

function projectsChain(
  rows: ProjectRow[],
  eqCalls: Array<{ table: string; col: string; val: unknown }>,
) {
  const chain = {
    select() { return chain },
    eq(col: string, val: unknown) { eqCalls.push({ table: 'projects', col, val }); return chain },
    order() { return chain },
    returns() { return chain },
    then(resolve: (v: { data: ProjectRow[]; error: null }) => void) {
      resolve({ data: rows, error: null })
    },
  }
  return chain
}

function docsChain(
  rows: DocRow[],
  eqCalls: Array<{ table: string; col: string; val: unknown }>,
) {
  const chain = {
    select() { return chain },
    in() { return chain },
    eq(col: string, val: unknown) { eqCalls.push({ table: 'documents', col, val }); return chain },
    returns() { return chain },
    then(resolve: (v: { data: DocRow[]; error: null }) => void) {
      resolve({ data: rows, error: null })
    },
  }
  return chain
}

function nodesChain(
  rows: NodeRow[],
  eqCalls: Array<{ table: string; col: string; val: unknown }>,
) {
  const chain = {
    select() { return chain },
    in() { return chain },
    eq(col: string, val: unknown) { eqCalls.push({ table: 'nodes', col, val }); return chain },
    returns() { return chain },
    then(resolve: (v: { data: NodeRow[]; error: null }) => void) {
      resolve({ data: rows, error: null })
    },
  }
  return chain
}

function layerStackChain(
  rows: LayerStackRow[],
  eqCalls: Array<{ table: string; col: string; val: unknown }>,
) {
  const chain = {
    select() { return chain },
    in() { return chain },
    eq(col: string, val: unknown) {
      eqCalls.push({ table: 'layer_stacks', col, val })
      return Promise.resolve({ data: rows, error: null })
    },
  }
  return chain
}

const LEAF_LAYERS_5 = [
  { index: 0 }, { index: 1 }, { index: 2 }, { index: 3 }, { index: 4 },
] // max = 4

function project(id: string, name: string, metadata: Record<string, unknown> = {}): ProjectRow {
  return {
    id, name, description: null, default_document_type: 'novel', metadata,
  }
}

function node(opts: {
  proj: string
  doc: string
  layer: number
  actual?: number
  target?: number
  updated?: string
  /** Pass null to mark this as a root structural node (no parent).
   *  Defaults to a synthetic non-null id so the row is treated as a
   *  non-root. */
  parent?: string | null
}): NodeRow {
  return {
    project_id: opts.proj,
    document_id: opts.doc,
    parent_id: opts.parent === undefined ? `synthetic-parent-${opts.doc}` : opts.parent,
    word_count_actual: opts.actual ?? null,
    word_count_target: opts.target ?? null,
    updated_at: opts.updated ?? '2026-05-01T00:00:00Z',
    layer_index: opts.layer,
  }
}

describe('getProjectAggregates — H-15 data-path regression guards', () => {
  it('T-1 never filters nodes by is_leaf column (H-15: column does not exist)', async () => {
    const { client, eqCalls } = mockSupabase({
      projects: [project('p1', 'Project One')],
      documents: [{ id: 'd1', project_id: 'p1' }],
      nodes: [node({ proj: 'p1', doc: 'd1', layer: 4, actual: 100, target: 200 })],
      layerStacks: [{ document_id: 'd1', layers: LEAF_LAYERS_5 }],
    })
    await getProjectAggregates(client as never, 'org-1')
    const nodeIsLeafEqs = eqCalls.filter((c) => c.table === 'nodes' && c.col === 'is_leaf')
    expect(nodeIsLeafEqs).toEqual([])
  })

  it('T-2 resolves max-layer-index via layer_stacks (is_template=false)', async () => {
    const { client, eqCalls, tablesQueried } = mockSupabase({
      projects: [project('p1', 'Project One')],
      documents: [{ id: 'd1', project_id: 'p1' }],
      nodes: [node({ proj: 'p1', doc: 'd1', layer: 4 })],
      layerStacks: [{ document_id: 'd1', layers: LEAF_LAYERS_5 }],
    })
    await getProjectAggregates(client as never, 'org-1')
    expect(tablesQueried.has('layer_stacks')).toBe(true)
    expect(
      eqCalls.some(
        (c) => c.table === 'layer_stacks' && c.col === 'is_template' && c.val === false,
      ),
    ).toBe(true)
  })

  it('T-3 leaf rows drive wordsDrafted / wordsTarget', async () => {
    const { client } = mockSupabase({
      projects: [project('p1', 'P1')],
      documents: [{ id: 'd1', project_id: 'p1' }],
      nodes: [
        node({ proj: 'p1', doc: 'd1', layer: 4, actual: 250, target: 500 }),
        node({ proj: 'p1', doc: 'd1', layer: 4, actual: 100, target: 200 }),
      ],
      layerStacks: [{ document_id: 'd1', layers: LEAF_LAYERS_5 }],
    })
    const out = await getProjectAggregates(client as never, 'org-1')
    expect(out).toHaveLength(1)
    expect(out[0].wordsDrafted).toBe(350)
    expect(out[0].wordsTarget).toBe(700)
  })

  it('T-4 non-leaf rows are excluded from word totals (layer_index < max)', async () => {
    const { client } = mockSupabase({
      projects: [project('p1', 'P1')],
      documents: [{ id: 'd1', project_id: 'p1' }],
      nodes: [
        node({ proj: 'p1', doc: 'd1', layer: 4, actual: 250, target: 500 }), // leaf
        node({ proj: 'p1', doc: 'd1', layer: 1, actual: 9999, target: 9999 }), // act — must NOT count
        node({ proj: 'p1', doc: 'd1', layer: 2, actual: 7777, target: 7777 }), // chapter — must NOT count
      ],
      layerStacks: [{ document_id: 'd1', layers: LEAF_LAYERS_5 }],
    })
    const out = await getProjectAggregates(client as never, 'org-1')
    expect(out[0].wordsDrafted).toBe(250)
    expect(out[0].wordsTarget).toBe(500)
  })

  it('T-5 non-leaf rows still drive lastUpdatedAt (leaf filter is for word counts only)', async () => {
    const { client } = mockSupabase({
      projects: [project('p1', 'P1')],
      documents: [{ id: 'd1', project_id: 'p1' }],
      nodes: [
        node({ proj: 'p1', doc: 'd1', layer: 4, updated: '2026-05-01T00:00:00Z' }), // leaf
        node({ proj: 'p1', doc: 'd1', layer: 1, updated: '2026-05-30T00:00:00Z' }), // act, more recent
      ],
      layerStacks: [{ document_id: 'd1', layers: LEAF_LAYERS_5 }],
    })
    const out = await getProjectAggregates(client as never, 'org-1')
    expect(out[0].lastUpdatedAt).toBe('2026-05-30T00:00:00Z')
  })

  it('T-6 documentCount is computed from `documents` rows, not from node inference', async () => {
    const { client } = mockSupabase({
      projects: [project('p1', 'P1')],
      documents: [
        { id: 'd1', project_id: 'p1' },
        { id: 'd2', project_id: 'p1' },
      ],
      nodes: [],
      layerStacks: [],
    })
    const out = await getProjectAggregates(client as never, 'org-1')
    expect(out[0].documentCount).toBe(2)
  })

  it('T-7 nodes spanning multiple docs use each doc’s own max layer-index', async () => {
    // d1 max=4 (5-layer novel), d2 max=2 (3-layer short story).
    // Both layer-2 rows are leaves only for d2.
    const { client } = mockSupabase({
      projects: [project('p1', 'Mixed')],
      documents: [
        { id: 'd1', project_id: 'p1' },
        { id: 'd2', project_id: 'p1' },
      ],
      nodes: [
        node({ proj: 'p1', doc: 'd1', layer: 4, actual: 100, target: 100 }), // d1 leaf
        node({ proj: 'p1', doc: 'd1', layer: 2, actual: 999, target: 999 }), // d1 non-leaf
        node({ proj: 'p1', doc: 'd2', layer: 2, actual: 50, target: 80 }),   // d2 leaf
      ],
      layerStacks: [
        { document_id: 'd1', layers: LEAF_LAYERS_5 },
        { document_id: 'd2', layers: [{ index: 0 }, { index: 1 }, { index: 2 }] },
      ],
    })
    const out = await getProjectAggregates(client as never, 'org-1')
    expect(out[0].wordsDrafted).toBe(100 + 50)
    expect(out[0].wordsTarget).toBe(100 + 80)
  })

  // Phase 8.01 round-3 follow-up — wordsTarget now comes from root nodes
  // (parent_id === null), with the leaf-target sum as a fallback.

  it('T-8 root-node target wins over the leaf-target sum', async () => {
    // Book root carries target=120000; leaves only sum to 500.
    // Real-world: the author has outlined the planned size but hasn't
    // fleshed out most chapters/scenes/beats yet.
    const { client } = mockSupabase({
      projects: [project('p1', 'Sparse outline')],
      documents: [{ id: 'd1', project_id: 'p1' }],
      nodes: [
        node({ proj: 'p1', doc: 'd1', layer: 0, target: 120000, parent: null }), // root
        node({ proj: 'p1', doc: 'd1', layer: 4, actual: 250, target: 200 }),     // leaf
        node({ proj: 'p1', doc: 'd1', layer: 4, actual: 250, target: 300 }),     // leaf
      ],
      layerStacks: [{ document_id: 'd1', layers: LEAF_LAYERS_5 }],
    })
    const out = await getProjectAggregates(client as never, 'org-1')
    expect(out[0].wordsDrafted).toBe(500)
    expect(out[0].wordsTarget).toBe(120000) // root target, NOT 500
  })

  it('T-9 falls back to leaf-target sum when no root carries a target', async () => {
    const { client } = mockSupabase({
      projects: [project('p1', 'No root target')],
      documents: [{ id: 'd1', project_id: 'p1' }],
      nodes: [
        node({ proj: 'p1', doc: 'd1', layer: 0, target: 0, parent: null }), // root with no target
        node({ proj: 'p1', doc: 'd1', layer: 4, actual: 100, target: 200 }),
        node({ proj: 'p1', doc: 'd1', layer: 4, actual: 50, target: 100 }),
      ],
      layerStacks: [{ document_id: 'd1', layers: LEAF_LAYERS_5 }],
    })
    const out = await getProjectAggregates(client as never, 'org-1')
    expect(out[0].wordsTarget).toBe(300) // fallback to leaf sum
  })

  it('T-10 a Series-of-Novels root sums book roots? No — root means parent_id IS NULL', async () => {
    // For a Series document, the Series node itself (parent_id IS NULL)
    // is the root. Per-Book non-root targets are NOT summed into
    // wordsTarget — only nodes whose parent_id IS NULL contribute.
    const { client } = mockSupabase({
      projects: [project('p1', 'Series')],
      documents: [{ id: 'd1', project_id: 'p1' }],
      nodes: [
        node({ proj: 'p1', doc: 'd1', layer: 0, target: 500000, parent: null }), // Series root
        node({ proj: 'p1', doc: 'd1', layer: 1, target: 120000 }),               // Book 1 (parent=Series)
        node({ proj: 'p1', doc: 'd1', layer: 1, target: 130000 }),               // Book 2
        node({ proj: 'p1', doc: 'd1', layer: 4, actual: 200, target: 200 }),     // leaf
      ],
      layerStacks: [{ document_id: 'd1', layers: LEAF_LAYERS_5 }],
    })
    const out = await getProjectAggregates(client as never, 'org-1')
    // Only the Series root's target counts, not the books'.
    expect(out[0].wordsTarget).toBe(500000)
  })

  it('T-11 multi-document project — sums each document\'s root target', async () => {
    const { client } = mockSupabase({
      projects: [project('p1', 'Two docs')],
      documents: [
        { id: 'd1', project_id: 'p1' },
        { id: 'd2', project_id: 'p1' },
      ],
      nodes: [
        node({ proj: 'p1', doc: 'd1', layer: 0, target: 120000, parent: null }), // d1 root
        node({ proj: 'p1', doc: 'd1', layer: 4, actual: 100, target: 100 }),     // d1 leaf
        node({ proj: 'p1', doc: 'd2', layer: 0, target: 80000, parent: null }),  // d2 root
        node({ proj: 'p1', doc: 'd2', layer: 4, actual: 50, target: 50 }),       // d2 leaf
      ],
      layerStacks: [
        { document_id: 'd1', layers: LEAF_LAYERS_5 },
        { document_id: 'd2', layers: LEAF_LAYERS_5 },
      ],
    })
    const out = await getProjectAggregates(client as never, 'org-1')
    expect(out[0].wordsTarget).toBe(200000) // 120k + 80k
  })
})
