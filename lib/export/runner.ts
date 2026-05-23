/**
 * Phase 7 — Export runner. The orchestrator that turns an
 * `export_jobs` row at status='queued' into a downloadable file.
 *
 * Pipeline (D2 — Option B resumable atomization):
 *   1. Plan — walk tree, count chapters/words, validate against limits
 *   2. Render-per-chapter — emit ContentBlock[] per chapter; update
 *      progress after each chapter
 *   3. Assemble — format-specific final document build
 *   4. Upload — push to Supabase Storage, generate signed URL
 *   5. Finalize — flip status to 'completed'
 *
 * Each stage updates export_jobs.progress + last_active_at via
 * progress.ts helpers. UI subscribes via Realtime.
 *
 * Cancellation: between stages and at chapter boundaries, runner
 * checks cancellation_requested_at and halts cleanly if set.
 *
 * Recovery: if Vercel kills the function mid-export, last_active_at
 * goes stale and recovery_sweep_exports (M-162) marks the row as
 * failed with error_message='runner_timeout'. The author retries.
 *
 * The actual format renderers (DOCX, EPUB, JSON, Outline) are
 * dynamically imported in step 3 to keep the runner module lean.
 */

import { createServiceRoleClient } from '@/lib/supabase/service'
import { getConfigInt } from '@/lib/config/platform-config'

/** Defensive wrapper — falls back to default if the key is missing or wrong type. */
async function safeConfigInt(key: string, fallback: number): Promise<number> {
  try { return await getConfigInt(key) } catch { return fallback }
}
import { walkDocument } from './tree-walker'
import { validateForExport } from './validate'
import {
  setProgressPlanning, setProgressRendering, setProgressAssembling,
  setProgressUploading, setProgressCompleted, setProgressFailed,
  setProgressCancelled, isCancellationRequested,
} from './progress'
import { uploadExportFile, generateSignedUrl, ensureExportBucket } from './storage'
import { getProfileById } from './profiles'
import type {
  ExportFormat, ContentBlock,
  DocxProfileConfig, EpubProfileConfig, OutlineProfileConfig,
} from './types'

/**
 * Main entry. Called from POST /api/exports (via waitUntil) and from
 * POST /api/exports/[id]/retry. Idempotent at the row level — if the
 * runner is invoked twice on the same row, the second invocation sees
 * the first's state updates and exits cleanly.
 *
 * Errors are caught and logged via setProgressFailed; the runner
 * never throws to its caller. The caller is fire-and-forget.
 */
