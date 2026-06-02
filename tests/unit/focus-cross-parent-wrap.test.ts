/**
 * Cross-parent wrap helpers — Phase 8.01.B T-7.
 *
 * findCrossParentLeaf + findLeafDescendant power the ⌘ → at-last-beat
 * wrap to the first beat of the next scene (and the symmetric ⌘ ← wrap).
 * Spec contract per Component Spec v2.21 §6.1 + Phase 8.01 wireframe iter1 F-2.
 */

import { describe, expect, it } from 'vitest'

import {
  findCrossParentLeaf,
  findLeafDescendant,
} from '@/components/focus/FocusMode'

interface N {
  id: string
  parent_id: string | null
  order: number
  is_leaf?: boolean
  name: string | null
  word_count_target: number | null
  node_type?: string
}

// Build a small document: Book → 2 Acts; Act1 has Scene1 with Bt1,Bt2;
// Act2 has Scene2 with Bt3,Bt4.
const DOC: N[] = [
  { id: 'book', parent_id: null,    order: 1, is_leaf: false, name: null, word_count_target: null },
  { id: 'a1',   parent_id: 'book',  order: 1, is_leaf: false, name: null, word_count_target: null },
  { id: 'a2',   parent_id: 'book',  order: 2, is_leaf: false, name: null, word_count_target: null },
  { id: 's1',   parent_id: 'a1',    order: 1, is_leaf: false, name: null, word_count_target: null },
  { id: 's2',   parent_id: 'a2',    order: 1, is_leaf: false, name: null, word_count_target: null },
  { id: 'bt1',  parent_id: 's1',    order: 1, is_leaf: true,  name: null, word_count_target: null },
  { id: 'bt2',  parent_id: 's1',    order: 2, is_leaf: true,  name: null, word_count_target: null },
  { id: 'bt3',  parent_id: 's2',    order: 1, is_leaf: true,  name: null, word_count_target: null },
  { id: 'bt4',  parent_id: 's2',    order: 2, is_leaf: true,  name: null, word_count_target: null },
]

describe('findLeafDescendant', () => {
  it('leftmost leaf descendant of s1 (dir=1) → bt1', () => {
    expect(findLeafDescendant(DOC, 's1', 1)?.id).toBe('bt1')
  })

  it('rightmost leaf descendant of s2 (dir=-1) → bt4', () => {
    expect(findLeafDescendant(DOC, 's2', -1)?.id).toBe('bt4')
  })

  it('leftmost leaf descendant of book (dir=1) → bt1 (deep descent)', () => {
    expect(findLeafDescendant(DOC, 'book', 1)?.id).toBe('bt1')
  })

  it('rightmost leaf descendant of book (dir=-1) → bt4 (deep descent)', () => {
    expect(findLeafDescendant(DOC, 'book', -1)?.id).toBe('bt4')
  })

  it('unknown root → undefined', () => {
    expect(findLeafDescendant(DOC, 'missing', 1)).toBeUndefined()
  })

  it('input already a leaf → returns itself', () => {
    expect(findLeafDescendant(DOC, 'bt2', 1)?.id).toBe('bt2')
  })
})

describe('findCrossParentLeaf', () => {
  it('from s1 (parent of bt1/bt2), dir=1 → first leaf of next aunt s2 = bt3', () => {
    expect(findCrossParentLeaf(DOC, 's1', 1)?.id).toBe('bt3')
  })

  it('from s2, dir=-1 → last leaf of previous aunt s1 = bt2', () => {
    expect(findCrossParentLeaf(DOC, 's2', -1)?.id).toBe('bt2')
  })

  it('from s1, dir=-1 → no previous aunt at the Act level → undefined', () => {
    // s1 lives under a1 which is the first child of book; backing up from
    // s1 across-parent would look at aunts of a1's parent (book's parent
    // is null), so no previous aunt. Should return undefined.
    expect(findCrossParentLeaf(DOC, 's1', -1)).toBeUndefined()
  })

  it('from s2, dir=1 → no next aunt → undefined (T-6.3 stop-at-end)', () => {
    expect(findCrossParentLeaf(DOC, 's2', 1)).toBeUndefined()
  })

  it('unknown parentId → undefined', () => {
    expect(findCrossParentLeaf(DOC, 'missing', 1)).toBeUndefined()
  })
})
