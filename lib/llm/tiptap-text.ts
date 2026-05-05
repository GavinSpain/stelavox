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
 * Accepts a JSON string, a JSON object, or null/undefined/empty.
 * Legacy plain-text strings (pre-Tiptap rows) pass through unchanged.
 */
export function extractPlainText(
  input: string | Record<string, unknown> | null | undefined,
): string {
  if (!input) return ''

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
