/**
 * Phase 8.9 — Sentence Focus ProseMirror plugin.
 *
 * Source: Component Spec v2.21 §6.5.
 *         Phase 8.8 / 8.9 — discoverability + behaviour shipped together.
 *
 * What this plugin does:
 *   - Walks the document on every transaction
 *   - For each paragraph, segments its textContent with `Intl.Segmenter`
 *     ({ granularity: 'sentence' }) — built into Node 18+ and every
 *     modern browser (Chrome 87+, Firefox 125+, Safari 16.4+)
 *   - Produces inline decorations that wrap each sentence in a
 *     `<span data-sentence>` (with no styling — only the attribute).
 *     The CSS rules installed by components/focus/SentenceFocus.tsx
 *     target `[data-sentence]` and `[data-sentence][data-active]` etc.
 *   - The sentence containing the cursor gets `data-active="true"`;
 *     immediate previous + next siblings (by global index across all
 *     paragraphs) get `data-adjacent="true"`. Everything else falls
 *     through to the default 0.55 opacity.
 *
 * Why ProseMirror decorations (not direct DOM manipulation):
 *   Decorations are first-class in ProseMirror — they survive every
 *   transaction automatically, get re-applied on selection changes
 *   without any of our code running, and don't mutate the document
 *   model. Direct DOM wrapping would fight every Tiptap re-render.
 *
 * Hard breaks: the prose editor enables `hardBreak` (StarterKit
 * default). textContent SKIPS hard-break nodes, so a naive offset
 * mapping (`pmPos = paragraphPos + 1 + textOffset`) drifts after the
 * first <br>. The plugin builds a position map by walking the
 * paragraph's children and recording each text node's textContent
 * range alongside its ProseMirror position, then maps Intl.Segmenter
 * offsets back to PM positions via that map.
 *
 * Performance: a 100k-word novel is roughly 5k sentences. The
 * decoration walk is O(n) over text nodes per transaction. Tested
 * acceptable on Shadow Protocol in dev; if it becomes noticeable on
 * larger documents the next move is memoising the per-paragraph
 * segmentation keyed by node identity (paragraphs whose content
 * didn't change skip re-segmentation).
 */

import type { EditorState, Transaction } from '@tiptap/pm/state'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'

export const sentenceFocusPluginKey = new PluginKey<DecorationSet>('stelavox-sentence-focus')

/** One contiguous text run inside a paragraph. Tracks where the run
 *  sits in the paragraph's textContent string and where it sits in
 *  the ProseMirror document. The pair lets us translate Intl.Segmenter
 *  offsets (relative to textContent) back to ProseMirror positions. */
interface TextRange {
  /** Inclusive start offset in textContent. */
  textStart: number
  /** Exclusive end offset in textContent. */
  textEnd: number
  /** Absolute ProseMirror position of the first character of this run. */
  pmStart: number
}

/** Build the position map for one paragraph: its concatenated
 *  textContent string plus the runs that map textContent offsets back
 *  to ProseMirror positions. Skips hard_break nodes (no textContent
 *  contribution but they DO take 1 PM position step, which is why we
 *  need the map). Exported for unit testing. */
export function buildParagraphTextMap(
  paragraph: ProseMirrorNode,
  paragraphPos: number,
): { text: string; ranges: TextRange[] } {
  let text = ''
  const ranges: TextRange[] = []
  // The paragraph's content position offsets are 0-based from the start
  // of its content. Absolute PM position of content start = paragraphPos + 1.
  const contentStart = paragraphPos + 1
  paragraph.forEach((child, offset) => {
    if (child.isText && typeof child.text === 'string') {
      const childText = child.text
      const textStart = text.length
      text += childText
      ranges.push({
        textStart,
        textEnd: text.length,
        pmStart: contentStart + offset,
      })
    }
    // Non-text inline nodes (hard_break) contribute 0 chars to text
    // but child.nodeSize > 0 — the `offset` advances on next iteration.
  })
  return { text, ranges }
}

/** Translate a textContent offset back to a ProseMirror position
 *  inside a paragraph. Exported for unit testing. */
export function textOffsetToPmPos(textOffset: number, ranges: readonly TextRange[]): number {
  for (const r of ranges) {
    if (textOffset >= r.textStart && textOffset <= r.textEnd) {
      return r.pmStart + (textOffset - r.textStart)
    }
  }
  // Past the last range — clamp to the end of the last run. Shouldn't
  // happen if the caller respects the textContent length but guards
  // against off-by-one in segment.index + segment.segment.length.
  if (ranges.length > 0) {
    const last = ranges[ranges.length - 1]
    return last.pmStart + (last.textEnd - last.textStart)
  }
  // Empty paragraph — no valid PM position other than content start.
  return -1
}

