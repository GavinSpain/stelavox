/**
 * getAncestorChainSync — Phase 8.01.B T-7.
 *
 * Pure variant of getAncestorChain operates on a pre-fetched node array.
 * Tests pin the contract independently of any Supabase plumbing.
 *
 * Spec contract:
 *   - root-first order
 *   - excludes the input node itself
 *   - omits the `name` field on every segment
 *   - rejects context-typed ancestors (returns empty)
 *   - rejects unknown V1 layer types (returns empty)
 *   - respects 20-hop safety cap
 *   - correct `position` from `nodes.order`
 */

import { describe, expect, it } from 'vitest'

import {
  getAncestorChainSync,
  ANCESTOR_CHAIN_MAX_DEPTH,
} from '@/lib/nodes/getAncestorChain'

interface N {
  id: string
  parent_id: string | null
  node_type: string
  order: number
  node_category: string
}

function node(
  id: string,
  parent_id: string | null,
  node_type: string,
  order: number,
  node_category = 'structural',
): N {
  return { id, parent_id, node_type, order, node_category }
}

describe('getAncestorChainSync', () => {
  it('returns empty chain when input is a root (no parent)', () => {
    const nodes = [node('root', null, 'book', 1)]
    expect(getAncestorChainSync('root', nodes)).toEqual([])
  })

  it('depth-2 chain returns 1 segment (the root)', () => {
    const nodes = [
      node('book', null, 'book', 1),
      node('act',  'book', 'act', 1),
    ]
    expect(getAncestorChainSync('act', nodes)).toEqual([
      { layer: 'book', position: 1 },
    ])
  })

  it('depth-5 (book → act → chapter → scene → beat) returns 4 root-first segments', () => {
    const nodes = [
      node('book', null,    'book',    1),
      node('act',  'book',   'act',     1),
      node('ch',   'act',    'chapter', 1),
      node('sc',   'ch',     'scene',   1),
      node('bt',   'sc',     'beat',    1),
    ]
    expect(getAncestorChainSync('bt', nodes)).toEqual([
      { layer: 'book',    position: 1 },
      { layer: 'act',     position: 1 },
      { layer: 'chapter', position: 1 },
      { layer: 'scene',   position: 1 },
    ])
  })

  it('excludes the input node itself (last segment is the immediate parent)', () => {
    const nodes = [
      node('book', null,    'book',    1),
      node('act',  'book',   'act',     2),
      node('ch',   'act',    'chapter', 5),
    ]
    const out = getAncestorChainSync('ch', nodes)
    expect(out).toHaveLength(2)
    expect(out[out.length - 1].layer).toBe('act')
    // The chapter itself does NOT appear.
    expect(out.find(s => s.layer === 'chapter')).toBeUndefined()
  })

  it('passes the correct `position` from nodes.order on each ancestor', () => {
    const nodes = [
      node('book', null,    'book',    3),  // Book #3
      node('act',  'book',   'act',     7),  // Act #7 under that book
      node('ch',   'act',    'chapter', 2),
    ]
    expect(getAncestorChainSync('ch', nodes)).toEqual([
      { layer: 'book', position: 3 },
      { layer: 'act',  position: 7 },
    ])
  })

  it('omits the `name` field on every segment (T-2 contract)', () => {
    const nodes = [
      node('book', null,  'book', 1),
      node('act',  'book', 'act',  1),
    ]
    const out = getAncestorChainSync('act', nodes)
    expect(out[0]).not.toHaveProperty('name')
  })

  it('rejects context-typed ancestor (returns empty)', () => {
    const nodes = [
      node('something', null,        'character', 1, 'context'), // context!
      node('child',     'something',  'beat',      1),
    ]
    expect(getAncestorChainSync('child', nodes)).toEqual([])
  })

  it('rejects unknown V1 layer types on an ancestor (defensive — Phase 14 will land them)', () => {
    // The check applies to ancestors, not the input node itself. Here
    // 'episode' is the ANCESTOR with an unknown V1 type; the input is a
    // valid beat. Should reject the whole chain.
    const nodes = [
      node('series-root', null,          'series',  1),
      node('episode',     'series-root',  'episode', 1), // not in V1 set
      node('child-beat',  'episode',      'beat',    1),
    ]
    expect(getAncestorChainSync('child-beat', nodes)).toEqual([])
  })

  it('respects the 20-hop safety cap (broken-data defensive)', () => {
    // Build a chain longer than the cap.
    const N = ANCESTOR_CHAIN_MAX_DEPTH + 5
    const nodes: N[] = []
    for (let i = 0; i < N; i++) {
      nodes.push(node(`n${i}`, i === 0 ? null : `n${i - 1}`, 'beat', i + 1))
    }
    // The leaf is the last one. Walking up would exceed the cap.
    expect(getAncestorChainSync(`n${N - 1}`, nodes)).toEqual([])
  })

  it('exports ANCESTOR_CHAIN_MAX_DEPTH equal to 20 (matches M-173)', () => {
    expect(ANCESTOR_CHAIN_MAX_DEPTH).toBe(20)
  })
})
