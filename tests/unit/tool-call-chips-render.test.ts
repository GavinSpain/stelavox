// Phase 8.01.C T-9 — ToolCallChips render contract.

import { describe, expect, it } from 'vitest'
import { renderToString } from 'react-dom/server'
import React from 'react'

import { ToolCallChips } from '@/components/director/ToolCallChips'

function call(name: string, args: Record<string, unknown> = {}) {
  return { name, arguments: args }
}

describe('ToolCallChips', () => {
  it('renders nothing when calls is empty', () => {
    const html = renderToString(React.createElement(ToolCallChips, { calls: [] }))
    expect(html).toBe('')
  })

  it('single chip for a single tool call', () => {
    const html = renderToString(
      React.createElement(ToolCallChips, {
        calls: [call('find_node_by_name', { name: 'Marcus' })],
      }),
    )
    expect(html).toMatch(/data-testid="tool-call-chip"/)
    expect(html).toMatch(/data-tool-name="find_node_by_name"/)
    expect(html).toContain('find_node_by_name(name: &quot;Marcus&quot;)')
    expect(html).not.toMatch(/data-testid="tool-call-group"/)
  })

  it('3 consecutive reads render as a single grouped chip (collapsed)', () => {
    const html = renderToString(
      React.createElement(ToolCallChips, {
        calls: [
          call('get_node', { node_id: 'a' }),
          call('get_node', { node_id: 'b' }),
          call('get_node', { node_id: 'c' }),
        ],
      }),
    )
    expect(html).toMatch(/data-testid="tool-call-group"/)
    expect(html).toMatch(/data-count="3"/)
    expect(html).toMatch(/data-state="collapsed"/)
    expect(html).toContain('Looked at 3 nodes')
  })

  it('mixed sequence: 1 read + 1 write + 1 read → all individual chips', () => {
    const html = renderToString(
      React.createElement(ToolCallChips, {
        calls: [
          call('get_node', { node_id: 'a' }),
          call('propose_workflow'),
          call('get_node', { node_id: 'b' }),
        ],
      }),
    )
    expect(html).not.toMatch(/data-testid="tool-call-group"/)
    const singleMatches = html.match(/data-testid="tool-call-chip"/g) ?? []
    expect(singleMatches.length).toBe(3)
  })

  it('container has data-testid="tool-call-chips"', () => {
    const html = renderToString(
      React.createElement(ToolCallChips, { calls: [call('get_node')] }),
    )
    expect(html).toMatch(/data-testid="tool-call-chips"/)
  })
})
