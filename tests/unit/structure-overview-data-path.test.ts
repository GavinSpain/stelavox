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

/** Pseudo-shape of the all-document-nodes query the helper now does
 *  for the descendant rollup. */
interface DescendantRow {
  id: string
  parent_id: string | null
  word_count_actual: number | null
}

function mockSupabase(opts: {
  children: ChildRow[]
  layerStacks: Array<{ document_id: string; layers: unknown }>
  /** All structural rows in the document (parent + children +
   *  grandchildren + …) used to compute aggregate actuals. Optional;
   *  empty when the test doesn't exercise the rollup. */
  allDocNodes?: DescendantRow[]
}) {
  const selectCalls: Array<{ table: string; cols: string }> = []
  const tablesQueried = new Set<string>()
  const eqCalls: Array<{ table: string; col: string; val: unknown }> = []

  function client() {
    return {
      from(table: string) {
        tablesQueried.add(table)
        if (table === 'nodes') {
          return nodesChain(opts.children, opts.allDocNodes ?? [], selectCalls, eqCalls)
        }
        if (table === 'layer_stacks') return layerStackChain(opts.layerStacks, eqCalls)
        throw new Error(`unexpected table: ${table}`)
      },
    }
  }
  return { client: client(), selectCalls, tablesQueried, eqCalls }
}

/** The helper queries `nodes` twice:
 *   1. Immediate children — `.eq('parent_id', parent).eq('node_category', ...)`
 *   2. All-document rollup — `.eq('document_id', doc).eq('node_category', ...)`
 * We branch on whether the chain saw `parent_id` (immediate) or
 * `document_id` (rollup) before resolving. */
