/**
 * Plain-text → Tiptap document JSON converter.
 *
 * Source: stelavox_phase5_api_contract_v1_0.md v1.2 §5 G-9.
 * Build Checklist T-5.1.
 *
 * The agent profile prompts (synthesise_beat, refine_beat_prose, refine
 * variants of summary/notes) instruct the model to emit plain text — no
 * Markdown, paragraphs separated by blank lines. The Edge Function stores
 * that plain text in agent_jobs.result_summary / result_prose / result_notes.
 *
 * The Accept route (API Contract §3.7) calls plainTextToTiptap() before
 * writing the result to nodes.summary / nodes.prose / nodes.notes — the
 * editors (SummaryEditor, ProseEditor, NotesEditor) all read Tiptap JSON.
 *
 * Algorithm:
 *   1. Trim outer whitespace.
 *   2. Empty/whitespace-only input → empty doc with one empty paragraph.
 *   3. Otherwise: split on blank lines (\n\s*\n), trim each, drop empty
 *      groups, wrap each in { type: 'paragraph', content: [...] }, all
 *      under { type: 'doc', content: [...] }.
 *   4. Inside each paragraph: scan for `**bold**` and `*italic*` Markdown
 *      emphasis and split into text nodes with the appropriate marks
 *      (see parseInlineMarks below). 2026-06-06 follow-up — earlier V1
 *      design said "prompts forbid Markdown so we don't parse it"; in
 *      practice synthesise_beat still emits `*word*` style emphasis
 *      occasionally (the model's training pulls it in), and the literal
 *      asterisks reached the rendered prose. Parsing converts them to
 *      real italic/bold marks instead.
 *
 * Edge cases handled:
 *   - Unbalanced asterisks: a lone `*` with no matching close is left as
 *     literal (regex non-greedy + bounded by start/end of paragraph).
 *   - Whitespace-only emphasis (`* *` or `**  **`): kept as literal —
 *     emphasis around whitespace isn't intentional.
 *   - Bold preferred over italic (alternation tries `**` first), so
 *     `**word**` becomes bold instead of italic+text+italic.
 *
 * Heading / list / link Markdown is still NOT parsed — only inline
 * emphasis, the only kind the model actually emits.
 */

export interface TiptapMark {
  type: 'italic' | 'bold'
}

export interface TiptapTextNode {
  type: 'text'
  text: string
  marks?: TiptapMark[]
}

export interface TiptapParagraphNode {
  type: 'paragraph'
  content?: TiptapTextNode[]
}

export interface TiptapDocument {
  type: 'doc'
  content: TiptapParagraphNode[]
}

/** Scan one paragraph's worth of text and split it into Tiptap text
 *  nodes, applying italic / bold marks for Markdown emphasis spans.
 *  Exported for unit tests. */
export function parseInlineMarks(text: string): TiptapTextNode[] {
  if (text.length === 0) return []
  const nodes: TiptapTextNode[] = []
  // Alternation tries `**...**` (bold) first, then `*...*` (italic).
  // The non-greedy `.+?` prevents a single regex hit from gobbling
  // multiple emphasis spans. Capture groups: 1 = bold inner, 2 = italic
  // inner. Multiline doesn't matter — we run this per paragraph.
  const re = /\*\*(.+?)\*\*|\*(.+?)\*/g
  let lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const inner = m[1] ?? m[2] ?? ''
    const isWhitespaceOnly = inner.trim().length === 0
    if (isWhitespaceOnly) {
      // Skip — emphasis around whitespace isn't intentional. The
      // literal characters stay in the surrounding-text run; advance
      // re.lastIndex past the match so we don't infinite-loop.
      continue
    }
    if (m.index > lastIndex) {
      nodes.push({ type: 'text', text: text.slice(lastIndex, m.index) })
    }
    const mark: TiptapMark = m[1] !== undefined ? { type: 'bold' } : { type: 'italic' }
    nodes.push({ type: 'text', text: inner, marks: [mark] })
    lastIndex = m.index + m[0].length
  }
  if (lastIndex < text.length) {
    nodes.push({ type: 'text', text: text.slice(lastIndex) })
  }
  // If nothing matched at all, return a single text node — preserves
  // the original API shape for unstyled paragraphs.
  if (nodes.length === 0) return [{ type: 'text', text }]
  return nodes
}

export function plainTextToTiptap(plainText: string): TiptapDocument {
  if (!plainText || !plainText.trim()) {
    return { type: 'doc', content: [{ type: 'paragraph' }] }
  }

  // Split on blank lines (one or more empty/whitespace-only lines between
  // paragraphs). Handles \r\n line endings the same as \n.
  const paragraphs = plainText
    .replace(/\r\n/g, '\n')
    .split(/\n\s*\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0)

  if (paragraphs.length === 0) {
    return { type: 'doc', content: [{ type: 'paragraph' }] }
  }

  return {
    type: 'doc',
    content: paragraphs.map((text) => ({
      type: 'paragraph',
      content: parseInlineMarks(text),
    })),
  }
}