export async function runExportJob(exportJobId: string): Promise<void> {
  const supabase = createServiceRoleClient()
  await ensureExportBucket(supabase)

  // Load the job row.
  const { data: job, error: loadErr } = await supabase
    .from('export_jobs')
    .select('id, organisation_id, document_id, format, profile_id, status')
    .eq('id', exportJobId)
    .maybeSingle()

  if (loadErr || !job) {
    return  // nothing to do; row vanished
  }

  // Load the document name + authors for the title page.
  // Fetched alongside the job so the renderers don't need their own query.
  const { data: docRow } = await supabase
    .from('documents')
    .select('name, authors')
    .eq('id', job.document_id as string)
    .maybeSingle()
  const documentName: string = (docRow?.name as string | null) ?? 'Untitled'
  const authorName: string | null = (() => {
    const authors = (docRow?.authors as unknown) as string[] | null
    if (!Array.isArray(authors) || authors.length === 0) return null
    return authors.join(', ')
  })()

  // Idempotency guard: if the row is already past 'queued', another
  // invocation is handling it (or completed). Exit silently.
  if (job.status !== 'queued') {
    return
  }

  try {
    // Load profile (optional — config may also be inlined in row's progress)
    let config: Record<string, unknown> = {}
    if (job.profile_id) {
      const profile = await getProfileById(supabase, job.profile_id as string)
      if (profile) config = profile.config as Record<string, unknown>
    }

    // Stage 1: Plan
    if (await isCancellationRequested(supabase, exportJobId)) {
      await setProgressCancelled(supabase, exportJobId)
      return
    }

    const sceneSeparator = (config as DocxProfileConfig | EpubProfileConfig).scene_separator ?? '* * *'
    const chapterHeadingStyle =
      (config as DocxProfileConfig).chapter_heading ?? 'centred_numbered'

    const walked = await walkDocument(supabase, job.document_id as string, {
      scene_separator: sceneSeparator,
      chapter_heading_style: chapterHeadingStyle,
    })

    // Validate against limits. Helper handles missing keys defensively
    // (seeded at M-161; if anything goes wrong, fall back to safe value).
    const limits = {
      soft_warning_words: await safeConfigInt('export.soft_warning_words', 900000),
      max_words_per_document: await safeConfigInt('export.max_words_per_document', 1500000),
      max_chapters_per_document: await safeConfigInt('export.max_chapters_per_document', 500),
      max_render_minutes: await safeConfigInt('export.max_render_minutes', 4),
      max_file_size_mb: await safeConfigInt('export.max_file_size_mb', 50),
    }

    const validation = validateForExport({
      total_words: walked.total_word_count,
      total_chapters: walked.total_chapters,
      format: job.format as ExportFormat,
    }, limits)

    if (!validation.ok) {
      await setProgressFailed(supabase, exportJobId, validation.errors.join('\n'))
      return
    }

    await setProgressPlanning(supabase, exportJobId, walked.total_chapters)

    // Stage 2: Render-per-chapter
    if (await isCancellationRequested(supabase, exportJobId)) {
      await setProgressCancelled(supabase, exportJobId)
      return
    }

    const renderStartedAt = Date.now()
    const totalChapters = walked.total_chapters
    let currentChapter = 0

    // Build a per-chapter callback that updates progress. Renderers
    // call this when they cross a chapter boundary.
    const onChapterRendered = async (chapterName: string | null) => {
      currentChapter += 1
      const elapsed = Date.now() - renderStartedAt
      // Rough estimate: linearly extrapolate remaining time from elapsed
      const fractionDone = currentChapter / Math.max(totalChapters, 1)
      const totalEstimateMs = elapsed / Math.max(fractionDone, 0.01)
      const remainingMs = totalEstimateMs * (1 - fractionDone)
      const estimated_seconds_remaining = Math.ceil(remainingMs / 1000)
      await setProgressRendering(
        supabase, exportJobId, currentChapter, totalChapters, chapterName,
        estimated_seconds_remaining,
      )
      // Re-check cancellation between chapters (cheap; one row read)
      if (await isCancellationRequested(supabase, exportJobId)) {
        throw new ExportCancelledError(currentChapter)
      }
    }

    // Dynamic-import the format renderer. Each renderer takes the
    // walked ContentBlock[] + config + onChapterRendered callback and
    // returns a Buffer | Uint8Array | string.
    const blocks: ContentBlock[] = walked.blocks
    let outputBody: Buffer | Uint8Array | string

    try {
      switch (job.format as ExportFormat) {
        case 'json': {
          const { renderJson } = await import('./json')
          outputBody = await renderJson(supabase, job.document_id as string, onChapterRendered)
          break
        }
        case 'outline': {
          const { renderOutline } = await import('./outline')
          outputBody = await renderOutline(
            blocks, walked, config as OutlineProfileConfig, onChapterRendered,
          )
          break
        }
        case 'docx': {
          const { renderDocx } = await import('./docx')
          outputBody = await renderDocx(
            blocks, walked, config as DocxProfileConfig, onChapterRendered,
            documentName, authorName,
          )
          break
        }
        case 'epub': {
          const { renderEpub } = await import('./epub')
          outputBody = await renderEpub(
            blocks, walked, config as EpubProfileConfig, onChapterRendered,
            documentName, authorName,
          )
          break
        }
        default:
          await setProgressFailed(supabase, exportJobId, `unsupported_format: ${job.format}`)
          return
      }
    } catch (err) {
      if (err instanceof ExportCancelledError) {
        await setProgressCancelled(supabase, exportJobId, err.chapter)
        return
      }
      throw err
    }

    // Stage 3: Assembling (renderer's final build happens above; this
    // stage is a status-only marker for the UI)
    await setProgressAssembling(supabase, exportJobId, totalChapters)

    if (await isCancellationRequested(supabase, exportJobId)) {
      await setProgressCancelled(supabase, exportJobId, currentChapter)
      return
    }

    // Stage 4: Upload
    await setProgressUploading(supabase, exportJobId, totalChapters)

    const uploaded = await uploadExportFile(supabase, {
      organisationId: job.organisation_id as string,
      exportJobId,
      format: job.format as ExportFormat,
      body: outputBody,
    })

    const ttlHours = await safeConfigInt('export.signed_url_ttl_hours', 168)
    const signed = await generateSignedUrl(supabase, uploaded.path, ttlHours * 3600)

    // Stage 5: Finalize
    await setProgressCompleted(
      supabase, exportJobId, uploaded.size,
      uploaded.path, signed.signedUrl, signed.expiresAt,
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await setProgressFailed(supabase, exportJobId, msg)
  }
}

class ExportCancelledError extends Error {
  constructor(public chapter: number) {
    super(`Export cancelled at chapter ${chapter}`)
    this.name = 'ExportCancelledError'
  }
}
