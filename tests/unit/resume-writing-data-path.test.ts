// Phase 8.01.D wireframe-review — data-path regression guard for the
// getResumeWritingTarget server helper.
//
// The pre-fix bug: `.eq('is_leaf', true)` against the `nodes` table.
// The column doesn't exist (H-15); Supabase JS swallowed the error and
// the helper returned null, hiding the Resume Writing hero on every
// dashboard load.
//
// These tests assert:
//   T-1  the helper does NOT query `.eq('is_leaf', ...)` on `nodes`
//   T-2  it DOES query `layer_stacks` for max-index resolution
//   T-3  a leaf row with prose is selected with correct excerpt
//   T-4  a non-leaf row with prose is correctly skipped
//   T-5  candidates list is ordered by updated_at desc — the first
//        eligible leaf wins
//   T-6  empty candidates → null
//   T-7  malformed layer_stacks row → null (no throw)

import { describe, expect, it } from 'vitest'

import { getResumeWritingTarget } from '@/lib/dashboard/resumeWriting'

interface NodeCandidate {
  id: string
  name: string | null
  node_type: string
  order: number
  prose: unknown
  updated_at: string
  document_id: string
  project_id: string
  layer_index: number | null
}

interface AncestorRow {
  id: string
  parent_id: string | null
  node_type: string
  order: number
  node_category: string
}

interface DocumentRow {
  id: string
  name: string
  project_id: string
}

interface ProjectRow {
  id: string
  name: string
}

interface MockOpts {
  candidates: NodeCandidate[]
  layerStacks: Array<{ document_id: string; layers: unknown }>
  documents?: DocumentRow[]
  projects?: ProjectRow[]
  // Pre-fetched ancestor rows for the chain walk. Keys are node ids.
  ancestorNodes?: Record<string, AncestorRow>
}

function mockSupabase(opts: MockOpts) {
  const eqCalls: Array<{ table: string; col: string; val: unknown }> = []
  const tablesQueried = new Set<string>()
  const selectCalls: Array<{ table: string; cols: string }> = []

  function client(): unknown {
    return {
      from(table: string) {
        tablesQueried.add(table)
        if (table === 'nodes') return nodesChain(opts, selectCalls, eqCalls)
        if (table === 'documents')
          return singleRowChain('documents', opts.documents ?? [], eqCalls)
        if (table === 'projects')
          return singleRowChain('projects', opts.projects ?? [], eqCalls)
        if (table === 'layer_stacks') return layerStackChain(opts.layerStacks, eqCalls)
        throw new Error(`unexpected table: ${table}`)
      },
    }
  }
  return { client: client(), eqCalls, tablesQueried, selectCalls }
}

// `nodes` is queried in two shapes by this helper + getAncestorChain:
//
//   A) candidate fetch:
//        .select('… prose, updated_at, document_id, project_id, layer_index')
//        .eq('organisation_id', orgId).eq('node_category', 'structural')
//        .not('prose', 'is', null).order().limit(50).returns<...>()
//
//   B) ancestor walk (single row):
//        .select('id, parent_id, node_type, "order", node_category')
//        .eq('id', id).maybeSingle<...>()
//
// We discriminate by what's in the select string.
function nodesChain(
  opts: MockOpts,
  selectCalls: Array<{ table: string; cols: string }>,
  eqCalls: Array<{ table: string; col: string; val: unknown }>,
) {
  let selectCols = ''
  const eqs: Array<{ col: string; val: unknown }> = []
  const chain = {
    select(cols: string) {
      selectCols = cols
      selectCalls.push({ table: 'nodes', cols })
      return chain
    },
    eq(col: string, val: unknown) {
      eqs.push({ col, val })
      eqCalls.push({ table: 'nodes', col, val })
      return chain
    },
    not() {
      return chain
    },
    order() {
      return chain
    },
    limit() {
      return chain
    },
    returns() {
      return chain
    },
    then(resolve: (v: { data: NodeCandidate[]; error: null }) => void) {
      // candidate fetch path
      resolve({ data: opts.candidates, error: null })
    },
    async maybeSingle() {
      // ancestor walk path — find row whose id matches the most recent eq('id', X).
      if (selectCols.includes('parent_id')) {
        const eq = [...eqs].reverse().find((e) => e.col === 'id')
        const id = eq?.val as string | undefined
        if (id && opts.ancestorNodes?.[id]) {
          return { data: opts.ancestorNodes[id], error: null }
        }
        return { data: null, error: null }
      }
      return { data: null, error: null }
    },
  }
  return chain
}

function singleRowChain<T extends { id: string }>(
  table: string,
  rows: T[],
  eqCalls: Array<{ table: string; col: string; val: unknown }>,
) {
  let needleId: string | null = null
  const chain = {
    select() { return chain },
    eq(col: string, val: unknown) {
      eqCalls.push({ table, col, val })
      if (col === 'id') needleId = val as string
      return chain
    },
    async maybeSingle() {
      const found = rows.find((r) => r.id === needleId) ?? null
      return { data: found, error: null }
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

const PROSE_NODE = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [{ type: 'text', text: 'The bridge cleared at 03:14.' }],
    },
  ],
}

