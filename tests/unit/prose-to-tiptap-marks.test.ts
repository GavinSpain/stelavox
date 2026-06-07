// 2026-06-06 — parseInlineMarks / plainTextToTiptap Markdown emphasis
// parsing. The synthesise_beat agent occasionally emits `*word*` (italic)
// and `**word**` (bold) Markdown despite the system prompt instructing
// otherwise; the parser now converts those to real Tiptap marks rather
// than leaving them as literal asterisks in the rendered prose.

import { describe, expect, it } from 'vitest'

import {
  parseInlineMarks,
  plainTextToTiptap,
} from '@/lib/agent/prose-to-tiptap'

describe('parseInlineMarks', () => {
  it('returns one plain text node when there is no emphasis', () => {
    expect(parseInlineMarks('Hello world.')).toEqual([
      { type: 'text', text: 'Hello world.' },
    ])
  })

  it('extracts a single italic span', () => {
    expect(parseInlineMarks('He felt *wrong* about it.')).toEqual([
      { type: 'text', text: 'He felt ' },
      { type: 'text', text: 'wrong', marks: [{ type: 'italic' }] },
      { type: 'text', text: ' about it.' },
    ])
  })

  it('extracts a single bold span', () => {
    expect(parseInlineMarks('A **bold** statement.')).toEqual([
      { type: 'text', text: 'A ' },
      { type: 'text', text: 'bold', marks: [{ type: 'bold' }] },
      { type: 'text', text: ' statement.' },
    ])
  })

  it('extracts multiple italic spans in one paragraph', () => {
    const out = parseInlineMarks('*One*, *two*, three.')
    expect(out.filter((n) => n.marks?.[0].type === 'italic').map((n) => n.text))
      .toEqual(['One', 'two'])
  })

  it('prefers bold over italic when both are possible', () => {
    // `**word**` could be interpreted as italic+text+italic; we want
    // it as bold.
    const out = parseInlineMarks('**word**')
    expect(out).toEqual([
      { type: 'text', text: 'word', marks: [{ type: 'bold' }] },
    ])
  })

  it('mixes italic and bold in the same paragraph', () => {
    const out = parseInlineMarks('a *b* c **d** e')
    expect(out.map((n) => ({ text: n.text, mark: n.marks?.[0].type ?? null }))).toEqual([
      { text: 'a ', mark: null },
      { text: 'b', mark: 'italic' },
      { text: ' c ', mark: null },
      { text: 'd', mark: 'bold' },
      { text: ' e', mark: null },
    ])
  })

  it('leaves unbalanced asterisks as literal characters', () => {
    // Lone leading `*` without close stays literal — no match.
    const out = parseInlineMarks('open *paren without close')
    expect(out).toEqual([
      { type: 'text', text: 'open *paren without close' },
    ])
  })

  it('skips whitespace-only emphasis (`* *`)', () => {
    const out = parseInlineMarks('a * * b')
    // The `*  *` would otherwise match italic with whitespace inner.
    // Skipped → falls through to a single literal node.
    expect(out).toEqual([
      { type: 'text', text: 'a * * b' },
    ])
  })

  it('handles emphasis at the start and end of the line', () => {
    expect(parseInlineMarks('*at-start* middle *at-end*')).toEqual([
      { type: 'text', text: 'at-start', marks: [{ type: 'italic' }] },
      { type: 'text', text: ' middle ' },
      { type: 'text', text: 'at-end', marks: [{ type: 'italic' }] },
    ])
  })

  it('handles the user-reported example verbatim', () => {
    const text =
      "He increased magnification and felt the old soldier's instinct kindle in his chest—the one that had kept him alive through a decade of Black Ops: something here was *wrong*."
    const out = parseInlineMarks(text)
    // Should end with a verb in italic followed by a period.
    const wrong = out.find((n) => n.text === 'wrong')
    expect(wrong?.marks?.[0].type).toBe('italic')
    expect(out[out.length - 1].text).toBe('.')
  })

  it('returns empty array on empty input', () => {
    expect(parseInlineMarks('')).toEqual([])
  })
})

describe('plainTextToTiptap with Markdown emphasis', () => {
  it('builds a doc with italic-marked text nodes inside a paragraph', () => {
    const out = plainTextToTiptap('He felt *wrong*.')
    expect(out.type).toBe('doc')
    expect(out.content).toHaveLength(1)
    expect(out.content[0].content).toEqual([
      { type: 'text', text: 'He felt ' },
      { type: 'text', text: 'wrong', marks: [{ type: 'italic' }] },
      { type: 'text', text: '.' },
    ])
  })

  it('parses emphasis independently in each paragraph', () => {
    const out = plainTextToTiptap('*First*.\n\n**Second**.')
    expect(out.content).toHaveLength(2)
    expect(out.content[0].content?.[0].marks?.[0].type).toBe('italic')
    expect(out.content[1].content?.[0].marks?.[0].type).toBe('bold')
  })

  it('plain prose without asterisks behaves exactly as before (backwards compat)', () => {
    const out = plainTextToTiptap('Twisted metal. Hull plating fractured.')
    expect(out.content[0].content).toEqual([
      { type: 'text', text: 'Twisted metal. Hull plating fractured.' },
    ])
  })
})