function nodesChain(
  children: ChildRow[],
  allDocNodes: DescendantRow[],
  selectCalls: Array<{ table: string; cols: string }>,
  eqCalls: Array<{ table: string; col: string; val: unknown }>,
) {
  let sawParentId = false
  let sawDocumentId = false
  const chain = {
    select(cols: string) {
      selectCalls.push({ table: 'nodes', cols })
      return chain
    },
    eq(col: string, val: unknown) {
      eqCalls.push({ table: 'nodes', col, val })
      if (col === 'parent_id') sawParentId = true
      if (col === 'document_id') sawDocumentId = true
      return chain
    },
    order() { return chain },
    // Phase 8.5b B.1 — computeChildActualAggregates now paginates the
    // all-document fetch via .range(offset, offset + pageSize - 1) to
    // sidestep PostgREST's 1000-row default cap. The mock supports
    // .range() as a no-op pass-through — single-page returns suffice
    // for unit tests whose fixtures are well below the cap.
    range() { return chain },
    returns() { return chain },
    then(resolve: (v: { data: ChildRow[] | DescendantRow[]; error: null }) => void) {
      if (sawParentId) resolve({ data: children, error: null })
      else if (sawDocumentId) resolve({ data: allDocNodes, error: null })
      else resolve({ data: children, error: null })
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
    // Round-3 follow-up: non-leaf children contribute their AGGREGATED
    // descendant actual (50 here, via c1's lone leaf-descendant), not
    // the literal 0 carried on the c1 row. Totals + draftedPct still
    // include every child.
    const { client } = mockSupabase({
      children: [
        child({ id: 'b1', layer: 4, actual: 250, target: 500 }),
        child({ id: 'b2', layer: 4, actual: 100, target: 500 }),
        child({ id: 'c1', layer: 3, actual: 0,   target: 0 }), // non-leaf — rolls up below
      ],
      layerStacks: [{ document_id: 'doc-1', layers: LEAF_LAYERS_5 }],
      allDocNodes: [
        { id: 'b1', parent_id: 'parent-1', word_count_actual: 250 },
        { id: 'b2', parent_id: 'parent-1', word_count_actual: 100 },
        { id: 'c1', parent_id: 'parent-1', word_count_actual: 0 },
        { id: 'c1-leaf', parent_id: 'c1', word_count_actual: 50 },
      ],
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

  // Round-3 follow-up — non-leaf children now show the sum of their
  // descendant leaves' actuals rather than the literal 0 stored on
  // non-leaf rows.

  it('T-7 non-leaf child gets aggregated actual from its descendant leaves', async () => {
    // Parent is a Chapter; its child is a Scene with three leaf Beats
    // below. The Scene's literal word_count_actual is 0; aggregated
    // should be 250 + 400 + 100 = 750.
    const { client } = mockSupabase({
      children: [child({ id: 'scene-1', layer: 3, actual: 0 })],
      layerStacks: [{ document_id: 'doc-1', layers: LEAF_LAYERS_5 }],
      allDocNodes: [
        { id: 'scene-1', parent_id: 'chapter-1', word_count_actual: 0 },
        { id: 'beat-1', parent_id: 'scene-1', word_count_actual: 250 },
        { id: 'beat-2', parent_id: 'scene-1', word_count_actual: 400 },
        { id: 'beat-3', parent_id: 'scene-1', word_count_actual: 100 },
      ],
    })
    const out = await getStructuralOverview(client as never, 'chapter-1')
    expect(out.children).toHaveLength(1)
    expect(out.children[0].wordCountActual).toBe(750)
  })

  it('T-8 leaf child keeps its literal actual (no double-counting)', async () => {
    const { client } = mockSupabase({
      children: [child({ id: 'beat-1', layer: 4, actual: 300 })],
      layerStacks: [{ document_id: 'doc-1', layers: LEAF_LAYERS_5 }],
      allDocNodes: [
        { id: 'beat-1', parent_id: 'scene-1', word_count_actual: 300 },
      ],
    })
    const out = await getStructuralOverview(client as never, 'scene-1')
    expect(out.children[0].wordCountActual).toBe(300)
    // totalWordsActual sums the children's effective actuals.
    expect(out.totalWordsActual).toBe(300)
  })

  it('T-9 mixed: leaf siblings + non-leaf siblings each get their own rollup', async () => {
    const { client } = mockSupabase({
      children: [
        child({ id: 'beat-direct', layer: 4, actual: 500 }),       // direct leaf
        child({ id: 'scene-sub',   layer: 3, actual: 0 }),         // non-leaf
      ],
      layerStacks: [{ document_id: 'doc-1', layers: LEAF_LAYERS_5 }],
      allDocNodes: [
        { id: 'beat-direct', parent_id: 'chapter-1', word_count_actual: 500 },
        { id: 'scene-sub',   parent_id: 'chapter-1', word_count_actual: 0 },
        { id: 'beat-a',      parent_id: 'scene-sub', word_count_actual: 200 },
        { id: 'beat-b',      parent_id: 'scene-sub', word_count_actual: 350 },
      ],
    })
    const out = await getStructuralOverview(client as never, 'chapter-1')
    const byId = Object.fromEntries(out.children.map((c) => [c.id, c.wordCountActual]))
    expect(byId['beat-direct']).toBe(500)
    expect(byId['scene-sub']).toBe(550)
    expect(out.totalWordsActual).toBe(1050)
  })

  it('T-10 deep nesting — rollup propagates through multiple levels', async () => {
    const { client } = mockSupabase({
      children: [child({ id: 'act-1', layer: 1, actual: 0 })],
      layerStacks: [{ document_id: 'doc-1', layers: LEAF_LAYERS_5 }],
      allDocNodes: [
        { id: 'act-1',     parent_id: 'book-1',   word_count_actual: 0 },
        { id: 'ch-1',      parent_id: 'act-1',    word_count_actual: 0 },
        { id: 'sc-1',      parent_id: 'ch-1',     word_count_actual: 0 },
        { id: 'beat-a',    parent_id: 'sc-1',     word_count_actual: 100 },
        { id: 'beat-b',    parent_id: 'sc-1',     word_count_actual: 200 },
        { id: 'sc-2',      parent_id: 'ch-1',     word_count_actual: 0 },
        { id: 'beat-c',    parent_id: 'sc-2',     word_count_actual: 300 },
      ],
    })
    const out = await getStructuralOverview(client as never, 'book-1')
    expect(out.children[0].wordCountActual).toBe(600)
  })
})
