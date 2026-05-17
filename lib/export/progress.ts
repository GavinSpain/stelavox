/**
 * Phase 7 — Progress update helpers.
 *
 * Single-write-point for runner.ts to update export_jobs.progress
 * JSONB and the row's last_active_at heartbeat. UI subscribes via
 * Realtime; UPDATE fires the event.
 *
 * Each helper also stamps last_active_at = NOW() so the recovery
 * sweep (M-162) knows the runner is alive.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ProgressShape } from './types'

export async function setProgressPlanning(
  supabase: SupabaseClient,
  exportJobId: string,
  total_chapters: number,
): Promise<void> {
  await supabase.from('export_jobs').update({
    status: 'planning',
    progress: { phase: 'planning', total_chapters } satisfies ProgressShape,
    total_chapters,
    last_active_at: new Date().toISOString(),
  }).eq('id', exportJobId)
}

export async function setProgressRendering(
  supabase: SupabaseClient,
  exportJobId: string,
  current_chapter: number,
  total_chapters: number,
  chapter_name: string | null,
  estimated_seconds_remaining?: number,
): Promise<void> {
  await supabase.from('export_jobs').update({
    status: 'rendering',
    progress: {
      phase: 'rendering',
      current_chapter,
      total_chapters,
      chapter_name,
      ...(estimated_seconds_remaining !== undefined ? { estimated_seconds_remaining } : {}),
    } satisfies ProgressShape,
    last_active_at: new Date().toISOString(),
  }).eq('id', exportJobId)
}

export async function setProgressAssembling(
  supabase: SupabaseClient,
  exportJobId: string,
  total_chapters: number,
): Promise<void> {
  await supabase.from('export_jobs').update({
    status: 'assembling',
    progress: { phase: 'assembling', total_chapters } satisfies ProgressShape,
    last_active_at: new Date().toISOString(),
  }).eq('id', exportJobId)
}

export async function setProgressUploading(
  supabase: SupabaseClient,
  exportJobId: string,
  total_chapters: number,
): Promise<void> {
  await supabase.from('export_jobs').update({
    status: 'uploading',
    progress: { phase: 'uploading', total_chapters } satisfies ProgressShape,
    last_active_at: new Date().toISOString(),
  }).eq('id', exportJobId)
}

export async function setProgressCompleted(
  supabase: SupabaseClient,
  exportJobId: string,
  output_size_bytes: number,
  storage_path: string,
  signed_url: string,
  signed_url_expires_at: string,
): Promise<void> {
  await supabase.from('export_jobs').update({
    status: 'completed',
    progress: { phase: 'completed', output_size_bytes } satisfies ProgressShape,
    storage_path,
    signed_url,
    signed_url_expires_at,
    completed_at: new Date().toISOString(),
    last_active_at: new Date().toISOString(),
  }).eq('id', exportJobId)
}

export async function setProgressFailed(
  supabase: SupabaseClient,
  exportJobId: string,
  error: string,
): Promise<void> {
  await supabase.from('export_jobs').update({
    status: 'failed',
    progress: { phase: 'failed', error } satisfies ProgressShape,
    error_message: error,
    completed_at: new Date().toISOString(),
    last_active_at: new Date().toISOString(),
  }).eq('id', exportJobId)
}

export async function setProgressCancelled(
  supabase: SupabaseClient,
  exportJobId: string,
  cancelled_at_chapter?: number,
): Promise<void> {
  await supabase.from('export_jobs').update({
    status: 'cancelled',
    progress: {
      phase: 'cancelled',
      ...(cancelled_at_chapter !== undefined ? { cancelled_at_chapter } : {}),
    } satisfies ProgressShape,
    completed_at: new Date().toISOString(),
    last_active_at: new Date().toISOString(),
  }).eq('id', exportJobId)
}

/**
 * Read the current cancellation_requested_at flag. Runner checks
 * this between pipeline stages; if non-null, halts at next boundary.
 */
export async function isCancellationRequested(
  supabase: SupabaseClient,
  exportJobId: string,
): Promise<boolean> {
  const { data } = await supabase.from('export_jobs')
    .select('cancellation_requested_at')
    .eq('id', exportJobId)
    .maybeSingle()
  return (data as { cancellation_requested_at: string | null } | null)?.cancellation_requested_at != null
}
