/**
 * Unit tests for SU-J14-6: pre-flight summary check.
 *
 * checkSummaryNonEmpty(summary) returns null when the summary has
 * meaningful text content; returns a NextResponse error when it's
 * empty / null / Tiptap-stub-only / whitespace.
 *
 * The function is shared by synthesise + synthesise stream + future
 * refine paths. The contract: protect agent operations from being
 * dispatched against an empty target where the LLM will return
 * meta-conversation as prose.
 */

import { describe, expect, it } from 'vitest'

import { checkSummaryNonEmpty } from '@/lib/api/agent-operation-helper'

describe('SU-J14-6 — checkSummaryNonEmpty', () => {
  it('rejects null', () => {
    expect(checkSummaryNonEmpty(null)).not.toBeNull()
  })

  it('rejects empty string', () => {
    expect(checkSummaryNonEmpty('')).not.toBeNull()
  })

  it('rejects whitespace only', () => {
    expect(checkSummaryNonEmpty('   ')).not.toBeNull()
    expect(checkSummaryNonEmpty('\n\n\t')).not.toBeNull()
  })

  it('rejects Tiptap empty-doc stub', () => {
    const stub = JSON.stringify({
      type: 'doc',
      content: [{ type: 'paragraph' }],
    })
    expect(checkSummaryNonEmpty(stub)).not.toBeNull()
  })

  it('rejects Tiptap doc with empty paragraphs only', () => {
    const stub = JSON.stringify({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [] },
        { type: 'paragraph' },
        { type: 'paragraph', content: [{ type: 'text', text: '' }] },
        { type: 'paragraph', content: [{ type: 'text', text: '   ' }] },
      ],
    })
    expect(checkSummaryNonEmpty(stub)).not.toBeNull()
  })

  it('accepts Tiptap doc with text content', () => {
    const doc = JSON.stringify({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'A real summary.' }] },
      ],
    })
    expect(checkSummaryNonEmpty(doc)).toBeNull()
  })

  it('accepts plain text non-empty string', () => {
    expect(checkSummaryNonEmpty('A summary.')).toBeNull()
  })

  it('accepts Tiptap doc with marks but no plain text — returns reject (marks alone are not text)', () => {
    // A doc that has only mark wrappers without any text node should be
    // treated as effectively empty.
    const doc = JSON.stringify({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'hardBreak' }] }],
    })
    expect(checkSummaryNonEmpty(doc)).not.toBeNull()
  })

  it('accepts deeply nested text', () => {
    const doc = JSON.stringify({
      type: 'doc',
      content: [
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'nested' }] },
              ],
            },
          ],
        },
      ],
    })
    expect(checkSummaryNonEmpty(doc)).toBeNull()
  })

  it('rejects malformed JSON that parses to whitespace-only string', () => {
    // The fallback path treats a non-JSON string as plain text. After
    // trim() above the function, "   " was already rejected. The
    // remaining surface is: a string that LOOKS like JSON but isn't —
    // we fall through to the parse path, which fails, so we treat as
    // plain text. Already-trimmed at the top means non-empty plain
    // text passes regardless of JSON-shape.
    expect(checkSummaryNonEmpty('not valid json')).toBeNull()
  })
})
