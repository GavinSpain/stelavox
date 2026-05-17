/**
 * Phase 7 — Export pipeline types.
 *
 * ContentBlock is the format-agnostic intermediate per TA §9.1. Tree
 * walker emits ContentBlock[]; per-format renderers consume it.
 *
 * ProgressShape is the wire shape for export_jobs.progress JSONB,
 * consumed by useExportProgress on the UI side.
 */

export type ExportFormat = 'docx' | 'epub' | 'json' | 'outline'

/**
 * Format-agnostic intermediate. One ContentBlock per emitted unit
 * (heading, paragraph, page-break marker, scene-separator marker,
 * front-matter section, TOC placeholder).
 *
 * Per Phase 7 D11 + tree-walker.ts, Acts/Books skip headings by
 * default (configurable via profile.config.layer_heading_map). Chapter
 * always emits a heading block. Scenes/Beats emit prose paragraphs +
 * scene_separator blocks between siblings.
 */
export interface ContentBlock {
  type:
    | 'heading'        // structural heading (Chapter, etc.)
    | 'paragraph'      // prose paragraph
    | 'page_break'     // hard page break (per-chapter if profile sets it)
    | 'scene_separator' // typical "* * *" or configurable marker
    | 'front_matter'   // title page / copyright / dedication content
    | 'toc_placeholder' // marker for ToC injection (renderer-specific)

  level?: number    // heading level (1 for Chapter, 2 for sub-headings, etc.)
  text?: string     // textual content for headings + paragraphs + front matter
  nodeId?: string   // source node id (for debugging / traceability)
  nodeType?: string // 'chapter', 'scene', 'beat', etc.

  // Formatting hints (optional; renderers respect what they can)
  formatting?: {
    bold?: boolean
    italic?: boolean
    indent?: boolean
  }
}

/**
 * Progress shape published to export_jobs.progress JSONB.
 *
 * Updated by runner.ts at each pipeline boundary. UI subscribes via
 * Realtime; useExportProgress hook returns this shape.
 *
 * Phase invariants:
 *   - phase=queued: no other fields set
 *   - phase=planning: total_chapters populated mid-stage
 *   - phase=rendering: current_chapter + chapter_name populated;
 *     updated per chapter completion
 *   - phase=assembling/uploading: chapter detail not relevant; just
 *     a status message
 *   - phase=completed: progress untouched; status flips on the row
 *   - phase=failed: error populated
 *   - phase=cancelled: chapters_completed preserved (audit)
 */
export interface ProgressShape {
  phase:
    | 'queued'
    | 'planning'
    | 'rendering'
    | 'assembling'
    | 'uploading'
    | 'completed'
    | 'failed'
    | 'cancelled'

  // Populated from planning stage onward
  total_chapters?: number

  // Populated during rendering stage
  current_chapter?: number      // 1-indexed
  chapter_name?: string | null
  estimated_seconds_remaining?: number

  // Populated on terminal failure / cancellation
  error?: string
  cancelled_at_chapter?: number

  // Populated on completed
  output_size_bytes?: number
}

/**
 * Per-format profile config. Stored in export_profiles.config JSONB.
 * The renderer for each format pulls its own keys; other keys are
 * silently ignored.
 */
export interface DocxProfileConfig {
  page_size?: 'letter' | 'a4' | '6x9' | 'mass_market'
  margins?: 'manuscript' | 'kdp_paperback' | 'custom'
  custom_margins?: { top: number; bottom: number; left: number; right: number; gutter?: number }
  font?: 'cambria_12' | 'times_12' | 'garamond_12' | 'courier_12'
  line_spacing?: 'single' | '1.5' | 'double'
  scene_separator?: string                     // "* * *", "#", "", or custom
  chapter_heading?:
    | 'centred_numbered'      // "Chapter N: Name"
    | 'centred_split'         // "Chapter N" + name on next line
    | 'centred_name_only'     // name only
    | 'left_numbered'         // left-aligned "Chapter N: Name"
  page_break_per_chapter?: boolean
  include_front_matter?: boolean
  page_numbers?: boolean
  blind_mode?: boolean
  include_toc?: boolean
  first_line_indent_inches?: number
  paragraph_spacing_pt?: number
}

export interface EpubProfileConfig {
  body_font?: 'reader_default' | 'serif' | 'sans_serif'
  paragraph_indent?: 'first_line' | 'blank_line'
  scene_separator?: string
  chapter_heading?: 'centred_numbered' | 'drop_cap' | 'plain'
  include_cover?: boolean    // V2 placeholder for V1
  book_title?: string
  book_author?: string
  book_isbn?: string
  book_description?: string
}

export interface OutlineProfileConfig {
  max_depth?: number | null               // null = unlimited
  include_word_count_target?: boolean
  include_status?: boolean
}

export type JsonProfileConfig = Record<string, never>   // no config; JSON is fixed-shape per D9

export type ProfileConfig =
  | DocxProfileConfig
  | EpubProfileConfig
  | OutlineProfileConfig
  | JsonProfileConfig

/**
 * Validation result from validate.ts. Plan stage returns this; runner
 * decides whether to proceed, warn, or fail.
 */
export interface ValidationResult {
  ok: boolean
  total_words: number
  total_chapters: number
  estimated_pages: number
  estimated_seconds: number
  estimated_size_mb: number
  warnings: string[]   // soft warnings — non-blocking
  errors: string[]     // hard fails — blocking; error contains user-facing copy
  suggested_fallback?: ExportFormat   // e.g. 'epub' when DOCX over-limit
}
