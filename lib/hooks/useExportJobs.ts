'use client'

/**
 * Phase 7 — Realtime export_jobs subscription hooks.
 *
 * Three hooks for different UI surfaces:
 *   - useActiveExports(): subscribes to all in-flight exports for the
 *     current user; powers ExportProgressStack at bottom-right
 *   - useExportProgress(exportJobId): subscribes to a single export;
 *     powers ExportProgressChip detail
 *   - useExportHistory(documentId): subscribes to all exports for a
 *     document; powers ExportHistoryPanel
 *
 * Subscription is mounted at the appropriate component level; cleanup
 * on unmount per H-05.
 */

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export interface ExportJob {
  id: string
  organisation_id: string
  document_id: string
  format: 'docx' | 'epub' | 'json' | 'outline'
  profile_id: string | null
  status:
    | 'queued' | 'pending' | 'planning' | 'rendering' | 'assembling'
    | 'uploading' | 'completed' | 'failed' | 'cancellation_requested' | 'cancelled'
  progress: {
    phase?: string
    current_chapter?: number
    total_chapters?: number
    chapter_name?: string | null
    estimated_seconds_remaining?: number
    error?: string
    cancelled_at_chapter?: number
    output_size_bytes?: number
  }
  signed_url: string | null
  signed_url_expires_at: string | null
  error_message: string | null
  attempt_count: number
  total_chapters: number | null
  storage_path: string | null
  created_at: string
  completed_at: string | null
  last_active_at: string | null
  cancellation_requested_at: string | null
}

const ACTIVE_STATUSES = new Set([
  'queued', 'pending', 'planning', 'rendering', 'assembling', 'uploading',
  'cancellation_requested',
])

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled'])

export function useActiveExports(): ExportJob[] {
  const [jobs, setJobs] = useState<ExportJob[]>([])

  useEffect(() => {
    const supabase = createClient()
    let mounted = true

    async function fetchInitial() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user || !mounted) return
      // 2026-06-07 fix — also load terminal exports from the last 6
      // hours so a page reload doesn't lose the Download button for an
      // export that just completed. The chip persists with its
      // completed/failed state; the user can still Dismiss it once
      // they've downloaded. Without this, the initial fetch only saw
      // in-flight exports and finished jobs vanished on reload.
      const cutoff = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString()
      const { data } = await supabase
        .from('export_jobs')
        .select('*')
        .or(`status.in.(${Array.from(ACTIVE_STATUSES).join(',')}),created_at.gte.${cutoff}`)
        .order('created_at', { ascending: false })
        .limit(20)
      if (mounted && data) setJobs(data as unknown as ExportJob[])
    }

    void fetchInitial()

    const channel = supabase.channel('export_jobs:active').on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'export_jobs' },
      (payload) => {
        if (!mounted) return
        const newRow = payload.new as ExportJob | undefined
        const oldRow = payload.old as ExportJob | undefined
        const id = newRow?.id ?? oldRow?.id
        if (!id) return

        setJobs(prev => {
          // Remove the row from prev
          const filtered = prev.filter(j => j.id !== id)
          // Re-insert if active
          if (newRow && ACTIVE_STATUSES.has(newRow.status)) {
            return [newRow, ...filtered]
          }
          // Keep terminal exports for 10s so the UI can render the
          // success/failure state before they disappear — we leverage
          // a small grace by NOT removing immediately. Instead, set a
          // timer in the component (ExportProgressStack) to dismiss
          // after the user acts or after a TTL.
          if (newRow && TERMINAL_STATUSES.has(newRow.status)) {
            return [newRow, ...filtered]
          }
          return filtered
        })
      },
    ).subscribe()

    return () => {
      mounted = false
      void supabase.removeChannel(channel)
    }
  }, [])

  return jobs
}

export function useExportProgress(exportJobId: string | null): ExportJob | null {
  const [job, setJob] = useState<ExportJob | null>(null)

  useEffect(() => {
    if (!exportJobId) return
    const supabase = createClient()
    let mounted = true

    async function fetchInitial() {
      if (!exportJobId) return
      const { data } = await supabase
        .from('export_jobs')
        .select('*')
        .eq('id', exportJobId)
        .maybeSingle()
      if (mounted && data) setJob(data as unknown as ExportJob)
    }

    void fetchInitial()

    const channel = supabase.channel(`export_jobs:${exportJobId}`).on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'export_jobs', filter: `id=eq.${exportJobId}` },
      (payload) => {
        if (!mounted) return
        const newRow = payload.new as ExportJob | undefined
        if (newRow) setJob(newRow)
      },
    ).subscribe()

    return () => {
      mounted = false
      void supabase.removeChannel(channel)
    }
  }, [exportJobId])

  return job
}

export function useExportHistory(documentId: string | null): ExportJob[] {
  const [jobs, setJobs] = useState<ExportJob[]>([])

  useEffect(() => {
    if (!documentId) return
    const supabase = createClient()
    let mounted = true

    async function fetchInitial() {
      if (!documentId) return
      const { data } = await supabase
        .from('export_jobs')
        .select('*')
        .eq('document_id', documentId)
        .order('created_at', { ascending: false })
        .limit(50)
      if (mounted && data) setJobs(data as unknown as ExportJob[])
    }

    void fetchInitial()

    const channel = supabase.channel(`export_jobs:doc:${documentId}`).on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'export_jobs', filter: `document_id=eq.${documentId}` },
      (payload) => {
        if (!mounted) return
        const newRow = payload.new as ExportJob | undefined
        const oldRow = payload.old as ExportJob | undefined
        const id = newRow?.id ?? oldRow?.id
        if (!id) return

        setJobs(prev => {
          if (payload.eventType === 'DELETE') return prev.filter(j => j.id !== id)
          const filtered = prev.filter(j => j.id !== id)
          if (newRow) return [newRow, ...filtered].slice(0, 50)
          return filtered
        })
      },
    ).subscribe()

    return () => {
      mounted = false
      void supabase.removeChannel(channel)
    }
  }, [documentId])

  return jobs
}
