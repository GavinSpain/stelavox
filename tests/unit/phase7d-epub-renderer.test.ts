/**
 * Phase 7.D unit tests — EPUB renderer.
 */

import { describe, expect, it } from 'vitest'
import { renderEpub } from '@/lib/export/epub'
import type { ContentBlock } from '@/lib/export/types'

function fakeWalk(blocks: ContentBlock[]) {
  let chapters = 0
  for (const b of blocks) if (b.type === 'heading') chapters += 1
  return { blocks, chapter_indices: [], total_chapters: chapters, total_word_count: 100 }
}

describe('Phase 7.D renderEpub', () => {
  it('produces a non-empty Buffer that starts with ZIP magic (EPUB is a zip)', async () => {
    const blocks: ContentBlock[] = [
      { type: 'heading', level: 1, text: 'Chapter 1: The Beginning' },
      { type: 'paragraph', text: 'It was a dark and stormy night.' },
    ]
    const walked = fakeWalk(blocks)
    const buf = await renderEpub(blocks, walked, {
      book_title: 'Test Book',
      book_author: 'Test Author',
    }, async () => {})
    expect(Buffer.isBuffer(buf)).toBe(true)
    expect(buf.length).toBeGreaterThan(0)
    // ZIP magic
    expect(buf[0]).toBe(0x50)
    expect(buf[1]).toBe(0x4b)
  })

  it('emits per-chapter progress callback', async () => {
    const blocks: ContentBlock[] = [
      { type: 'heading', level: 1, text: 'Chapter 1' },
      { type: 'paragraph', text: 'One.' },
      { type: 'heading', level: 1, text: 'Chapter 2' },
      { type: 'paragraph', text: 'Two.' },
    ]
    const walked = fakeWalk(blocks)
    const chapters: (string | null)[] = []
    await renderEpub(blocks, walked, {
      book_title: 'T', book_author: 'A',
    }, async name => { chapters.push(name) })
    expect(chapters).toEqual(['Chapter 1', 'Chapter 2'])
  })

  it('handles documents with no content gracefully', async () => {
    const blocks: ContentBlock[] = []
    const walked = fakeWalk(blocks)
    const buf = await renderEpub(blocks, walked, {
      book_title: 'Empty', book_author: 'Test',
    }, async () => {})
    expect(buf.length).toBeGreaterThan(0)
  })

  it('respects scene separator config', async () => {
    const blocks: ContentBlock[] = [
      { type: 'heading', level: 1, text: 'Chapter 1' },
      { type: 'paragraph', text: 'First scene.' },
      { type: 'scene_separator', text: '* * *' },
      { type: 'paragraph', text: 'Second scene.' },
    ]
    const walked = fakeWalk(blocks)
    const buf = await renderEpub(blocks, walked, {
      book_title: 'Test', book_author: 'Test',
      scene_separator: '◆',
    }, async () => {})
    expect(buf.length).toBeGreaterThan(0)
  })
})
