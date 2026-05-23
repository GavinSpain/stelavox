/**
 * Phase 7.D — DOCX renderer.
 *
 * Uses the `docx` npm package. Consumes the ContentBlock[] intermediate
 * from tree-walker.ts (which already applied D11 layer-skipping +
 * scene_separator emission + per-node export_include/override flags).
 */

import {
  Document, Paragraph, TextRun, HeadingLevel, AlignmentType,
  PageBreak, PageNumber, Header, NumberFormat, PageOrientation,
  Packer,
} from 'docx'
import type { ContentBlock, DocxProfileConfig } from './types'

interface WalkContext {
  blocks: ContentBlock[]
  chapter_indices: number[]
  total_chapters: number
  total_word_count: number
}

const TWIP_PER_INCH = 1440

function resolvePageConfig(config: DocxProfileConfig) {
  const sizes: Record<string, { w: number; h: number }> = {
    letter: { w: 8.5 * TWIP_PER_INCH, h: 11 * TWIP_PER_INCH },
    a4: { w: 8.27 * TWIP_PER_INCH, h: 11.69 * TWIP_PER_INCH },
    '6x9': { w: 6 * TWIP_PER_INCH, h: 9 * TWIP_PER_INCH },
    mass_market: { w: 4.25 * TWIP_PER_INCH, h: 6.87 * TWIP_PER_INCH },
  }
  const pageSize = sizes[config.page_size ?? 'letter'] ?? sizes.letter

  const marginsConfig: Record<string, { top: number; right: number; bottom: number; left: number; gutter?: number }> = {
    manuscript: { top: 1, right: 1, bottom: 1, left: 1 },
    kdp_paperback: { top: 0.5, right: 0.5, bottom: 0.5, left: 0.5, gutter: 0.75 },
  }
  const marginsBase = marginsConfig[config.margins ?? 'manuscript'] ?? marginsConfig.manuscript
  const margins = {
    top: marginsBase.top * TWIP_PER_INCH,
    right: marginsBase.right * TWIP_PER_INCH,
    bottom: marginsBase.bottom * TWIP_PER_INCH,
    left: marginsBase.left * TWIP_PER_INCH,
    ...(marginsBase.gutter !== undefined
      ? { gutter: marginsBase.gutter * TWIP_PER_INCH }
      : {}),
  }

  return { width: pageSize.w, height: pageSize.h, margins }
}

function resolveFontConfig(config: DocxProfileConfig): { family: string; size: number } {
  const fonts: Record<string, { family: string; size: number }> = {
    cambria_12: { family: 'Cambria', size: 24 },
    times_12: { family: 'Times New Roman', size: 24 },
    garamond_12: { family: 'Garamond', size: 24 },
    courier_12: { family: 'Courier New', size: 24 },
  }
  return fonts[config.font ?? 'cambria_12'] ?? fonts.cambria_12
}

function resolveLineSpacing(config: DocxProfileConfig): number {
  switch (config.line_spacing ?? 'double') {
    case 'single': return 240
    case '1.5': return 360
    case 'double':
    default: return 480
  }
}

