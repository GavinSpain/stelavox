// Phase 8.01.C T-9 — positional path resolver.

import { describe, expect, it } from 'vitest'

import { resolvePositionalPath } from '@/lib/director/resolvePositionalPath'

interface N {
  id: string
  parent_id: string | null
  order: number
  node_type: string
  node_category?: string
}

const NODES: N[] = [
  { id: 'book', parent_id: null,  order: 1, node_type: 'book' },
  { id: 'a1',   parent_id: 'book', order: 1, node_type: 'act' },
  { id: 'a2',   parent_id: 'book', order: 2, node_type: 'act' },
  { id: 'c1',   parent_id: 'a1',   order: 1, node_type: 'chapter' },
  { id: 'c3',   parent_id: 'a1',   order: 3, node_type: 'chapter' },
  { id: 's1',   parent_id: 'c1',   order: 1, node_type: 'scene' },
  { id: 'bt1',  parent_id: 's1',   order: 1, node_type: 'beat' },
  { id: 'bt2',  parent_id: 's1',   order: 2, node_type: 'beat' },
  // context node should be ignored.
  { id: 'ctx',  parent_id: null,   order: 1, node_type: 'character', node_category: 'context' },
]

describe('resolvePositionalPath', () => {
  it('resolves book1 to the book root', () => {
    expect(resolvePositionalPath([{ layer: 'book', position: 1 }], NODES)?.id).toBe('book')
  })

  it('resolves book1act1ch3 to chapter 3 under act 1', () => {
    const out = resolvePositionalPath(
      [
        { layer: 'book', position: 1 },
        { layer: 'act', position: 1 },
        { layer: 'chapter', position: 3 },
      ],
      NODES,
    )
    expect(out?.id).toBe('c3')
  })

  it('bad path with no matching child → null', () => {
    expect(
      resolvePositionalPath(
        [
          { layer: 'book', position: 1 },
          { layer: 'act', position: 1 },
          { layer: 'chapter', position: 99 }, // no chapter 99 under a1
        ],
        NODES,
      ),
    ).toBeNull()
  })

  it('empty segments → null', () => {
    expect(resolvePositionalPath([], NODES)).toBeNull()
  })

  it('layer-type mismatch (asking for chapter where a beat lives) → null', () => {
    expect(
      resolvePositionalPath(
        [
          { layer: 'book', position: 1 },
          { layer: 'act', position: 1 },
          { layer: 'chapter', position: 1 },
          { layer: 'scene', position: 1 },
          { layer: 'chapter', position: 1 }, // wrong layer at depth 5
        ],
        NODES,
      ),
    ).toBeNull()
  })

  it('ignores context-typed nodes when resolving', () => {
    // The character node "ctx" sits at root but resolvePositionalPath shouldn't pick it.
    expect(
      resolvePositionalPath([{ layer: 'book', position: 1 }], NODES)?.id,
    ).toBe('book')
  })
})
