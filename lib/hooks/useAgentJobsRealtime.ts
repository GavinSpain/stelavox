'use client'

/**
 * Real-time subscription to agent_jobs.
 *
 * Source: stelavox_phase5_api_contract_v1_0.md v1.2 §2.15
 *         stelavox_component_specification_v2_6.md §4.4 (AgentActivityIndicator)
 * Build Checklist T-12.1.
 *
 * Subscribes to the org's agent_jobs channel via Supabase real-time.
 * Maintains a Zustand-backed map of active jobs keyed by node_id.
 * Components read via selectors:
 *   - useAgentJobsForNode(nodeId)     — all jobs targeting this node
 *   - useActiveJobForNode(nodeId)     — pending|running|completed job (single)
 *   - useAgentJobsForDocument(docId)  — all jobs for any node in this document
 *
 * Cleanup on unmount per H-05.
 *
 * The subscription is mounted once at the AppShell level and the data
 * is shared across all consumers — no duplicate channels per component.
 */

import { create } from 'zustand'
import { useEffect, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'

export interface AgentJob {
  id: string
  organisation_id: string
  node_id: string | null
  document_id: string | null
  profile_id: string | null
  operation_type: string
  operation_class: string
  status: 'pending' | 'running' | 'completed' | 'accepted' | 'dismissed' | 'cancelled' | 'failed'
  triggered_by: string
  tokens_input: number | null
  tokens_output: number | null
  tokens_cache_write: number | null
  tokens_cache_read: number | null
  model_id: string | null
  provider: string | null
  cost_usd: number | null
  result_summary: string | null
  result_prose: string | null
  result_notes: string | null
  result_metadata: Record<string, unknown> | null
  result_child_nodes: unknown[] | null
  target_node_version_at_capture: number | null
  error_message: string | null
  created_at: string
  started_at: string | null
  completed_at: string | null
}

interface AgentJobsState {
  jobs: Record<string, AgentJob>  // keyed by id
  upsertJob: (job: AgentJob) => void
  removeJob: (id: string) => void
  clear: () => void
}

const useStore = create<AgentJobsState>((set) => ({
  jobs: {},
  upsertJob: (job) =>
    set((s) => ({ jobs: { ...s.jobs, [job.id]: job } })),
  removeJob: (id) =>
    set((s) => {
      const { [id]: _removed, ...rest } = s.jobs
      return { jobs: rest }
    }),
  clear: () => set({ jobs: {} }),
}))

/**
 * Mount once at the AppShell level. Subscribes to the org's agent_jobs
 * channel and pipes all events into the Zustand store. Returns nothing.
 *
 * `organisationId` is the caller's org. If null, the subscription is
 * skipped (e.g. during initial auth resolution).
 *
 * Initial load: fetches recent (non-terminal) jobs for the org so the
 * UI doesn't have to wait for the next event to know about already-
 * running operations.
 */
export function useAgentJobsRealtime(organisationId: string | null): void {
  const upsertJob = useStore((s) => s.upsertJob)
  const removeJob = useStore((s) => s.removeJob)
  const clear = useStore((s) => s.clear)

  useEffect(() => {
    if (!organisationId) return
    const supabase = createClient()
    let cancelled = false

    // Initial: load all recent jobs (last 24 hours) so the UI shows
    // pre-existing state without waiting for events.
    void (async () => {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
      const { data } = await supabase
        .from('agent_jobs')
        .select('*')
        .eq('organisation_id', organisationId)
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(100)
      if (cancelled || !data) return
      data.forEach((row) => upsertJob(row as unknown as AgentJob))
    })()

    // Subscribe to all changes for this org's agent_jobs
    const channel = supabase
      .channel(`agent-jobs:${organisationId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'agent_jobs', filter: `organisation_id=eq.${organisationId}` },
        (payload) => {
          if (payload.eventType === 'DELETE') {
            const id = (payload.old as { id?: string }).id
            if (id) removeJob(id)
          } else {
            upsertJob(payload.new as AgentJob)
          }
        },
      )
      .subscribe()

    return () => {
      cancelled = true
      void supabase.removeChannel(channel)
      clear()
    }
  }, [organisationId, upsertJob, removeJob, clear])
}

// ─── Selectors ────────────────────────────────────────────────────────────

const ACTIVE_STATUSES = new Set(['pending', 'running'])
const ACTIONABLE_STATUSES = new Set(['pending', 'running', 'completed'])

export function useAgentJobsForNode(nodeId: string | null): AgentJob[] {
  const jobs = useStore((s) => s.jobs)
  return useMemo(() => {
    if (!nodeId) return []
    return Object.values(jobs)
      .filter((j) => j.node_id === nodeId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
  }, [jobs, nodeId])
}

/**
 * Returns the most recent actionable job for a node — pending, running,
 * or completed (awaiting accept/dismiss). Powers the AgentTab's state
 * machine. Returns null if no actionable job exists.
 */
export function useActiveJobForNode(nodeId: string | null): AgentJob | null {
  const jobs = useStore((s) => s.jobs)
  return useMemo(() => {
    if (!nodeId) return null
    const candidates = Object.values(jobs)
      .filter((j) => j.node_id === nodeId && ACTIONABLE_STATUSES.has(j.status))
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
    return candidates[0] ?? null
  }, [jobs, nodeId])
}

/**
 * Powers the AgentActivityIndicator on NodeRow — true when this node has
 * a pending or running job (not completed; that state has its own visual
 * affordance via the AgentTab's accept/dismiss buttons).
 */
export function useNodeHasRunningJob(nodeId: string | null): boolean {
  const jobs = useStore((s) => s.jobs)
  return useMemo(() => {
    if (!nodeId) return false
    return Object.values(jobs).some(
      (j) => j.node_id === nodeId && ACTIVE_STATUSES.has(j.status),
    )
  }, [jobs, nodeId])
}

export function useAgentJobsForDocument(documentId: string | null): AgentJob[] {
  const jobs = useStore((s) => s.jobs)
  return useMemo(() => {
    if (!documentId) return []
    return Object.values(jobs)
      .filter((j) => j.document_id === documentId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
  }, [jobs, documentId])
}
