/**
 * Tiptap JSON → plain text extractor.
 *
 * Source: stelavox_technical_architecture_v1_8.md §5 H-06.
 * Build Checklist T-4.2.
 *
 * Per H-06: "Tiptap content must be serialised to plain text before LLM
 * prompt inclusion. ... Always use Tiptap's text-extraction utility before
 * including content in any prompt."
 *
 * Implementation note: rather than importing Tiptap's `generateText()`
 * (which requires the full extension list and isn't trivially portable
 * to the Deno-based Edge Function runtime), this module walks the
 * Tiptap JSON tree directly. Text nodes contribute their `text` value;
 * paragraphs and other block nodes are joined with `\n\n`; list items
 * with `\n`. The extracted text is byte-for-byte equivalent to what
 * Tiptap's `generateText()` would produce for the editor's restricted
 * extension set (no headings, no code blocks, etc. — see lib/editor/extensions.ts).
 *
 * Phase 5 stores `nodes.summary` / `nodes.prose` / `nodes.notes` as
 * Tiptap document JSON serialised through JSON.stringify(); the
 * fromStorage helper in lib/editor/serialise.ts parses it back. This
 * module accepts either: a JSON string (parsed first), a JSON object
 * (walked directly), or null/undefined/empty-string (returns "").
 */

interface TiptapNode {
  type?: string
  text?: string
  content?: TiptapNode[]
  attrs?: Record<string, unknown>
}

const BLOCK_NODE_TYPES = new Set([
  'paragraph',
  'heading',
  'blockquote',
  'codeBlock',
  'horizontalRule',
])

const LIST_ITEM_TYPES = new Set([
  'listItem',
  'taskItem',
])

/**
 * Extract plain text from a Tiptap JSON document.
 * Accepts:
 *   - A JSON string (legacy TEXT rows pre-Migration 042)
 *   - A JSON object (post-Migration 042 JSONB rows; supabase-js parses
 *     JSONB to JS values automatically)
 *   - null/undefined/empty
 *   - Any other Json scalar (number/boolean) — coerced via JSON.stringify
 *     so the model still sees something rather than crashing
 *
 * B4.5 (round-3 audit F-269): Migration 042 converted nodes.summary /
 * nodes.prose / nodes.notes from TEXT to JSONB. supabase-js returns
 * JSONB columns as the parsed JS value, so this function now sees
 * objects directly. The string branch is kept for backwards-compat
 * with code that still hand-stringifies (e.g. workflow-executor).
 *
 * Type accepts the broad `Json` union from the generated database
 * types so all node read sites flow through cleanly.
 */
export function extractPlainText(
  input: string | number | boolean | Record<string, unknown> | unknown[] | null | undefined,
): string {
  if (input === null || input === undefined) return ''
  if (input === '') return ''

  // String input — try to parse as JSON; if that fails, treat as legacy plain text.
  if (typeof input === 'string') {
    if (!input.trim()) return ''
    try {
      const parsed = JSON.parse(input) as TiptapNode
      return walkNode(parsed).trim()
    } catch {
      return input
    }
  }

  // Number/boolean from the Json union — coerce defensively so callers
  // don't crash. These shouldn't actually appear in practice (the columns
  // store Tiptap doc objects), but the type system forces us to handle
  // them.
  if (typeof input === 'number' || typeof input === 'boolean') {
    return String(input)
  }

  return walkNode(input as TiptapNode).trim()
}

/** Recursively walk a Tiptap node, returning its plain-text representation. */
function walkNode(node: TiptapNode): string {
  // Text nodes contribute their literal text.
  if (node.type === 'text' && node.text) {
    return node.text
  }

  // Hard-break nodes contribute a newline.
  if (node.type === 'hardBreak') {
    return '\n'
  }

  // Walk children if present.
  const childrenText = (node.content ?? []).map(walkNode)

  // Block-level nodes: join children inline, then append paragraph break.
  if (node.type && BLOCK_NODE_TYPES.has(node.type)) {
    return childrenText.join('') + '\n\n'
  }

  // List items: join children inline, then append a single newline.
  if (node.type && LIST_ITEM_TYPES.has(node.type)) {
    return childrenText.join('').trimEnd() + '\n'
  }

  // Lists themselves: join items, no extra separator.
  if (node.type === 'bulletList' || node.type === 'orderedList') {
    return childrenText.join('') + '\n'
  }

  // Doc and any other container: join children.
  return childrenText.join('')
}
