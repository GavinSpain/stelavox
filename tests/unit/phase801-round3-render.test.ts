// Phase 8.01 wireframe-alignment round 3 — render tests for the new
// components.

import { describe, expect, it } from 'vitest'
import { renderToString } from 'react-dom/server'
import React from 'react'

import { TreeLayerHeader } from '@/components/tree/TreeLayerHeader'
import { tokenizeWithMentions, UserMessage } from '@/components/director/UserMessage'

describe('TreeLayerHeader', () => {
  it('renders the five layer cells', () => {
    const html = renderToString(React.createElement(TreeLayerHeader))
    expect(html).toMatch(/data-testid="tree-layer-header"/)
    expect(html).toMatch(/data-testid="tree-layer-cell-book"/)
    expect(html).toMatch(/data-testid="tree-layer-cell-act"/)
    expect(html).toMatch(/data-testid="tree-layer-cell-ch"/)
    expect(html).toMatch(/data-testid="tree-layer-cell-sc"/)
    expect(html).toMatch(/data-testid="tree-layer-cell-bt"/)
  })

  it('Book cell uses --color-accent-hover (brand-mark family colour)', () => {
    const html = renderToString(React.createElement(TreeLayerHeader))
    expect(html).toMatch(
      /<span[^>]*data-testid="tree-layer-cell-book"[^>]*style="[^"]*color:var\(--color-accent-hover\)/,
    )
  })

  it('each label is rendered in the layer-tinted column', () => {
    const html = renderToString(React.createElement(TreeLayerHeader))
    for (const label of ['[Book]', '[Act]', '[Ch]', '[Sc]', '[Bt]']) {
      expect(html).toContain(label)
    }
  })

  it('uses monospace JetBrains Mono', () => {
    const html = renderToString(React.createElement(TreeLayerHeader))
    expect(html).toContain('font-family:ui-monospace')
    expect(html).toContain('JetBrains Mono')
  })
})

describe('UserMessage tokenizer', () => {
  it('returns the whole text as a single text segment when no mentions', () => {
    expect(tokenizeWithMentions('hello world')).toEqual([
      { kind: 'text', value: 'hello world' },
    ])
  })

  it('splits a single mention out of the body', () => {
    const out = tokenizeWithMentions('expand @act1ch1 into scenes')
    expect(out).toEqual([
      { kind: 'text', value: 'expand ' },
      { kind: 'mention', value: '@act1ch1' },
      { kind: 'text', value: ' into scenes' },
    ])
  })

  it('handles multiple mentions in one body', () => {
    const out = tokenizeWithMentions('move @sc1bt2 above @sc1bt3 please')
    const kinds = out.map((s) => s.kind)
    expect(kinds).toEqual(['text', 'mention', 'text', 'mention', 'text'])
    expect((out[1] as { value: string }).value).toBe('@sc1bt2')
    expect((out[3] as { value: string }).value).toBe('@sc1bt3')
  })

  it('terminates mention at punctuation', () => {
    const out = tokenizeWithMentions('refine @ch1, then @ch2.')
    const mentions = out.filter((s) => s.kind === 'mention').map((s) => (s as { value: string }).value)
    expect(mentions).toEqual(['@ch1', '@ch2'])
  })

  it('handles mentions at start and end of body', () => {
    const start = tokenizeWithMentions('@bk1 review everything')
    expect(start[0]).toEqual({ kind: 'mention', value: '@bk1' })
    const end = tokenizeWithMentions('start expansion at @act1')
    expect(end[end.length - 1]).toEqual({ kind: 'mention', value: '@act1' })
  })
})

describe('UserMessage render', () => {
  it('renders metadata strip + body box', () => {
    const html = renderToString(
      React.createElement(UserMessage, { content: 'hello', createdAt: '2026-06-03T10:00:00Z' }),
    )
    expect(html).toMatch(/data-testid="user-message-meta"/)
    expect(html).toMatch(/data-testid="user-message-body"/)
    expect(html).toContain('User')
    expect(html).toContain('hello')
  })

  it('renders mention chip with verdigris (use #11 catalog family colour)', () => {
    const html = renderToString(
      React.createElement(UserMessage, {
        content: 'expand @act1ch1 into scenes',
        createdAt: '2026-06-03T10:00:00Z',
      }),
    )
    expect(html).toMatch(/data-testid="user-message-mention"/)
    expect(html).toMatch(
      /<span[^>]*data-testid="user-message-mention"[^>]*style="[^"]*color:var\(--color-accent-hover\)/,
    )
  })

  it('USER label uses 9.5px / 600 / 0.32em uppercase', () => {
    const html = renderToString(
      React.createElement(UserMessage, { content: 'x', createdAt: '2026-06-03T10:00:00Z' }),
    )
    expect(html).toMatch(/font-size:9.5px/)
    expect(html).toMatch(/font-weight:600/)
    expect(html).toMatch(/letter-spacing:0\.32em/)
    expect(html).toMatch(/text-transform:uppercase/)
  })
})
