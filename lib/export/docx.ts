/**
 * Phase 7.D — DOCX renderer.
 *
 * 7.A substrate stub. Real implementation lands in 7.D using the
 * `docx` npm package.
 */

import type { ContentBlock, DocxProfileConfig } from './types'

interface WalkContext {
  blocks: ContentBlock[]
  chapter_indices: number[]
  total_chapters: number
  total_word_count: number
}

export async function renderDocx(
  _blocks: ContentBlock[],
  _walked: WalkContext,
  _config: DocxProfileConfig,
  _onChapterRendered: (chapterName: string | null) => Promise<void>,
): Promise<Buffer> {
  throw new Error('renderDocx: pending 7.D implementation')
}
