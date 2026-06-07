/**
 * POST /api/cron/purge-expired-exports — Vercel-Cron-driven retention
 * for the `exports` Storage bucket and the export_jobs table.
 *
 * Replaces the M-162 pg_cron `export_purge_expired` job (unscheduled in
 * M-211). pg_cron could only delete rows; the corresponding Storage
 * files were left orphaned. This route handles both — row and file
 * cleanup in one pass.
 *
 * Three passes per run:
 *
 *   1. Completed exports past signed_url_expires_at — delete file from
 *      Storage, then delete row. The signed_url_ttl is the contract;
 *      after expiry the file is unreachable and the row is bookkeeping
 *      noise.
 *
 *   2. Failed / cancelled exports older than
 *      export.failed_retention_hours (default 24h) — delete file (if
 *      any was uploaded before the failure) then delete row.
 *
 *   3. Orphan sweep — list bucket files older than 1h with no matching
 *      export_jobs.storage_path. Belt-and-braces against the
 *      uploaded-but-row-not-yet-persisted race window, plus one-time
 *      cleanup of files left behind by the pre-M-211 pg_cron purge.
 *      1h grace prevents racing in-flight uploads on a busy day.
 *
 * Order within each pass: file delete first, row delete second. If the
 * file delete fails (network blip, transient Storage error) we keep
 * the row so the next run retries. If the row delete fails after a
 * successful file delete, the orphan sweep on the NEXT run picks up
 * nothing (the file is gone) and the next pass-1 retries the row
 * delete cleanly. The system tolerates partial failures by
 * construction.
 *
 * Auth: Authorization: Bearer <CRON_SECRET>. Same scheme as the other
 * Vercel-Cron routes (period-rollover, poll-batches, run-probes).
 *
 * Scheduled: daily 03:30 UTC via vercel.json.
 */

import 'server-only'

import { NextResponse, type NextRequest } from 'next/server'

import { createServiceRoleClient } from '@/lib/supabase/service'
import { getConfigInt } from '@/lib/config/platform-config'

const BUCKET = 'exports'
const ORPHAN_GRACE_MS = 60 * 60 * 1000 // 1h — don't race in-flight uploads

interface PurgeResult {
  pass1_completed_expired:  { rows: number; files: number; errors: string[] }
  pass2_failed_cancelled:   { rows: number; files: number; errors: string[] }
  pass3_orphan_sweep:       { files: number; scanned: number; errors: string[] }
}

