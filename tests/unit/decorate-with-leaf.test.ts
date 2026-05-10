// B2.2 + B2.3 — round-3 audit F-152 + F-160.
//
// F-152 (HIGH): decorateWithLeaf returns is_leaf=false when
// maxLayerIndex is null. If the layer_stacks fetch failed silently
// (no row, transient DB error), every node appears non-leaf and the
// leaf-only UI affordances (ProseEditor mounting, Synthesise button,
// Add Child gating) silently disappear with no error to the user.
// Same fail-quiet shape as the rest of the silent-failure cluster.
//
// F-160 (MEDIUM): getDocumentMaxLayerIndex masks malformed layer data
// as 0 via `Math.max(...layers.map(l => l.index ?? 0))`. If a layer
// row is missing its `index` field, the function returns 0 — meaning
// "max layer is the root" — and every non-root node returns is_leaf=false,
// every root returns is_leaf=true. Silently wrong.
//
// Fix shape:
//   - getDocumentMaxLayerIndex throws (with informative message)
//     when the layer_stacks row is missing OR the layers array is
//     empty / malformed (F-152 + F-160 root cause).
//   - decorateWithLeaf still accepts `number | null` because route
//     callers legitimately pass null for context nodes (document_id
//     is null; no layer_stack to fetch).
//
// Failing-test-first proof:
//   Test 1: malformed layer (`[{index: undefined}]`) — pre-fix returns
//           0 (silent), post-fix throws.
//   Test 2: missing layer_stacks row — pre-fix returns null, post-fix
//           throws.
//   Test 3: happy path with valid layers `[{index: 0}, {index: 1}, {index: 2}]`
//           — both pre and post fix return 2.
//   Test 4: decorateWithLeaf(null) for context-node case still returns
//           is_leaf=false (legitimate null-input path; not a bug).

import { describe, expect, it } from 'vitest'

import {
  getDocumentMaxLayerIndex,
  decorateWithLeaf,
} from '@/lib/data/nodes'
import type { Database } from '@/lib/types/database'
import type { SupabaseClient } from '@supabase/supabase-js'

type Client = SupabaseClient<Database>

// Build a chain whose .maybeSingle() resolves with a configurable layers cell.
function buildLayerChain(layersValue: unknown) {
  const chain = {
    from: () => chain,
    select: () => chain,
    eq: () => chain,
    maybeSingle: () => Promise.resolve({ data: layersValue === undefined ? null : { layers: layersValue }, error: null }),
  }
  return chain as unknown as Client
}

describe('B2.2 — F-152: getDocumentMaxLayerIndex must throw on data integrity violations', () => {
  it('happy path — valid 3-layer stack returns max index 2', async () => {
    const client = buildLayerChain([{ index: 0 }, { index: 1 }, { index: 2 }])
    const result = await getDocumentMaxLayerIndex(client, 'doc-id')
    expect(result).toBe(2)
  })

  it('throws when no layer_stacks row exists for the document (data integrity)', async () => {
    const client = buildLayerChain(undefined) // simulates .maybeSingle() returning null data
    await expect(getDocumentMaxLayerIndex(client, 'doc-with-no-stack'))
      .rejects.toThrow(/doc-with-no-stack/)
  })

  it('throws when the layer_stacks row exists but layers is empty (data integrity)', async () => {
    const client = buildLayerChain([])
    await expect(getDocumentMaxLayerIndex(client, 'doc-with-empty-layers'))
      .rejects.toThrow(/doc-with-empty-layers/)
  })

  it('F-160: throws when a layer is missing its `index` field (no silent 0 fallback)', async () => {
    const client = buildLayerChain([{ index: 0 }, { /* index missing */ } as { index?: number }])
    await expect(getDocumentMaxLayerIndex(client, 'doc-with-malformed-layer'))
      .rejects.toThrow(/doc-with-malformed-layer/)
  })

  it('F-160: throws when a layer\'s `index` is not a number', async () => {
    const client = buildLayerChain([{ index: 0 }, { index: 'one' } as unknown as { index: number }])
    await expect(getDocumentMaxLayerIndex(client, 'doc-with-bad-index-type'))
      .rejects.toThrow(/doc-with-bad-index-type/)
  })
})

describe('B2.2 — F-152: decorateWithLeaf null-input is the legitimate context-node path', () => {
  // Context nodes have document_id=null; route callers conditionally
  // skip the layer-stack fetch and pass null. The decorator returns
  // is_leaf=false (context nodes have no leaf semantics in the
  // structural sense). This path is preserved post-fix.
  it('null maxLayerIndex returns is_leaf=false (context-node path)', () => {
    const node = { id: 'ctx-1', layer_index: null } as unknown as Parameters<typeof decorateWithLeaf>[0]
    const decorated = decorateWithLeaf(node, null)
    expect(decorated.is_leaf).toBe(false)
  })

  it('matching layer_index returns is_leaf=true', () => {
    const node = { id: 'beat-1', layer_index: 3 } as unknown as Parameters<typeof decorateWithLeaf>[0]
    const decorated = decorateWithLeaf(node, 3)
    expect(decorated.is_leaf).toBe(true)
  })

  it('non-matching layer_index returns is_leaf=false', () => {
    const node = { id: 'chapter-1', layer_index: 1 } as unknown as Parameters<typeof decorateWithLeaf>[0]
    const decorated = decorateWithLeaf(node, 3)
    expect(decorated.is_leaf).toBe(false)
  })
})
