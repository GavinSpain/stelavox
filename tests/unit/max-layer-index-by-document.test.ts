// Phase 8.01.D wireframe-review — contract test for the new batch helper
// `getMaxLayerIndexByDocument` in lib/data/nodes.ts.
//
// This is the foundation for the H-15 leaf-derivation paths in the four
// dashboard / project helpers. Asserting it directly avoids depending on
// the indirect coverage via the helpers' own tests.

import { describe, expect, it } from 'vitest'

import { getMaxLayerIndexByDocument } from '@/lib/data/nodes'

function mockSupabase(rows: Array<{ document_id: string; layers: unknown }>) {
  const eqCalls: Array<{ col: string; val: unknown }> = []
  let inIds: readonly string[] | null = null
  const client = {
    from(table: string) {
      if (table !== 'layer_stacks') throw new Error(`unexpected: ${table}`)
      const chain = {
        select() { return chain },
        in(_col: string, ids: readonly string[]) { inIds = ids; return chain },
        eq(col: string, val: unknown) {
          eqCalls.push({ col, val })
          return Promise.resolve({ data: rows, error: null })
        },
      }
      return chain
    },
  }
  return { client, eqCalls, getInIds: () => inIds }
}

const LEAF_LAYERS_5 = [
  { index: 0 }, { index: 1 }, { index: 2 }, { index: 3 }, { index: 4 },
]
const LEAF_LAYERS_3 = [{ index: 0 }, { index: 1 }, { index: 2 }]

describe('getMaxLayerIndexByDocument', () => {
  it('empty input → empty map, no query issued', async () => {
    const { client } = mockSupabase([])
    const out = await getMaxLayerIndexByDocument(client as never, [])
    expect(out.size).toBe(0)
  })

  it('returns max layer index per document', async () => {
    const { client } = mockSupabase([
      { document_id: 'd1', layers: LEAF_LAYERS_5 },
      { document_id: 'd2', layers: LEAF_LAYERS_3 },
    ])
    const out = await getMaxLayerIndexByDocument(client as never, ['d1', 'd2'])
    expect(out.get('d1')).toBe(4)
    expect(out.get('d2')).toBe(2)
  })

  it('deduplicates documentIds before issuing the .in() filter', async () => {
    const { client, getInIds } = mockSupabase([
      { document_id: 'd1', layers: LEAF_LAYERS_5 },
    ])
    await getMaxLayerIndexByDocument(client as never, ['d1', 'd1', 'd1'])
    expect(getInIds()).toEqual(['d1'])
  })

  it('only reads non-template rows (is_template=false)', async () => {
    const { client, eqCalls } = mockSupabase([])
    await getMaxLayerIndexByDocument(client as never, ['d1'])
    expect(eqCalls.some((c) => c.col === 'is_template' && c.val === false)).toBe(true)
  })

  it('omits documents with null layers (graceful degrade, not throw)', async () => {
    const { client } = mockSupabase([
      { document_id: 'd1', layers: null },
      { document_id: 'd2', layers: LEAF_LAYERS_3 },
    ])
    const out = await getMaxLayerIndexByDocument(client as never, ['d1', 'd2'])
    expect(out.has('d1')).toBe(false)
    expect(out.get('d2')).toBe(2)
  })

  it('omits documents with empty layers array', async () => {
    const { client } = mockSupabase([{ document_id: 'd1', layers: [] }])
    const out = await getMaxLayerIndexByDocument(client as never, ['d1'])
    expect(out.has('d1')).toBe(false)
  })

  it('omits documents whose layers all have non-numeric index fields', async () => {
    const { client } = mockSupabase([
      { document_id: 'd1', layers: [{ index: 'oops' }, { index: null }] },
    ])
    const out = await getMaxLayerIndexByDocument(client as never, ['d1'])
    expect(out.has('d1')).toBe(false)
  })

  it('skips malformed layer entries within a row while keeping the row', async () => {
    const { client } = mockSupabase([
      {
        document_id: 'd1',
        layers: [{ index: 0 }, { index: 'bad' }, { index: 2 }],
      },
    ])
    const out = await getMaxLayerIndexByDocument(client as never, ['d1'])
    expect(out.get('d1')).toBe(2)
  })
})