export async function POST(req: NextRequest): Promise<Response> {
  const authHeader = req.headers.get('authorization')
  const expected = process.env.CRON_SECRET
  if (!expected) {
    return NextResponse.json(
      { error: 'cron_secret_not_configured' },
      { status: 500 },
    )
  }
  if (authHeader !== `Bearer ${expected}`) {
    return NextResponse.json({ error: 'unauthorised' }, { status: 401 })
  }

  const supabase = createServiceRoleClient()
  const result: PurgeResult = {
    pass1_completed_expired: { rows: 0, files: 0, errors: [] },
    pass2_failed_cancelled:  { rows: 0, files: 0, errors: [] },
    pass3_orphan_sweep:      { files: 0, scanned: 0, errors: [] },
  }

  // ─── Pass 1: completed exports past signed_url_expires_at ─────────────
  {
    const { data: rows, error } = await supabase
      .from('export_jobs')
      .select('id, storage_path')
      .eq('status', 'completed')
      .lt('signed_url_expires_at', new Date().toISOString())
      .not('signed_url_expires_at', 'is', null)
      .limit(1000)

    if (error) {
      result.pass1_completed_expired.errors.push(`select_failed: ${error.message}`)
    } else if (rows) {
      for (const row of rows) {
        if (row.storage_path) {
          const fileOk = await deleteFileSafe(supabase, row.storage_path, result.pass1_completed_expired.errors)
          if (!fileOk) continue // keep the row, retry next run
          result.pass1_completed_expired.files++
        }
        const { error: delErr } = await supabase
          .from('export_jobs').delete().eq('id', row.id)
        if (delErr) {
          result.pass1_completed_expired.errors.push(`row_delete_failed_${row.id}: ${delErr.message}`)
          continue
        }
        result.pass1_completed_expired.rows++
      }
    }
  }

  // ─── Pass 2: failed/cancelled rows older than retention window ────────
  {
    const failedRetentionHours = await safeGetConfigInt('export.failed_retention_hours', 24)
    const cutoff = new Date(Date.now() - failedRetentionHours * 60 * 60 * 1000).toISOString()

    const { data: rows, error } = await supabase
      .from('export_jobs')
      .select('id, storage_path')
      .in('status', ['failed', 'cancelled'])
      .lt('created_at', cutoff)
      .limit(1000)

    if (error) {
      result.pass2_failed_cancelled.errors.push(`select_failed: ${error.message}`)
    } else if (rows) {
      for (const row of rows) {
        if (row.storage_path) {
          const fileOk = await deleteFileSafe(supabase, row.storage_path, result.pass2_failed_cancelled.errors)
          if (!fileOk) continue
          result.pass2_failed_cancelled.files++
        }
        const { error: delErr } = await supabase
          .from('export_jobs').delete().eq('id', row.id)
        if (delErr) {
          result.pass2_failed_cancelled.errors.push(`row_delete_failed_${row.id}: ${delErr.message}`)
          continue
        }
        result.pass2_failed_cancelled.rows++
      }
    }
  }

  // ─── Pass 3: orphan sweep ─────────────────────────────────────────────
  // Build the set of currently-referenced storage_paths, then walk the
  // bucket (org-folders → files within) and delete any file older than
  // ORPHAN_GRACE_MS that isn't in the set.
  {
    const { data: pathRows, error: pathErr } = await supabase
      .from('export_jobs')
      .select('storage_path')
      .not('storage_path', 'is', null)
    if (pathErr) {
      result.pass3_orphan_sweep.errors.push(`select_paths_failed: ${pathErr.message}`)
    } else {
      const referenced = new Set<string>(
        (pathRows ?? []).map((r) => r.storage_path as string).filter(Boolean),
      )
      const cutoffMs = Date.now() - ORPHAN_GRACE_MS

      // Storage path shape is `{org_id}/{job_id}.{ext}`. List the root
      // (returns org-id folders), then list inside each. List API caps
      // at 1000 entries per call; that's fine at V1 scale and we cap
      // total work per pass to avoid burning the Vercel function budget.
      const { data: rootEntries, error: rootListErr } =
        await supabase.storage.from(BUCKET).list('', { limit: 1000 })
      if (rootListErr) {
        result.pass3_orphan_sweep.errors.push(`list_root_failed: ${rootListErr.message}`)
      } else if (rootEntries) {
        for (const orgEntry of rootEntries) {
          // The bucket root contains folders named by org-id. Anything
          // with a metadata.size (i.e. a file) at the root level is
          // unexpected; skip it without crashing.
          if (!orgEntry.id && orgEntry.name) {
            // Folder. List its files.
            const { data: files, error: listErr } =
              await supabase.storage.from(BUCKET).list(orgEntry.name, { limit: 1000 })
            if (listErr) {
              result.pass3_orphan_sweep.errors.push(`list_${orgEntry.name}_failed: ${listErr.message}`)
              continue
            }
            if (!files) continue
            for (const file of files) {
              result.pass3_orphan_sweep.scanned++
              const fullPath = `${orgEntry.name}/${file.name}`
              const createdAt = file.created_at ? new Date(file.created_at).getTime() : 0
              if (createdAt > cutoffMs) continue // too fresh — could be racing an upload
              if (referenced.has(fullPath)) continue // legitimate
              const ok = await deleteFileSafe(supabase, fullPath, result.pass3_orphan_sweep.errors)
              if (ok) result.pass3_orphan_sweep.files++
            }
          }
        }
      }
    }
  }

  return NextResponse.json(result)
}

/** Delete one file from Storage; treat 404 (already gone) as success.
 *  Returns true on success (or pre-deleted), false on real failure. */
async function deleteFileSafe(
  supabase: ReturnType<typeof createServiceRoleClient>,
  path: string,
  errors: string[],
): Promise<boolean> {
  const { error } = await supabase.storage.from(BUCKET).remove([path])
  if (error) {
    // Supabase Storage's `remove()` returns no error for already-gone
    // files (it's a soft success). If it does error, it's a real
    // problem — log it and bail so the row stays for retry.
    errors.push(`file_delete_failed_${path}: ${error.message}`)
    return false
  }
  return true
}

/** Read a platform_config int but fall back to a default rather than
 *  failing the whole cron run if the key happens to be missing. */
async function safeGetConfigInt(key: string, fallback: number): Promise<number> {
  try {
    return await getConfigInt(key)
  } catch {
    return fallback
  }
}
