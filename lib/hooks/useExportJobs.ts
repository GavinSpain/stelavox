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

import { useCallback, useEffect, useRef, useState } from 'react'
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

/**
 * Window CustomEvent name dispatched by ExportModal when a new export
 * has been accepted by the API (POST /api/exports returned 202). The
 * detail shape is { documentId: string }. ExportHistoryPanel listens
 * for matching document_id values and refetches — instant visibility
 * without depending on Realtime for the create case.
 */
export const EXPORT_STARTED_EVENT = 'stelavox:export-started'

/** Statuses that should keep the in-flight poller alive. */
const IN_FLIGHT_FOR_POLL = new Set<ExportJob['status']>([
  'queued', 'pending', 'planning', 'rendering', 'assembling',
  'uploading', 'cancellation_requested',
])

/** Poll cadence while any export is in-flight (ms). */
const POLL_INTERVAL_MS = 2000

export function useExportHistory(documentId: string | null): ExportJob[] {
  const [jobs, setJobs] = useState<ExportJob[]>([])

  // Refs let the polling effect and event listeners call the latest
  // fetcher without re-subscribing on every state change.
  const mountedRef = useRef(true)

  const fetchInitial = useCallback(async () => {
    if (!documentId) return
    const supabase = createClient()
    const { data } = await supabase
      .from('export_jobs')
      .select('*')
      .eq('document_id', documentId)
      .order('created_at', { ascending: false })
      .limit(50)
    if (mountedRef.current && data) setJobs(data as unknown as ExportJob[])
  }, [documentId])

  useEffect(() => {
    if (!documentId) return
    const supabase = createClient()
    mountedRef.current = true

    void fetchInitial()

    const channel = supabase.channel(`export_jobs:doc:${documentId}`).on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'export_jobs', filter: `document_id=eq.${documentId}` },
      (payload) => {
        if (!mountedRef.current) return
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
    ).subscribe((status) => {
      // 2026-06-07 — surface channel status so a silent Realtime failure
      // (CHANNEL_ERROR / TIMED_OUT / CLOSED) shows up in console. We log
      // SUBSCRIBED too so we can tell whether the subscription ever
      // succeeded on a given environment.
      // eslint-disable-next-line no-console
      console.debug(`[useExportHistory] channel ${documentId} status:`, status)
    })

    // 2026-06-07 — modal-dispatched event refresh. When ExportModal
    // POSTs /api/exports successfully, it dispatches a window event;
    // we refetch immediately so the new row shows up without waiting
    // for the Realtime INSERT broadcast.
    function onExportStarted(e: Event) {
      const detail = (e as CustomEvent<{ documentId?: string }>).detail
      if (detail?.documentId === documentId) void fetchInitial()
    }
    window.addEventListener(EXPORT_STARTED_EVENT, onExportStarted)

    // 2026-06-07 — tab-focus + visibility refetch. Covers the common
    // case of triggering an export, tabbing away, and coming back.
    function onFocus() { void fetchInitial() }
    function onVisibilityChange() {
      if (document.visibilityState === 'visible') void fetchInitial()
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      mountedRef.current = false
      void supabase.removeChannel(channel)
      window.removeEventListener(EXPORT_STARTED_EVENT, onExportStarted)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [documentId, fetchInitial])

  // 2026-06-07 — short-interval polling while any export is in-flight.
  // On environments where Realtime postgres_changes UPDATE events drop
  // silently (observed locally during V1 testing), this is the
  // mechanism that drives queued → planning → rendering → completed
  // transitions live in the panel. The interval stops the moment the
  // panel has no in-flight rows — so on an idle history view there is
  // zero background traffic.
  const hasInFlight = jobs.some(j => IN_FLIGHT_FOR_POLL.has(j.status))
  useEffect(() => {
    if (!hasInFlight || !documentId) return
    const id = setInterval(() => { void fetchInitial() }, POLL_INTERVAL_MS)
    return () => clearInterval(id)
  }, [hasInFlight, documentId, fetchInitial])

  return jobs
}