/** One segmented sentence's location in the document. */
export interface SentenceSpan {
  pmFrom: number
  pmTo: number
  paragraphPos: number
}

/** Walk the document, segment every paragraph's textContent, and
 *  return one SentenceSpan per sentence with absolute PM positions.
 *  Exported for unit testing. */
export function segmentDocument(doc: ProseMirrorNode): SentenceSpan[] {
  const sentences: SentenceSpan[] = []
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'sentence' })

  doc.descendants((node, pos) => {
    if (node.type.name !== 'paragraph') {
      // Descend into non-paragraph block nodes (in case the doc gets
      // a wrapper later); skip leaf inline nodes.
      return !node.isLeaf
    }
    const { text, ranges } = buildParagraphTextMap(node, pos)
    if (!text || ranges.length === 0) {
      // Empty paragraph — produce a single zero-length span at the
      // content start so the cursor-in-empty-paragraph case has a
      // sentence to be active in.
      const start = pos + 1
      sentences.push({ pmFrom: start, pmTo: start, paragraphPos: pos })
      return false
    }
    for (const segment of segmenter.segment(text)) {
      const startOffset = segment.index
      const endOffset = startOffset + segment.segment.length
      const pmFrom = textOffsetToPmPos(startOffset, ranges)
      const pmTo = textOffsetToPmPos(endOffset, ranges)
      if (pmFrom === -1 || pmTo === -1 || pmTo <= pmFrom) continue
      sentences.push({ pmFrom, pmTo, paragraphPos: pos })
    }
    // Don't descend into the paragraph's text nodes — we already
    // consumed the whole paragraph above.
    return false
  })

  return sentences
}

/** Resolve which sentence in the array contains the given cursor
 *  position. Returns -1 if no sentence contains it (e.g. the cursor
 *  is outside any paragraph). Exported for unit testing.
 *
 *  The cursor is "in" a sentence if cursorPos ∈ [pmFrom, pmTo]. The
 *  boundary inclusivity is deliberate: at sentence boundaries (end of
 *  one sentence === start of the next), the boundary belongs to the
 *  LATER sentence so a cursor right after a period highlights the
 *  fragment the author is about to type next. */
export function findActiveSentenceIndex(
  sentences: readonly SentenceSpan[],
  cursorPos: number,
): number {
  if (sentences.length === 0) return -1
  // Walk back-to-front so a boundary position picks the LATER sentence.
  for (let i = sentences.length - 1; i >= 0; i--) {
    const s = sentences[i]
    if (cursorPos >= s.pmFrom && cursorPos <= s.pmTo) return i
  }
  return -1
}

/** Produce the DecorationSet for the current document + selection. */
function buildDecorations(state: EditorState): DecorationSet {
  const sentences = segmentDocument(state.doc)
  if (sentences.length === 0) return DecorationSet.empty
  const cursorPos = state.selection.head
  const activeIdx = findActiveSentenceIndex(sentences, cursorPos)

  const decorations: Decoration[] = []
  for (let i = 0; i < sentences.length; i++) {
    const s = sentences[i]
    if (s.pmTo <= s.pmFrom) continue // skip empty placeholder spans
    const attrs: Record<string, string> = {}
    if (i === activeIdx) {
      attrs['data-sentence'] = ''
      attrs['data-active'] = 'true'
    } else if (
      activeIdx !== -1 &&
      (i === activeIdx - 1 || i === activeIdx + 1)
    ) {
      attrs['data-sentence'] = ''
      attrs['data-adjacent'] = 'true'
    } else {
      attrs['data-sentence'] = ''
    }
    decorations.push(Decoration.inline(s.pmFrom, s.pmTo, attrs))
  }
  return DecorationSet.create(state.doc, decorations)
}

/** Construct the ProseMirror plugin. Returns a fresh instance —
 *  callers should register one plugin per editor instance and dispose
 *  it when the user toggles Sentence Focus off. */
export function sentenceFocusPlugin(): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: sentenceFocusPluginKey,
    state: {
      init(_config, state) {
        return buildDecorations(state)
      },
      apply(tr: Transaction, oldDecos: DecorationSet, _oldState: EditorState, newState: EditorState) {
        // Recompute on doc changes or selection changes. For pure
        // metadata transactions (e.g., focus events) the previous
        // decoration set is reused — cheap.
        if (tr.docChanged) return buildDecorations(newState)
        if (tr.selectionSet) return buildDecorations(newState)
        return oldDecos
      },
    },
    props: {
      decorations(state) {
        return sentenceFocusPluginKey.getState(state) ?? DecorationSet.empty
      },
    },
  })
}
