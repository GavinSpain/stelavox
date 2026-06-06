// Phase 8.01.E wireframe-review — data-path regression guard for the
// getStructuralOverview server helper.
//
// The pre-fix bug: the helper selected `is_leaf` from `nodes` (column
// doesn't exist) and assigned each ChildSummary.isLeaf from r.is_leaf.
// Result: silent empty overview on every non-leaf detail-pane mount.
//
// These tests assert:
//   T-1  the helper does NOT include is_leaf in the nodes SELECT
//   T-2  it DOES query `layer_stacks` to resolve max-index for the doc
//   T-3  isLeaf is true iff layer_index === doc's max
//   T-4  children with no rows → empty overview, no layer_stacks query
//   T-5  draftedPct + totals are computed correctly across children

import { describe, expect, it } from 'vitest'

import { getStructuralOverview } from '@/lib/project/getStructuralOverview'

interface ChildRow {
  id: string
  node_type: string
  order: number
  name: string | null
  status: string
  layer_index: number | null
  document_id: string
  word_count_actual: number | null
  word_count_target: number | null
}

function mockSupabase(opts: {
  children: ChildRow[]
  layerStacks: Array<{ document_id: string; layers: unknown }>
}) {
  const selectCalls: Array<{ table: string; cols: string }> = []
  const tablesQueried = new Set<string>()
  const eqCalls: Array<{ table: string; col: string; val: unknown }> = []

  function client() {
    return {
      from(table: string) {
        tablesQueried.add(table)
        if (table === 'nodes') return nodesChain(opts.children, selectCalls, eqCalls)
        if (table === 'layer_stacks') return layerStackChain(opts.layerStacks, eqCalls)
        throw new Error(`unexpected table: ${table}`)
      },
    }
  }
  return { client: client(), selectCalls, tablesQueried, eqCalls }
}

function nodesChain(
  rows: ChildRow[],
  selectCalls: Array<{ table: string; cols: string }>,
  eqCalls: Array<{ table: string; col: string; val: unknown }>,
) {
  const chain = {
    select(cols: string) {
      selectCalls.push({ table: 'nodes', cols })
      return chain
    },
    eq(col: string, val: unknown) {
      eqCalls.push({ table: 'nodes', col, val })
      return chain
    },
    order() { return chain },
    returns() {
      // chain still needs to be thenable
      return chain
    },
    then(resolve: (v: { data: ChildRow[]; error: null }) => void) {
      resolve({ data: rows, error: null })
    },
  }
  return chain
}

function layerStackChain(
  rows: Array<{ document_id: string; layers: unknown }>,
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

function child(opts: {
  id: string
  layer: number
  doc?: string
  type?: string
  order?: number
  status?: string
  actual?: number
  target?: number
}): ChildRow {
  return {
    id: opts.id,
    node_type: opts.type ?? 'beat',
    order: opts.order ?? 0,
    name: null,
    status: opts.status ?? 'draft',
    layer_index: opts.layer,
    document_id: opts.doc ?? 'doc-1',
    word_count_actual: opts.actual ?? null,
    word_count_target: opts.target ?? null,
  }
}

describe('getStructuralOverview — H-15 data-path regression guards', () => {
  it('T-1 nodes SELECT excludes is_leaf column (H-15: column does not exist)', async () => {
    const { client, selectCalls } = mockSupabase({
      children: [child({ id: 'b1', layer: 4 })],
      layerStacks: [{ document_id: 'doc-1', layers: LEAF_LAYERS_5 }],
    })
    await getStructuralOverview(client as never, 'parent-1')
    const nodeSelect = selectCalls.find((c) => c.table === 'nodes')
    expect(nodeSelect).toBeDefined()
    expect(nodeSelect!.cols).not.toContain('is_leaf')
    // Must include the fields the layer-stack derivation needs:
    expect(nodeSelect!.cols).toContain('layer_index')
    expect(nodeSelect!.cols).toContain('document_id')
  })

  it('T-2 resolves max-layer-index via layer_stacks for the children’s document', async () => {
    const { client, tablesQueried, eqCalls } = mockSupabase({
      children: [child({ id: 'b1', layer: 4, doc: 'doc-1' })],
      layerStacks: [{ document_id: 'doc-1', layers: LEAF_LAYERS_5 }],
    })
    await getStructuralOverview(client as never, 'parent-1')
    expect(tablesQueried.has('layer_stacks')).toBe(true)
    expect(
      eqCalls.some(
        (c) => c.table === 'layer_stacks' && c.col === 'is_template' && c.val === false,
      ),
    ).toBe(true)
  })

  it('T-3 isLeaf is true iff layer_index === doc max', async () => {
    const { client } = mockSupabase({
      children: [
        child({ id: 'c1', layer: 3 }), // scene — not a leaf
        child({ id: 'b1', layer: 4 }), // beat — leaf
        child({ id: 'b2', layer: 4 }), // beat — leaf
      ],
      layerStacks: [{ document_id: 'doc-1', layers: LEAF_LAYERS_5 }],
    })
    const out = await getStructuralOverview(client as never, 'parent-1')
    const byId = Object.fromEntries(out.children.map((c) => [c.id, c.isLeaf]))
    expect(byId['c1']).toBe(false)
    expect(byId['b1']).toBe(true)
    expect(byId['b2']).toBe(true)
  })

  it('T-4 no children → empty overview, no layer_stacks query needed', async () => {
    const { client, tablesQueried } = mockSupabase({
      children: [],
      layerStacks: [],
    })
    const out = await getStructuralOverview(client as never, 'parent-1')
    expect(out.children).toEqual([])
    expect(out.childCount).toBe(0)
    expect(out.draftedPct).toBeNull()
    // Optimisation: skip the layer_stacks round-trip when there's
    // nothing to decorate.
    expect(tablesQueried.has('layer_stacks')).toBe(false)
  })

  it('T-5 totals + draftedPct computed across all children regardless of leaf-ness', async () => {
    const { client } = mockSupabase({
      children: [
        child({ id: 'b1', layer: 4, actual: 250, target: 500 }),
        child({ id: 'b2', layer: 4, actual: 100, target: 500 }),
        child({ id: 'c1', layer: 3, actual: 50, target: 0 }), // intermediate; counts in totals
      ],
      layerStacks: [{ document_id: 'doc-1', layers: LEAF_LAYERS_5 }],
    })
    const out = await getStructuralOverview(client as never, 'parent-1')
    expect(out.totalWordsActual).toBe(400)
    expect(out.totalWordsTarget).toBe(1000)
    expect(out.draftedPct).toBe(40)
  })

  it('T-6 missing layer_stacks row → no row qualifies as leaf (degrades gracefully)', async () => {
    const { client } = mockSupabase({
      children: [child({ id: 'b1', layer: 4 })],
      layerStacks: [], // no layer_stack row matches doc-1
    })
    const out = await getStructuralOverview(client as never, 'parent-1')
    expect(out.children[0].isLeaf).toBe(false)
  })
})