export async function renderDocx(
  blocks: ContentBlock[],
  walked: WalkContext,
  config: DocxProfileConfig,
  onChapterRendered: (chapterName: string | null) => Promise<void>,
  documentName: string = 'Untitled',
  authorName: string | null = null,
): Promise<Buffer> {
  void walked  // currently use blocks directly; walked metadata helpful for V1.x polish

  const pageConfig = resolvePageConfig(config)
  const fontConfig = resolveFontConfig(config)
  const lineSpacing = resolveLineSpacing(config)
  const sceneSeparator = config.scene_separator ?? '* * *'
  const firstLineIndent = config.first_line_indent_inches ?? 0.5

  const docxParagraphs: Paragraph[] = []

  if (config.include_front_matter) {
    // Title page — document name (centred, bold, large) + optional author.
    // Earlier V1 versions hardcoded the literal string "Title Page";
    // fixed 2026-05-17 during pre-Phase-8 test pass.
    docxParagraphs.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 4000, after: 400 },
      children: [
        new TextRun({ text: documentName, font: fontConfig.family, size: 48, bold: true }),
      ],
    }))
    if (authorName) {
      docxParagraphs.push(new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 600, after: 200 },
        children: [
          new TextRun({ text: authorName, font: fontConfig.family, size: 28 }),
        ],
      }))
    }
    docxParagraphs.push(new Paragraph({ children: [new PageBreak()] }))
  }

  let currentChapterIdx = 0
  let currentChapterName: string | null = null
  let pendingChapterCallback = false

  for (const block of blocks) {
    switch (block.type) {
      case 'heading': {
        if (pendingChapterCallback) {
          await onChapterRendered(currentChapterName)
          pendingChapterCallback = false
        }
        currentChapterIdx += 1
        currentChapterName = block.text ?? null

        if (config.page_break_per_chapter !== false && currentChapterIdx > 1) {
          docxParagraphs.push(new Paragraph({ children: [new PageBreak()] }))
        }

        docxParagraphs.push(new Paragraph({
          heading: HeadingLevel.HEADING_1,
          alignment: AlignmentType.CENTER,
          spacing: { before: 800, after: 400 },
          children: [
            new TextRun({
              text: block.text ?? '',
              font: fontConfig.family,
              size: 32,
              bold: true,
            }),
          ],
        }))
        pendingChapterCallback = true
        break
      }
      case 'page_break':
        docxParagraphs.push(new Paragraph({ children: [new PageBreak()] }))
        break
      case 'scene_separator':
        docxParagraphs.push(new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 240, after: 240 },
          children: [
            new TextRun({ text: sceneSeparator, font: fontConfig.family, size: fontConfig.size }),
          ],
        }))
        break
      case 'paragraph':
        docxParagraphs.push(new Paragraph({
          alignment: AlignmentType.JUSTIFIED,
          spacing: {
            line: lineSpacing,
            after: (config.paragraph_spacing_pt ?? 0) * 20,
          },
          indent: { firstLine: firstLineIndent * TWIP_PER_INCH },
          children: [
            new TextRun({
              text: block.text ?? '',
              font: fontConfig.family,
              size: fontConfig.size,
              italics: block.formatting?.italic,
              bold: block.formatting?.bold,
            }),
          ],
        }))
        break
      case 'front_matter':
        docxParagraphs.push(new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [
            new TextRun({ text: block.text ?? '', font: fontConfig.family, size: fontConfig.size }),
          ],
        }))
        break
      case 'toc_placeholder':
        break
    }
  }

  if (pendingChapterCallback) {
    await onChapterRendered(currentChapterName)
  }

  const headerChildren = config.page_numbers !== false
    ? {
        default: new Header({
          children: [
            new Paragraph({
              alignment: AlignmentType.RIGHT,
              children: [
                new TextRun({
                  text: config.blind_mode ? '' : 'Author / Title / ',
                  font: fontConfig.family,
                  size: 20,
                }),
                new TextRun({
                  children: [PageNumber.CURRENT],
                  font: fontConfig.family,
                  size: 20,
                }),
              ],
            }),
          ],
        }),
      }
    : undefined

  const doc = new Document({
    creator: 'Stelavox',
    title: 'Manuscript',
    description: 'Exported from Stelavox',
    styles: {
      default: {
        document: {
          run: { font: fontConfig.family, size: fontConfig.size },
        },
      },
    },
    sections: [{
      properties: {
        page: {
          size: {
            width: pageConfig.width,
            height: pageConfig.height,
            orientation: PageOrientation.PORTRAIT,
          },
          margin: pageConfig.margins,
          pageNumbers: { start: 1, formatType: NumberFormat.DECIMAL },
        },
      },
      ...(headerChildren ? { headers: headerChildren } : {}),
      children: docxParagraphs,
    }],
  })

  const buffer = await Packer.toBuffer(doc)
  return Buffer.from(buffer)
}
