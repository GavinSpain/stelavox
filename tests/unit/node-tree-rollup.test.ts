// Phase 8.01 round-3 follow-up — word_count_actual rollup in buildTree.
//
// Asserts that non-leaf nodes in the rendered tree carry the sum of
// their descendant leaves' actuals (deep recursion), and that targets
// stay as authored (NOT aggregated).

import { describe, expect, it } from 'vitest'

import { buildTree } from '@/components/tree/NodeTree'
import type { NodeData } from '@/components/tree/NodeRow'

function node(opts: {
  id: string
  parent_id?: string | null
  order?: number
  node_type: string
  actual?: number
  target?: number
}): NodeData {
  return {
    id: opts.id,
    parent_id: opts.parent_id ?? null,
    document_id: 'd1',
    project_id: 'p1',
    organisation_id: 'org1',
    order: opts.order ?? 0,
    depth: 0,
    layer_index: 0,
    node_type: opts.node_type,
    node_category: 'structural',
    name: opts.id,
    short_description: null,
    status: 'draft',
    locked: false,
    word_count_actual: opts.actual ?? 0,
    word_count_target: opts.target ?? 0,
    version: 1,
  }
}

describe('buildTree — word_count_actual rollup', () => {
  it('leaves keep their own literal actual', () => {
    const out = buildTree([
      node({ id: 'beat-1', node_type: 'beat', actual: 250 }),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].data.word_count_actual).toBe(250)
  })

  it('a parent with two leaf children gets the sum', () => {
    const out = buildTree([
      node({ id: 'scene-1', node_type: 'scene', actual: 0 }),
      node({ id: 'beat-1', parent_id: 'scene-1', node_type: 'beat', actual: 250, order: 0 }),
      node({ id: 'beat-2', parent_id: 'scene-1', node_type: 'beat', actual: 400, order: 1 }),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].data.word_count_actual).toBe(650)
  })

  it('rollup propagates through multiple levels', () => {
    const out = buildTree([
      node({ id: 'book', node_type: 'book', actual: 0 }),
      node({ id: 'act-1', parent_id: 'book', node_type: 'act', actual: 0, order: 0 }),
      node({ id: 'chapter-1', parent_id: 'act-1', node_type: 'chapter', actual: 0, order: 0 }),
      node({ id: 'scene-1', parent_id: 'chapter-1', node_type: 'scene', actual: 0, order: 0 }),
      node({ id: 'beat-1', parent_id: 'scene-1', node_type: 'beat', actual: 300, order: 0 }),
      node({ id: 'beat-2', parent_id: 'scene-1', node_type: 'beat', actual: 400, order: 1 }),
      node({ id: 'beat-3', parent_id: 'scene-1', node_type: 'beat', actual: 100, order: 2 }),
    ])
    // Book → Act → Chapter → Scene → Beats (300+400+100 = 800)
    const book = out[0]
    expect(book.data.word_count_actual).toBe(800)
    expect(book.children?.[0].data.word_count_actual).toBe(800) // act
    expect(book.children?.[0].children?.[0].data.word_count_actual).toBe(800) // chapter
    expect(book.children?.[0].children?.[0].children?.[0].data.word_count_actual).toBe(800) // scene
  })

  it('mixed branches — each parent sums its own subtree', () => {
    const out = buildTree([
      node({ id: 'act-1', node_type: 'act', actual: 0 }),
      node({ id: 'ch-1', parent_id: 'act-1', node_type: 'chapter', actual: 0, order: 0 }),
      node({ id: 'ch-2', parent_id: 'act-1', node_type: 'chapter', actual: 0, order: 1 }),
      node({ id: 'beat-a', parent_id: 'ch-1', node_type: 'beat', actual: 500, order: 0 }),
      node({ id: 'beat-b', parent_id: 'ch-1', node_type: 'beat', actual: 200, order: 1 }),
      node({ id: 'beat-c', parent_id: 'ch-2', node_type: 'beat', actual: 1000, order: 0 }),
    ])
    const act = out[0]
    expect(act.data.word_count_actual).toBe(1700) // 500 + 200 + 1000
    const [ch1, ch2] = act.children ?? []
    expect(ch1.data.word_count_actual).toBe(700) // 500 + 200
    expect(ch2.data.word_count_actual).toBe(1000)
  })

  it('targets are NOT aggregated — authored values at each level survive', () => {
    const out = buildTree([
      node({ id: 'act-1', node_type: 'act', actual: 0, target: 12500 }),
      node({ id: 'beat-1', parent_id: 'act-1', node_type: 'beat', actual: 100, target: 200, order: 0 }),
      node({ id: 'beat-2', parent_id: 'act-1', node_type: 'beat', actual: 200, target: 300, order: 1 }),
    ])
    const act = out[0]
    expect(act.data.word_count_actual).toBe(300)   // aggregated
    expect(act.data.word_count_target).toBe(12500) // authored, NOT sum (which would be 500)
  })

  it('a non-leaf with zero descendant leaves rolls to 0', () => {
    const out = buildTree([
      node({ id: 'act-1', node_type: 'act', actual: 0, target: 5000 }),
      node({ id: 'ch-1', parent_id: 'act-1', node_type: 'chapter', actual: 0, order: 0 }),
    ])
    const act = out[0]
    expect(act.data.word_count_actual).toBe(0)
    expect(act.children?.[0].data.word_count_actual).toBe(0)
  })

  it('preserves the original row reference when no aggregation changes the value (perf)', () => {
    const leafRow = node({ id: 'beat-1', node_type: 'beat', actual: 250 })
    const out = buildTree([leafRow])
    // Leaves should not be cloned (we'd waste memory on every render).
    expect(out[0].data).toBe(leafRow)
  })
})
