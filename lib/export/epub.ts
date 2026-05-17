/**
 * Phase 7.D — EPUB renderer.
 *
 * Uses `epub-gen-memory`. Consumes the ContentBlock[] intermediate from
 * tree-walker.ts. Groups blocks by chapter (heading → paragraphs →
 * next heading), emits one Chapter object per chapter into the
 * epub-gen array.
 */

import { EPub } from 'epub-gen-memory'
import type { ContentBlock, EpubProfileConfig } from './types'

interface WalkContext {
  blocks: ContentBlock[]
  chapter_indices: number[]
  total_chapters: number
  total_word_count: number
}

interface EpubChapter {
  title: string
  content: string
  excludeFromToc?: boolean
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function chapterIndentStyle(indent: 'first_line' | 'blank_line'): string {
  if (indent === 'blank_line') {
    return 'p { margin: 0 0 1em 0; text-indent: 0; }'
  }
  return 'p { margin: 0; text-indent: 1.5em; }'
}

function chapterFontFamily(font: EpubProfileConfig['body_font']): string {
  switch (font) {
    case 'serif': return 'serif'
    case 'sans_serif': return 'sans-serif'
    case 'reader_default':
    default: return 'inherit'
  }
}

export async function renderEpub(
  blocks: ContentBlock[],
  walked: WalkContext,
  config: EpubProfileConfig,
  onChapterRendered: (chapterName: string | null) => Promise<void>,
): Promise<Buffer> {
  void walked

  const indentStyle = chapterIndentStyle(config.paragraph_indent ?? 'first_line')
  const fontFamily = chapterFontFamily(config.body_font)
  const sceneSeparator = config.scene_separator ?? '* * *'

  const css = `
body { font-family: ${fontFamily}; line-height: 1.6; }
${indentStyle}
h1 { text-align: center; margin: 2em 0 1em; }
.scene-sep { text-align: center; margin: 1.5em 0; }
.first-para { text-indent: 0; }
  `.trim()

  const chapters: EpubChapter[] = []
  let currentChapter: EpubChapter | null = null
  let currentChapterParas: string[] = []
  let firstParagraphInChapter = true

  function flushChapter() {
    if (currentChapter) {
      currentChapter.content = currentChapterParas.join('\n')
      chapters.push(currentChapter)
    }
    currentChapter = null
    currentChapterParas = []
    firstParagraphInChapter = true
  }

  for (const block of blocks) {
    switch (block.type) {
      case 'heading': {
        flushChapter()
        const title = block.text ?? 'Chapter'
        currentChapter = { title, content: '' }
        firstParagraphInChapter = true
        await onChapterRendered(title)
        break
      }
      case 'page_break':
        currentChapterParas.push('<p style="page-break-before: always;"></p>')
        break
      case 'scene_separator':
        currentChapterParas.push(`<p class="scene-sep">${escapeHtml(sceneSeparator)}</p>`)
        firstParagraphInChapter = true
        break
      case 'paragraph': {
        const safe = escapeHtml(block.text ?? '')
        const styles: string[] = []
        if (block.formatting?.italic) styles.push('font-style: italic;')
        if (block.formatting?.bold) styles.push('font-weight: bold;')
        const styleAttr = styles.length > 0 ? ` style="${styles.join(' ')}"` : ''
        const classAttr = firstParagraphInChapter ? ' class="first-para"' : ''
        currentChapterParas.push(`<p${classAttr}${styleAttr}>${safe}</p>`)
        firstParagraphInChapter = false
        break
      }
      case 'front_matter':
        if (!currentChapter) {
          currentChapter = { title: 'Front matter', content: '', excludeFromToc: true }
        }
        currentChapterParas.push(`<p>${escapeHtml(block.text ?? '')}</p>`)
        break
      case 'toc_placeholder':
        break
    }
  }

  flushChapter()

  if (chapters.length === 0) {
    chapters.push({ title: 'Document', content: '<p>(this document has no content)</p>' })
  }

  const epub = new EPub(
    {
      title: config.book_title ?? 'Untitled',
      author: config.book_author ?? 'Unknown',
      description: config.book_description ?? '',
      publisher: 'Stelavox',
      lang: 'en',
      css,
    },
    chapters,
  )

  await epub.render()
  const buffer = await epub.genEpub()
  return Buffer.from(buffer)
}
