// Phase 8.01.D wireframe-review — data-path regression guard for the
// getQuickStartCompletion server helper.
//
// The pre-fix bug: `.eq('is_leaf', true)` against the `nodes` table. The
// column does not exist (H-15: leaf-ness is layer_stack-derived). Supabase
// JS swallows the column-not-found error into the return value and the
// helper reads `count ?? 0`, so the count was always 0 — meaning the
// "Add a beat and write" tick never lit up regardless of state.
//
// These tests assert:
//   T-1  the helper does NOT query `.eq('is_leaf', ...)` on `nodes`
//   T-2  it DOES query `layer_stacks` for max-index resolution
//   T-3  a leaf row with prose drives hasBeatWithProse=true
//   T-4  a non-leaf row with prose is correctly filtered out
//   T-5  no candidates → hasBeatWithProse=false
//   T-6  malformed layer_stacks row → degrades gracefully (no throw, false)

import { describe, expect, it } from 'vitest'

import { getQuickStartCompletion } from '@/lib/dashboard/quickStartCompletion'

interface NodeCandidate {
  document_id: string
  layer_index: number | null
}

function mockSupabase(opts: {
  nodeCandidates: NodeCandidate[]
  layerStacks: Array<{ document_id: string; layers: unknown }>
  projectCount?: number
  turnCount?: number
  exportCount?: number
}) {
  const eqCalls: Array<{ table: string; col: string; val: unknown }> = []
  const tablesQueried = new Set<string>()
  function trackEq(table: string, col: string, val: unknown) {
    eqCalls.push({ table, col, val })
  }
  function client() {
    return {
      from(table: string) {
        tablesQueried.add(table)
        if (table === 'projects') {
          return countChain(table, opts.projectCount ?? 0, trackEq)
        }
        if (table === 'director_turns') {
          return countChain(table, opts.turnCount ?? 0, trackEq)
        }
        if (table === 'export_jobs') {
          return countChain(table, opts.exportCount ?? 0, trackEq)
        }
        if (table === 'nodes') {
          return nodesCandidateChain(opts.nodeCandidates, trackEq)
        }
        if (table === 'layer_stacks') {
          return layerStackChain(opts.layerStacks, trackEq)
        }
        throw new Error(`unexpected table: ${table}`)
      },
    }
  }
  return { client: client(), eqCalls, tablesQueried }
}

function countChain(
  table: string,
  count: number,
  trackEq: (t: string, c: string, v: unknown) => void,
) {
  const chain = {
    select() {
      return chain
    },
    eq(col: string, val: unknown) {
      trackEq(table, col, val)
      return chain
    },
    limit() {
      return Promise.resolve({ count, data: null, error: null })
    },
  }
  return chain
}

function nodesCandidateChain(
  candidates: NodeCandidate[],
  trackEq: (t: string, c: string, v: unknown) => void,
) {
  const chain = {
    select() {
      return chain
    },
    eq(col: string, val: unknown) {
      trackEq('nodes', col, val)
      return chain
    },
    not() {
      return chain
    },
    limit() {
      return Promise.resolve({ data: candidates, error: null })
    },
  }
  return chain
}

function layerStackChain(
  rows: Array<{ document_id: string; layers: unknown }>,
  trackEq: (t: string, c: string, v: unknown) => void,
) {
  const chain = {
    select() {
      return chain
    },
    in() {
      return chain
    },
    eq(col: string, val: unknown) {
      trackEq('layer_stacks', col, val)
      return Promise.resolve({ data: rows, error: null })
    },
  }
  return chain
}

const LEAF_LAYERS = [{ index: 0 }, { index: 1 }, { index: 2 }, { index: 3 }, { index: 4 }]
// max = 4

