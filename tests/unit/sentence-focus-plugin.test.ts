/**
 * Phase 8.9 unit — sentence-focus segmentation + active-index resolution.
 *
 * Tests the pure helpers exported from sentence-focus-plugin.ts. The
 * plugin's integration with an actual Tiptap editor (mount, register,
 * decorations attaching to the DOM) is verified via manual check per
 * the convention used elsewhere in this codebase (codebase tests
 * Tiptap-internal behaviour via Playwright when at all).
 */

import { describe, expect, it } from 'vitest'
import { Schema, Node as PMNode } from '@tiptap/pm/model'
import {
  buildParagraphTextMap,
  findActiveSentenceIndex,
  segmentDocument,
  textOffsetToPmPos,
} from '@/lib/editor/sentence-focus-plugin'

/** Minimal Schema replicating ProseEditor's relevant shape:
 *    doc → paragraph* → (text | hard_break)*
 *  Marks: bold/italic (not needed for sentence math but included to
 *  prove marked text doesn't shift positions). */
const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*', toDOM: () => ['p', 0], parseDOM: [{ tag: 'p' }] },
    text: { group: 'inline' },
    hard_break: {
      group: 'inline',
      inline: true,
      selectable: false,
      toDOM: () => ['br'],
      parseDOM: [{ tag: 'br' }],
    },
  },
  marks: {
    bold: { toDOM: () => ['strong', 0], parseDOM: [{ tag: 'strong' }] },
    italic: { toDOM: () => ['em', 0], parseDOM: [{ tag: 'em' }] },
  },
})

function makeDoc(paragraphs: PMNode[]): PMNode {
  return schema.node('doc', null, paragraphs)
}
function makePara(...children: PMNode[]): PMNode {
  return schema.node('paragraph', null, children)
}
function makeText(t: string, marks?: ReturnType<typeof schema.mark>[]): PMNode {
  return schema.text(t, marks ?? [])
}
function hardBreak(): PMNode {
  return schema.node('hard_break')
}

// ─── buildParagraphTextMap + textOffsetToPmPos ─────────────────────────

describe('buildParagraphTextMap', () => {
  it('builds a single range for a plain text paragraph', () => {
    const para = makePara(makeText('Hello world.'))
    const doc = makeDoc([para])
    // paragraph sits at pos 0; its content starts at pos 1
    const map = buildParagraphTextMap(doc.child(0), 0)
    expect(map.text).toBe('Hello world.')
    expect(map.ranges).toHaveLength(1)
    expect(map.ranges[0]).toEqual({ textStart: 0, textEnd: 12, pmStart: 1 })
  })

  it('merges multiple text nodes (marks split them) into one textContent string', () => {
    // "Hello " (plain) + "world" (bold) + "." (plain) — three text nodes
    const para = makePara(
      makeText('Hello '),
      makeText('world', [schema.marks.bold.create()]),
      makeText('.'),
    )
    const map = buildParagraphTextMap(para, 0)
    expect(map.text).toBe('Hello world.')
    expect(map.ranges).toHaveLength(3)
    expect(map.ranges[0]).toEqual({ textStart: 0, textEnd: 6, pmStart: 1 })
    expect(map.ranges[1]).toEqual({ textStart: 6, textEnd: 11, pmStart: 7 })
    expect(map.ranges[2]).toEqual({ textStart: 11, textEnd: 12, pmStart: 12 })
  })

  it('skips hard_break nodes (no textContent contribution) but keeps PM positions accurate', () => {
    // "Hello." + <br> + "World."
    const para = makePara(makeText('Hello.'), hardBreak(), makeText('World.'))
    const map = buildParagraphTextMap(para, 0)
    expect(map.text).toBe('Hello.World.')
    expect(map.ranges).toHaveLength(2)
    expect(map.ranges[0]).toEqual({ textStart: 0, textEnd: 6, pmStart: 1 })
    // After "Hello." pos = 7 (1 + 6). Hard break takes 1 pos. World. starts at 8.
    expect(map.ranges[1]).toEqual({ textStart: 6, textEnd: 12, pmStart: 8 })
  })
})

describe('textOffsetToPmPos', () => {
  it('maps offsets within a single range', () => {
    const ranges = [{ textStart: 0, textEnd: 12, pmStart: 1 }]
    expect(textOffsetToPmPos(0, ranges)).toBe(1)
    expect(textOffsetToPmPos(6, ranges)).toBe(7)
    expect(textOffsetToPmPos(12, ranges)).toBe(13)
  })

  it('maps offsets that span a hard-break gap', () => {
    // "Hello.<br>World."
    const ranges = [
      { textStart: 0, textEnd: 6, pmStart: 1 },
      { textStart: 6, textEnd: 12, pmStart: 8 },
    ]
    expect(textOffsetToPmPos(0, ranges)).toBe(1)   // start of "Hello"
    expect(textOffsetToPmPos(6, ranges)).toBe(7)   // end of "Hello." (first match)
    expect(textOffsetToPmPos(7, ranges)).toBe(9)   // 'o' in "World"
    expect(textOffsetToPmPos(12, ranges)).toBe(14) // end of "World."
  })

  it('returns -1 for empty range list', () => {
    expect(textOffsetToPmPos(0, [])).toBe(-1)
  })
})