function candidate(opts: {
  id: string
  layer: number
  doc?: string
  proj?: string
  updated?: string
  prose?: unknown
}): NodeCandidate {
  return {
    id: opts.id,
    name: opts.id,
    node_type: 'beat',
    order: 0,
    prose: opts.prose ?? PROSE_NODE,
    updated_at: opts.updated ?? '2026-05-01T00:00:00Z',
    document_id: opts.doc ?? 'doc-1',
    project_id: opts.proj ?? 'proj-1',
    layer_index: opts.layer,
  }
}

const ORG = 'org-1'

const DOC: DocumentRow = { id: 'doc-1', name: 'Shadow Protocol', project_id: 'proj-1' }
const PROJ: ProjectRow = { id: 'proj-1', name: 'Shadow Protocol' }

describe('getResumeWritingTarget — H-15 data-path regression guards', () => {
  it('T-1 never filters nodes by is_leaf column (H-15: column does not exist)', async () => {
    const { client, eqCalls } = mockSupabase({
      candidates: [candidate({ id: 'b1', layer: 4 })],
      layerStacks: [{ document_id: 'doc-1', layers: LEAF_LAYERS_5 }],
      documents: [DOC],
      projects: [PROJ],
    })
    await getResumeWritingTarget(client as never, ORG)
    const nodeIsLeafEqs = eqCalls.filter(
      (c) => c.table === 'nodes' && c.col === 'is_leaf',
    )
    expect(nodeIsLeafEqs).toEqual([])
  })

  it('T-2 resolves max-layer-index via layer_stacks (is_template=false)', async () => {
    const { client, tablesQueried, eqCalls } = mockSupabase({
      candidates: [candidate({ id: 'b1', layer: 4 })],
      layerStacks: [{ document_id: 'doc-1', layers: LEAF_LAYERS_5 }],
      documents: [DOC],
      projects: [PROJ],
    })
    await getResumeWritingTarget(client as never, ORG)
    expect(tablesQueried.has('layer_stacks')).toBe(true)
    expect(
      eqCalls.some(
        (c) => c.table === 'layer_stacks' && c.col === 'is_template' && c.val === false,
      ),
    ).toBe(true)
  })

  it('T-3 leaf row with prose is selected with an excerpt', async () => {
    const { client } = mockSupabase({
      candidates: [candidate({ id: 'b1', layer: 4 })],
      layerStacks: [{ document_id: 'doc-1', layers: LEAF_LAYERS_5 }],
      documents: [DOC],
      projects: [PROJ],
    })
    const out = await getResumeWritingTarget(client as never, ORG)
    expect(out).not.toBeNull()
    expect(out!.nodeId).toBe('b1')
    expect(out!.projectName).toBe('Shadow Protocol')
    expect(out!.documentName).toBe('Shadow Protocol')
    expect(out!.proseExcerpt).toContain('The bridge cleared')
  })

  it('T-4 a non-leaf row with prose is skipped; the next-qualifying leaf wins', async () => {
    const { client } = mockSupabase({
      // Most recent first: non-leaf scene with prose, then a real leaf.
      candidates: [
        candidate({ id: 's1', layer: 3, updated: '2026-05-30T00:00:00Z' }),
        candidate({ id: 'b1', layer: 4, updated: '2026-05-20T00:00:00Z' }),
      ],
      layerStacks: [{ document_id: 'doc-1', layers: LEAF_LAYERS_5 }],
      documents: [DOC],
      projects: [PROJ],
    })
    const out = await getResumeWritingTarget(client as never, ORG)
    expect(out).not.toBeNull()
    expect(out!.nodeId).toBe('b1')
  })

  it('T-5 the first eligible candidate by updated_at wins (no later candidate inspected)', async () => {
    const { client } = mockSupabase({
      candidates: [
        candidate({ id: 'b1', layer: 4, updated: '2026-05-30T00:00:00Z' }),
        candidate({ id: 'b2', layer: 4, updated: '2026-05-01T00:00:00Z' }),
      ],
      layerStacks: [{ document_id: 'doc-1', layers: LEAF_LAYERS_5 }],
      documents: [DOC],
      projects: [PROJ],
    })
    const out = await getResumeWritingTarget(client as never, ORG)
    expect(out!.nodeId).toBe('b1')
  })

  it('T-6 empty candidates → null', async () => {
    const { client } = mockSupabase({
      candidates: [],
      layerStacks: [],
    })
    const out = await getResumeWritingTarget(client as never, ORG)
    expect(out).toBeNull()
  })

  it('T-7 malformed layer_stacks row → null (no throw)', async () => {
    const { client } = mockSupabase({
      candidates: [candidate({ id: 'b1', layer: 4 })],
      // null layers — batch helper omits this doc; row never qualifies as leaf.
      layerStacks: [{ document_id: 'doc-1', layers: null }],
      documents: [DOC],
      projects: [PROJ],
    })
    const out = await getResumeWritingTarget(client as never, ORG)
    expect(out).toBeNull()
  })
})