describe('getQuickStartCompletion — H-15 data-path regression guards', () => {
  it('T-1 never filters nodes by is_leaf column (H-15: column does not exist)', async () => {
    const { client, eqCalls } = mockSupabase({
      nodeCandidates: [{ document_id: 'doc-1', layer_index: 4 }],
      layerStacks: [{ document_id: 'doc-1', layers: LEAF_LAYERS }],
      projectCount: 1,
    })
    await getQuickStartCompletion(client as never, 'org-1')
    const nodeIsLeafEqs = eqCalls.filter(
      (c) => c.table === 'nodes' && c.col === 'is_leaf',
    )
    expect(nodeIsLeafEqs).toEqual([])
  })

  it('T-2 resolves max-layer-index via layer_stacks (not template rows)', async () => {
    const { client, eqCalls, tablesQueried } = mockSupabase({
      nodeCandidates: [{ document_id: 'doc-1', layer_index: 4 }],
      layerStacks: [{ document_id: 'doc-1', layers: LEAF_LAYERS }],
    })
    await getQuickStartCompletion(client as never, 'org-1')
    expect(tablesQueried.has('layer_stacks')).toBe(true)
    // Non-template rows only — protects against picking up the seeded
    // template layer_stack rows that don't bind to a specific document.
    expect(
      eqCalls.some(
        (c) =>
          c.table === 'layer_stacks' && c.col === 'is_template' && c.val === false,
      ),
    ).toBe(true)
  })

  it('T-3 leaf row with prose → hasBeatWithProse=true', async () => {
    const { client } = mockSupabase({
      nodeCandidates: [{ document_id: 'doc-1', layer_index: 4 }], // matches max
      layerStacks: [{ document_id: 'doc-1', layers: LEAF_LAYERS }],
    })
    const result = await getQuickStartCompletion(client as never, 'org-1')
    expect(result.hasBeatWithProse).toBe(true)
  })

  it('T-4 non-leaf row with prose is filtered out (layer_index < max)', async () => {
    const { client } = mockSupabase({
      nodeCandidates: [
        { document_id: 'doc-1', layer_index: 2 }, // chapter level — NOT a leaf
        { document_id: 'doc-1', layer_index: 3 }, // scene level — NOT a leaf either
      ],
      layerStacks: [{ document_id: 'doc-1', layers: LEAF_LAYERS }],
    })
    const result = await getQuickStartCompletion(client as never, 'org-1')
    expect(result.hasBeatWithProse).toBe(false)
  })

  it('T-5 no candidate rows → hasBeatWithProse=false (no layer_stacks query)', async () => {
    const { client, tablesQueried } = mockSupabase({
      nodeCandidates: [],
      layerStacks: [],
    })
    const result = await getQuickStartCompletion(client as never, 'org-1')
    expect(result.hasBeatWithProse).toBe(false)
    // Optimisation: when there are no candidates we shouldn't bother
    // hitting layer_stacks.
    expect(tablesQueried.has('layer_stacks')).toBe(false)
  })

  it('T-6 malformed layer_stacks row degrades gracefully (no throw, falsey result)', async () => {
    const { client } = mockSupabase({
      nodeCandidates: [{ document_id: 'doc-1', layer_index: 4 }],
      // null layers, not an array → batch helper omits this doc from the map
      layerStacks: [{ document_id: 'doc-1', layers: null }],
    })
    const result = await getQuickStartCompletion(client as never, 'org-1')
    expect(result.hasBeatWithProse).toBe(false)
  })

  it('T-7 propagates other booleans (signedIn / hasProject / hasTriedDirector / hasCompletedExport)', async () => {
    const { client } = mockSupabase({
      nodeCandidates: [],
      layerStacks: [],
      projectCount: 1,
      turnCount: 1,
      exportCount: 1,
    })
    const result = await getQuickStartCompletion(client as never, 'org-1')
    expect(result.signedIn).toBe(true)
    expect(result.hasProject).toBe(true)
    expect(result.hasTriedDirector).toBe(true)
    expect(result.hasCompletedExport).toBe(true)
  })
})
