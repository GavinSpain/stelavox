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
 *      groups, wrap each in { type: 'paragraph', content: [{ type: 'text',
 *      text }] }, all under { type: 'doc', content: [...] }.
 *
 * Markdown is NOT parsed — the prompts forbid it. Any Markdown the model
 * emits despite the instruction lands as literal characters in the text
 * node, recoverable by manual edit post-Accept. This is acceptable for V1
 * and avoids a Markdown-parser dependency.
 */

export interface TiptapTextNode {
  type: 'text'
  text: string
}

export interface TiptapParagraphNode {
  type: 'paragraph'
  content?: TiptapTextNode[]
}

export interface TiptapDocument {
  type: 'doc'
  content: TiptapParagraphNode[]
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
      content: [{ type: 'text', text }],
    })),
  }
}
