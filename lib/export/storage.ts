/**
 * Phase 7 — Supabase Storage integration for exports.
 *
 * Uploads rendered output files to the `exports` bucket; generates
 * signed URLs bounded by export.signed_url_ttl_hours platform_config
 * (default 168h = 7 days). Storage path shape:
 *
 *   exports/{organisation_id}/{export_job_id}.{ext}
 *
 * The bucket is private; access is gated by signed URLs only. RLS
 * policies on the underlying storage.objects table aren't strictly
 * necessary since we never expose the path directly; the signed URL
 * is the only public surface.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ExportFormat } from './types'

const BUCKET = 'exports'

function extensionFor(format: ExportFormat): string {
  switch (format) {
    case 'docx': return 'docx'
    case 'epub': return 'epub'
    case 'json': return 'json'
    case 'outline': return 'md'
  }
}

function contentTypeFor(format: ExportFormat): string {
  switch (format) {
    case 'docx': return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    case 'epub': return 'application/epub+zip'
    case 'json': return 'application/json'
    case 'outline': return 'text/markdown'
  }
}

export function storagePathFor(
  organisationId: string,
  exportJobId: string,
  format: ExportFormat,
): string {
  return `${organisationId}/${exportJobId}.${extensionFor(format)}`
}

export async function uploadExportFile(
  supabase: SupabaseClient,
  args: {
    organisationId: string
    exportJobId: string
    format: ExportFormat
    body: Buffer | Uint8Array | string
  },
): Promise<{ path: string; size: number }> {
  const path = storagePathFor(args.organisationId, args.exportJobId, args.format)
  const buf =
    typeof args.body === 'string' ? Buffer.from(args.body, 'utf-8') :
    args.body instanceof Buffer ? args.body :
    Buffer.from(args.body)

  const { error } = await supabase.storage.from(BUCKET).upload(path, buf, {
    contentType: contentTypeFor(args.format),
    upsert: true,
  })
  if (error) throw new Error(`uploadExportFile: ${error.message}`)
  return { path, size: buf.byteLength }
}

export async function generateSignedUrl(
  supabase: SupabaseClient,
  path: string,
  ttlSeconds: number,
): Promise<{ signedUrl: string; expiresAt: string }> {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, ttlSeconds)
  if (error || !data) throw new Error(`generateSignedUrl: ${error?.message ?? 'no data'}`)
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString()
  return { signedUrl: data.signedUrl, expiresAt }
}

export async function deleteExportFile(
  supabase: SupabaseClient,
  path: string,
): Promise<void> {
  const { error } = await supabase.storage.from(BUCKET).remove([path])
  if (error) throw new Error(`deleteExportFile: ${error.message}`)
}

/**
 * Idempotent bucket creation. Called once at runner startup; the
 * Supabase Storage API treats CREATE-on-existing as a no-op error
 * which we swallow.
 */
export async function ensureExportBucket(supabase: SupabaseClient): Promise<void> {
  try {
    await supabase.storage.createBucket(BUCKET, { public: false })
  } catch {
    // Already exists; nothing to do.
  }
}
