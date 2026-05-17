/**
 * Phase 7.C — Outline (Markdown) renderer.
 *
 * 7.A substrate stub. Real implementation lands in 7.C.
 */

import type { ContentBlock, OutlineProfileConfig } from './types'

interface WalkContext {
  blocks: ContentBlock[]
  chapter_indices: number[]
  total_chapters: number
  total_word_count: number
}

export async function renderOutline(
  _blocks: ContentBlock[],
  _walked: WalkContext,
  _config: OutlineProfileConfig,
  _onChapterRendered: (chapterName: string | null) => Promise<void>,
): Promise<string> {
  throw new Error('renderOutline: pending 7.C implementation')
}
