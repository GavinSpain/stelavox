/**
 * Phase 7 — Pre-render validation.
 *
 * Runner Stage 1 calls validateForExport() with the walked document
 * and the target format. Returns a ValidationResult with warnings and
 * errors. Per D7/D8 wireframe §06:
 *   - Soft warning at export.soft_warning_words (default 900,000 ≈ 3,000 pages)
 *   - DOCX hard fail at export.max_words_per_document (default 1,500,000 ≈ 5,000 pages)
 *     with suggested_fallback='epub'
 *   - EPUB hard fail at 3x the DOCX limit (~15,000 pages)
 *   - JSON / Outline: effectively unbounded; only warn at exotic sizes
 */

import type { ExportFormat, ValidationResult } from './types'

interface ValidateInput {
  total_words: number
  total_chapters: number
  format: ExportFormat
}

interface ValidateLimits {
  soft_warning_words: number
  max_words_per_document: number
  max_chapters_per_document: number
  max_render_minutes: number
  max_file_size_mb: number
}

// EPUB ceiling = 3x DOCX ceiling per D8 (15,000 vs 5,000 pages).
const EPUB_LIMIT_MULTIPLIER = 3

// Heuristic: ~250 words per page (manuscript-format estimate).
const WORDS_PER_PAGE = 250

// Render-time estimate: ~3000 words/sec for DOCX, ~5000 words/sec for
// EPUB, ~50000 for JSON, ~30000 for Outline. Rough; tuned against
// observed render times during V1.x build. Used for the soft-warning
// time estimate only — not a hard gate.
function estimateRenderSeconds(words: number, format: ExportFormat): number {
  const wps =
    format === 'markdown' ? 50000 :
    format === 'outline' ? 30000 :
    format === 'epub' ? 5000 :
    3000  // docx
  return Math.ceil(words / wps)
}

function estimateOutputMb(words: number, format: ExportFormat): number {
  // Approximate output size:
  //   - Markdown: ~6 bytes per word (prose only, no history — the backstop)
  //   - DOCX: ~30 bytes per word (compressed zip is dense)
  //   - EPUB: ~35 bytes per word (per-chapter XHTML adds overhead)
  //   - Outline: ~10 bytes per word
  const bytesPerWord =
    format === 'markdown' ? 6 :
    format === 'outline' ? 10 :
    format === 'epub' ? 35 :
    30
  return Math.ceil((words * bytesPerWord) / (1024 * 1024))
}

export function validateForExport(
  input: ValidateInput,
  limits: ValidateLimits,
): ValidationResult {
  const { total_words, total_chapters, format } = input
  const warnings: string[] = []
  const errors: string[] = []
  let suggested_fallback: ExportFormat | undefined

  const estimated_pages = Math.ceil(total_words / WORDS_PER_PAGE)
  const estimated_seconds = estimateRenderSeconds(total_words, format)
  const estimated_size_mb = estimateOutputMb(total_words, format)

  // Format-specific hard fail + EPUB fallback suggestion. Check this
  // FIRST so the user sees the actionable page-ceiling message rather
  // than the abstract file-size cap.
  if (format === 'docx') {
    if (total_words > limits.max_words_per_document) {
      const epub_max = limits.max_words_per_document * EPUB_LIMIT_MULTIPLIER
      if (total_words <= epub_max) {
        suggested_fallback = 'epub'
        errors.push(
          `${estimated_pages.toLocaleString()} pages exceeds the DOCX export limit (~${Math.round(limits.max_words_per_document / WORDS_PER_PAGE).toLocaleString()} pages).\n\n` +
          `For Kindle / KDP submission: EPUB is recommended and handles your size. ` +
          `For editor handoff: split the document into multiple parts (e.g. one DOCX per Act).`,
        )
      } else {
        errors.push(
          `${estimated_pages.toLocaleString()} pages exceeds all export limits. ` +
          `Please split the document into multiple parts and export each separately.`,
        )
      }
    }
  } else if (format === 'epub') {
    const epub_max = limits.max_words_per_document * EPUB_LIMIT_MULTIPLIER
    if (total_words > epub_max) {
      errors.push(
        `${estimated_pages.toLocaleString()} pages exceeds the EPUB export limit (~${Math.round(epub_max / WORDS_PER_PAGE).toLocaleString()} pages). ` +
        `Please split the document into multiple parts.`,
      )
    }
  }
  // JSON + Outline: no hard limits (effectively unbounded)

  // Chapter cap (defensive — applies to all formats; checked after
  // format-specific limit so the format message gets priority)
  if (errors.length === 0 && total_chapters > limits.max_chapters_per_document) {
    errors.push(
      `This document has ${total_chapters} chapters, which exceeds the export limit of ${limits.max_chapters_per_document}. ` +
      `Consider splitting it into multiple documents.`,
    )
  }

  // File size cap (defensive — last-resort cap that would only fire
  // for exotic inputs that somehow slipped past the format cap)
  if (errors.length === 0 && estimated_size_mb > limits.max_file_size_mb) {
    errors.push(
      `The estimated output size (${estimated_size_mb} MB) exceeds the limit of ${limits.max_file_size_mb} MB. ` +
      `Try splitting the document or removing attachments.`,
    )
  }

  // Soft warning — applies to DOCX/EPUB only; JSON/Outline are too fast to warrant warning
  if (errors.length === 0 && (format === 'docx' || format === 'epub')) {
    if (total_words > limits.soft_warning_words) {
      const minutes = Math.ceil(estimated_seconds / 60)
      warnings.push(
        `"${total_chapters > 0 ? `${total_chapters} chapters` : 'This document'}" is large. ` +
        `The export will take ~${minutes} minute${minutes === 1 ? '' : 's'} ` +
        `and you'll see progress updates along the way. You can keep working while it runs.`,
      )
    }
  }

  return {
    ok: errors.length === 0,
    total_words,
    total_chapters,
    estimated_pages,
    estimated_seconds,
    estimated_size_mb,
    warnings,
    errors,
    suggested_fallback,
  }
}
