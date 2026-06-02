// Phase 8.01.C T-9 — tool-call grouping algorithm.

import { describe, expect, it } from 'vitest'

import {
  GROUP_THRESHOLD,
  READ_TOOLS,
  groupToolCalls,
  summarizeCall,
  summarizeGroup,
} from '@/lib/director/groupToolCalls'

function call(name: string, args: Record<string, unknown> = {}) {
  return { name, arguments: args }
}

describe('groupToolCalls', () => {
  it('empty input → no chips', () => {
    expect(groupToolCalls([])).toEqual([])
  })

  it('single read call → 1 individual chip', () => {
    const chips = groupToolCalls([call('get_node', { node_id: 'a' })])
    expect(chips).toHaveLength(1)
    expect(chips[0].kind).toBe('single')
  })

  it('two consecutive read calls → 2 individual chips (below GROUP_THRESHOLD)', () => {
    const chips = groupToolCalls([
      call('get_node', { node_id: 'a' }),
      call('find_node_by_name', { name: 'Marcus' }),
    ])
    expect(chips.filter((c) => c.kind === 'single')).toHaveLength(2)
    expect(chips.filter((c) => c.kind === 'group')).toHaveLength(0)
  })

  it('three consecutive read calls → 1 grouped chip', () => {
    const chips = groupToolCalls([
      call('get_node', { node_id: 'a' }),
      call('get_node', { node_id: 'b' }),
      call('get_node', { node_id: 'c' }),
    ])
    expect(chips).toHaveLength(1)
    expect(chips[0].kind).toBe('group')
    if (chips[0].kind === 'group') {
      expect(chips[0].calls).toHaveLength(3)
    }
  })

  it('5 consecutive reads + 1 write + 2 reads → group(5) + single(write) + 2 singles(reads)', () => {
    const chips = groupToolCalls([
      call('get_node'),
      call('get_node'),
      call('get_node'),
      call('get_node'),
      call('get_node'),
      call('propose_workflow'), // write tool — breaks the run
      call('get_node'),
      call('find_node_by_name'),
    ])
    // First 5 group; then write; then 2 reads below threshold.
    expect(chips).toHaveLength(4)
    expect(chips[0].kind).toBe('group')
    if (chips[0].kind === 'group') expect(chips[0].calls).toHaveLength(5)
    expect(chips[1].kind).toBe('single')
    expect(chips[1].kind === 'single' && chips[1].call.name).toBe('propose_workflow')
    expect(chips[2].kind).toBe('single')
    expect(chips[3].kind).toBe('single')
  })

  it('GROUP_THRESHOLD constant exposed as 3', () => {
    expect(GROUP_THRESHOLD).toBe(3)
  })

  it('READ_TOOLS includes the V1 read-tool set', () => {
    expect(READ_TOOLS.has('get_node')).toBe(true)
    expect(READ_TOOLS.has('find_node_by_name')).toBe(true)
    expect(READ_TOOLS.has('get_subtree_content')).toBe(true)
    expect(READ_TOOLS.has('propose_workflow')).toBe(false)
  })
})

describe('summarizeGroup', () => {
  it('multiple distinct node ids → "Looked at N nodes"', () => {
    const out = summarizeGroup([
      call('get_node', { node_id: 'a' }),
      call('get_node', { node_id: 'b' }),
      call('get_node', { node_id: 'c' }),
    ])
    expect(out).toBe('Looked at 3 nodes')
  })

  it('all calls target the same node → "Looked at this node N ways"', () => {
    const out = summarizeGroup([
      call('get_node', { node_id: 'a' }),
      call('get_subtree_content', { node_id: 'a' }),
      call('get_node', { node_id: 'a' }),
    ])
    expect(out).toBe('Looked at this node 3 ways')
  })

  it('calls with no targets → generic "Read N items"', () => {
    const out = summarizeGroup([
      call('find_node_by_name', { name: 'A' }),
      call('find_node_by_name', { name: 'B' }),
      call('find_node_by_name', { name: 'C' }),
    ])
    expect(out).toBe('Read 3 items')
  })
})

describe('summarizeCall', () => {
  it('truncates UUIDs to last 4 hex digits', () => {
    expect(summarizeCall(call('get_node', { node_id: '0123456789abcdef0123456789abcdef' })))
      .toBe('get_node(node_id: …cdef)')
  })

  it('quotes strings under 30 chars', () => {
    expect(summarizeCall(call('find_node_by_name', { name: 'Marcus' })))
      .toBe('find_node_by_name(name: "Marcus")')
  })

  it('no arguments → bare parens', () => {
    expect(summarizeCall(call('get_scheduler_state', {}))).toBe('get_scheduler_state()')
  })
})
