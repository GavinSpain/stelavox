/**
 * Phase 7.D — EPUB renderer.
 *
 * 7.A substrate stub. Real implementation lands in 7.D using the
 * `epub-gen` (or `epub-gen-memory`) npm package.
 */

import type { ContentBlock, EpubProfileConfig } from './types'

interface WalkContext {
  blocks: ContentBlock[]
  chapter_indices: number[]
  total_chapters: number
  total_word_count: number
}

export async function renderEpub(
  _blocks: ContentBlock[],
  _walked: WalkContext,
  _config: EpubProfileConfig,
  _onChapterRendered: (chapterName: string | null) => Promise<void>,
): Promise<Buffer> {
  throw new Error('renderEpub: pending 7.D implementation')
}
