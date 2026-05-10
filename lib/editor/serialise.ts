import type { Editor } from '@tiptap/react'
import type { JSONContent } from '@tiptap/core'

// Wire format for nodes.summary / prose / notes is a Tiptap document
// JSON. Pre-Migration 042 (B4.5 / F-269) the column was TEXT and the
// application stored a JSON-stringified Tiptap doc. Post-042 the column
// is JSONB and the application stores the document object directly.
//
// **Client-side wire format unchanged**: editor-store + the three
// editor components still produce/consume JSON strings via toStorage /
// fromStorage. The string→object coercion happens server-side in the
// API routes via `normalizeContent` below. This keeps the editor-prop
// surface (`value: string | null`, `onChange: (s: string) => void`)
// stable across the migration; only the DB layer's actual storage
// shape changes.
//
// fromStorage is updated to accept either a string (legacy / API
// response when the column was TEXT, plus any caller passing a
// pre-stringified payload) or an object (post-042 supabase-js return).

export function toStorage(editor: Editor): string {
  return JSON.stringify(editor.getJSON())
}

export function fromStorage(value: unknown): JSONContent | null {
  if (value === null || value === undefined) return null
  // Object — the post-Migration-042 path. supabase-js returns JSONB
  // columns as JS values directly.
  if (typeof value === 'object') {
    return value as JSONContent
  }
  // String path — legacy or stringified-by-caller. Try to parse.
  if (typeof value === 'string') {
    if (value.trim() === '') return null
    try {
      return JSON.parse(value) as JSONContent
    } catch {
      return null
    }
  }
  return null
}

/**
 * Server-side normaliser: coerce a wire-format content value into the
 * JSONContent shape we store in JSONB. Accepts:
 *   - A JSONContent object (passes through)
 *   - A JSON-stringified Tiptap doc (parsed)
 *   - A plain-text string (wrapped into a single-paragraph Tiptap doc)
 *   - null / undefined / empty string (returns null)
 *
 * Used by API routes (PATCH /api/nodes/[id], POST /api/documents/[id]/nodes,
 * etc.) to ensure that what reaches the lib/data wrappers — and
 * therefore PostgREST — is always a JSONB object, never a stringified
 * payload that PostgreSQL would store as a JSONB primitive string.
 *
 * B4.5 (round-3 audit F-269).
 */
export function normalizeContent(
  value: string | JSONContent | null | undefined,
): JSONContent | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'object') return value
  if (value === '') return null
  // String — try JSON first; fall back to plain-text-wrapped doc.
  try {
    return JSON.parse(value) as JSONContent
  } catch {
    return {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: value }],
        },
      ],
    }
  }
}
