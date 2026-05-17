/**
 * Phase 7.D unit tests — DOCX renderer.
 *
 * Tests run against synthetic ContentBlock[] arrays (no DB needed).
 * The actual `docx` library does heavy lifting; we just verify the
 * renderer produces a non-empty Buffer that begins with the ZIP magic
 * bytes (DOCX is a zip), and that the chapter callback fires once
 * per chapter.
 */

import { describe, expect, it } from 'vitest'
import { renderDocx } from '@/lib/export/docx'
import type { ContentBlock } from '@/lib/export/types'

function fakeWalk(blocks: ContentBlock[]) {
  const chapter_indices: number[] = []
  let chapters = 0
  for (let i = 0; i < blocks.length; i++) {
    if (blocks[i].type === 'heading') {
      chapter_indices.push(i)
      chapters += 1
    }
  }
  const total_word_count = blocks
    .filter(b => b.type === 'paragraph')
    .reduce((sum, b) => sum + (b.text?.split(/\s+/).length ?? 0), 0)
  return { blocks, chapter_indices, total_chapters: chapters, total_word_count }
}

describe('Phase 7.D renderDocx', () => {
  it('produces a non-empty Buffer that starts with ZIP magic', async () => {
    const blocks: ContentBlock[] = [
      { type: 'heading', level: 1, text: 'Chapter 1: The Beginning' },
      { type: 'paragraph', text: 'It was a dark and stormy night.' },
      { type: 'scene_separator', text: '* * *' },
      { type: 'paragraph', text: 'The wind howled through the trees.' },
    ]
    const walked = fakeWalk(blocks)
    const buf = await renderDocx(blocks, walked, {}, async () => {})
    expect(Buffer.isBuffer(buf)).toBe(true)
    expect(buf.length).toBeGreaterThan(0)
    // ZIP magic bytes
    expect(buf[0]).toBe(0x50)  // 'P'
    expect(buf[1]).toBe(0x4b)  // 'K'
  })

  it('emits per-chapter progress callback', async () => {
    const blocks: ContentBlock[] = [
      { type: 'heading', level: 1, text: 'Chapter 1: A' },
      { type: 'paragraph', text: 'First chapter prose.' },
      { type: 'heading', level: 1, text: 'Chapter 2: B' },
      { type: 'paragraph', text: 'Second chapter prose.' },
      { type: 'heading', level: 1, text: 'Chapter 3: C' },
      { type: 'paragraph', text: 'Third chapter prose.' },
    ]
    const walked = fakeWalk(blocks)
    const chapterNames: (string | null)[] = []
    await renderDocx(blocks, walked, {},
      async (name) => { chapterNames.push(name) },
    )
    expect(chapterNames).toEqual([
      'Chapter 1: A',
      'Chapter 2: B',
      'Chapter 3: C',
    ])
  })

  it('honours KDP profile config (6x9 + Times + single)', async () => {
    const blocks: ContentBlock[] = [
      { type: 'heading', level: 1, text: 'Chapter 1' },
      { type: 'paragraph', text: 'Content.' },
    ]
    const walked = fakeWalk(blocks)
    const buf = await renderDocx(blocks, walked, {
      page_size: '6x9',
      margins: 'kdp_paperback',
      font: 'times_12',
      line_spacing: 'single',
      first_line_indent_inches: 0.3,
      paragraph_spacing_pt: 0,
      page_numbers: false,
    }, async () => {})
    expect(buf.length).toBeGreaterThan(0)
  })

  it('produces output without front matter when disabled', async () => {
    const blocks: ContentBlock[] = [
      { type: 'heading', level: 1, text: 'Chapter 1' },
      { type: 'paragraph', text: 'Content.' },
    ]
    const walked = fakeWalk(blocks)
    const buf = await renderDocx(blocks, walked, { include_front_matter: false }, async () => {})
    expect(buf.length).toBeGreaterThan(0)
  })
})