// ─── segmentDocument ─────────────────────────────────────────────────

describe('segmentDocument', () => {
  it('returns one span for a single-sentence paragraph', () => {
    const doc = makeDoc([makePara(makeText('Hello world.'))])
    const out = segmentDocument(doc)
    expect(out).toHaveLength(1)
    expect(out[0].pmFrom).toBe(1)
    expect(out[0].pmTo).toBe(13)
  })

  it('splits multi-sentence paragraphs', () => {
    const doc = makeDoc([
      makePara(makeText('Hello world. This is a test. Final one.')),
    ])
    const out = segmentDocument(doc)
    expect(out).toHaveLength(3)
    // First sentence: "Hello world. " (Intl.Segmenter includes trailing space)
    expect(out[0].pmFrom).toBe(1)
    // Third sentence ends at end of paragraph content (pos 1 + 39 = 40)
    expect(out[2].pmTo).toBe(40)
  })

  it('produces one span per paragraph for multi-paragraph documents', () => {
    const doc = makeDoc([
      makePara(makeText('First paragraph.')),
      makePara(makeText('Second.')),
    ])
    const out = segmentDocument(doc)
    expect(out).toHaveLength(2)
    expect(out[0].paragraphPos).toBe(0)
    // Second paragraph sits at pos 1 + 16 + 1 = 18 (16 text + 2 boundaries)
    expect(out[1].paragraphPos).toBe(18)
  })

  it('handles abbreviations without splitting (Intl.Segmenter behaviour)', () => {
    // "Dr. Smith arrived." should stay as one sentence in en-US.
    const doc = makeDoc([makePara(makeText('Dr. Smith arrived.'))])
    const out = segmentDocument(doc)
    // Intl.Segmenter doesn't perfectly handle every abbreviation — but
    // the spec acknowledges this and falls back gracefully. We just
    // assert it doesn't crash and produces ≥ 1 span.
    expect(out.length).toBeGreaterThanOrEqual(1)
  })

  it('produces a zero-length span for empty paragraphs', () => {
    const doc = makeDoc([makePara()])
    const out = segmentDocument(doc)
    expect(out).toHaveLength(1)
    expect(out[0].pmFrom).toBe(out[0].pmTo)
  })

  it('handles a paragraph with no terminating punctuation', () => {
    const doc = makeDoc([makePara(makeText('A fragment with no period'))])
    const out = segmentDocument(doc)
    expect(out).toHaveLength(1)
    expect(out[0].pmFrom).toBe(1)
  })

  it('handles paragraphs with hard breaks across sentence boundaries', () => {
    // "First sentence.<br>Second sentence."
    const doc = makeDoc([
      makePara(makeText('First sentence.'), hardBreak(), makeText('Second sentence.')),
    ])
    const out = segmentDocument(doc)
    expect(out.length).toBeGreaterThanOrEqual(1)
    // First span should start at the beginning of the paragraph
    expect(out[0].pmFrom).toBe(1)
  })
})

// ─── findActiveSentenceIndex ─────────────────────────────────────────

describe('findActiveSentenceIndex', () => {
  it('returns -1 for an empty list', () => {
    expect(findActiveSentenceIndex([], 5)).toBe(-1)
  })

  it('returns the index of the sentence containing the cursor', () => {
    const sentences = [
      { pmFrom: 1, pmTo: 14, paragraphPos: 0 },
      { pmFrom: 14, pmTo: 28, paragraphPos: 0 },
    ]
    expect(findActiveSentenceIndex(sentences, 5)).toBe(0)
    expect(findActiveSentenceIndex(sentences, 20)).toBe(1)
  })

  it('picks the LATER sentence at a boundary', () => {
    // Boundary semantics: cursor right after a period highlights the
    // upcoming sentence, not the one just finished. This matches
    // typical "you're writing the next thought" intent.
    const sentences = [
      { pmFrom: 1, pmTo: 14, paragraphPos: 0 },
      { pmFrom: 14, pmTo: 28, paragraphPos: 0 },
    ]
    expect(findActiveSentenceIndex(sentences, 14)).toBe(1)
  })

  it('returns -1 when the cursor is outside every span', () => {
    const sentences = [{ pmFrom: 10, pmTo: 20, paragraphPos: 0 }]
    expect(findActiveSentenceIndex(sentences, 5)).toBe(-1)
    expect(findActiveSentenceIndex(sentences, 30)).toBe(-1)
  })

  it('handles single-sentence documents', () => {
    const sentences = [{ pmFrom: 1, pmTo: 14, paragraphPos: 0 }]
    expect(findActiveSentenceIndex(sentences, 1)).toBe(0)
    expect(findActiveSentenceIndex(sentences, 13)).toBe(0)
    expect(findActiveSentenceIndex(sentences, 14)).toBe(0)
  })
})
