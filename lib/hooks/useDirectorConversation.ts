'use client'

/**
 * Director conversation data layer.
 *
 * Source: stelavox_phase5b_api_contract_v1_0.md §2.17 (real-time
 *         subscription contract), §3.3 (mounting endpoint), §2.12-§2.15
 *         (response shapes).
 *         stelavox_phase5b_build_checklist_v1_0.md §3.14 T-14.1 (G-12).
 *
 * Responsibilities:
 *   1. Initial load via GET /api/documents/[documentId]/conversation —
 *      one round-trip returns conversation + recent_messages + current
 *      workflow (with steps).
 *   2. Real-time subscription to `workflows` for the active document.
 *      Any change triggers a refetch of the current workflow + steps.
 *      H-05: subscription is torn down on unmount.
 *   3. Local optimistic surface for messages — `appendMessage()` lets
 *      DirectorInput (T-16) push the user's message into the thread the
 *      moment it's posted, before SSE confirms.
 *
 * The hook does NOT subscribe to `conversation_messages` real-time —
 * the SSE stream is the source of truth for new assistant content, and
 * the user's own messages are appended optimistically. Real-time on
 * messages would create duplicate-render races against the SSE feed.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
// Phase 8.5b B.5c — createClient + ensureRealtimeAuth dropped here;
// the multiplexed user channel (UserRealtimeChannel) carries both
// `workflows` and `workflow_steps` topics. See REALTIME_TOPICS in
// lib/realtime/demuxer.ts and the cap-raise rationale in Tier-A §5.3.
import { useRealtimeTopic } from '@/lib/realtime/useRealtimeTopic'

export interface ConversationDto {
  id: string
  document_id: string
  conversation_summary: string | null
  summary_covers_through: string | null
  message_count: number
  current_workflow_id: string | null
  created_at: string
  updated_at: string
}

export interface ConversationMessageDto {
  id: string
  conversation_id: string
  role: 'user' | 'assistant'
  content: string
  sequence: number
  tool_calls: unknown[]
  workflow_id: string | null
  created_at: string
}

export interface WorkflowStepDto {
  id: string
  workflow_id: string
  order: number
  operation_type: string
  target_node_id: string
  target_node_label: string
  parameters: Record<string, unknown>
  description: string
  estimated_duration_seconds: number
  depends_on_step_orders: number[]
  status:
    | 'pending'
    | 'running'
    | 'completed'
    | 'failed'
    | 'skipped'
    | 'removed'
  agent_job_id: string | null
  result_summary: string | null
  error_message: string | null
  started_at: string | null
  completed_at: string | null
}

export interface WorkflowDto {
  id: string
  document_id: string
  conversation_id: string
  title: string
  description: string
  impact_summary: string
  status:
    | 'draft'
    | 'approved'
    | 'running'
    | 'paused'
    | 'completed'
    | 'cancelled'
  estimated_total_minutes: number
  locked_nodes_requiring_unlock: string[]
  steps: WorkflowStepDto[]
  error_message?: string | null
  created_at: string
  approved_at: string | null
  completed_at: string | null
  updated_at: string
}

export interface UseDirectorConversationResult {
  conversation: ConversationDto | null
  messages: ConversationMessageDto[]
  currentWorkflow: WorkflowDto | null
  /**
   * Phase 9.E (DR-066) — the id of an assistant message left in
   * turn_state='interrupted' (a crash/disconnect mid-turn). Non-null
   * means the conversation has a resumable interrupted turn; DirectorPanel
   * surfaces a resume prompt. Null in the common case.
   */
  interruptedMessageId: string | null
  isLoading: boolean
  error: string | null
  /** Refetch everything from the server. */
  refresh: () => Promise<void>
  /** Optimistically append a message to the thread. */
  appendMessage: (msg: ConversationMessageDto) => void
  /** Replace a message (e.g. when SSE provides the persisted server version). */
  replaceMessage: (id: string, msg: ConversationMessageDto) => void
}

interface MountResponse {
  conversation: ConversationDto
  recent_messages: ConversationMessageDto[]
  current_workflow: WorkflowDto | null
  interrupted_message_id?: string | null
}

export function useDirectorConversation(
  documentId: string | null,
): UseDirectorConversationResult {
  const [conversation, setConversation] = useState<ConversationDto | null>(null)
  const [messages, setMessages] = useState<ConversationMessageDto[]>([])
  const [currentWorkflow, setCurrentWorkflow] = useState<WorkflowDto | null>(null)
  const [interruptedMessageId, setInterruptedMessageId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState<boolean>(documentId !== null)
  const [error, setError] = useState<string | null>(null)

  // Track the active document so async fetches can detect they were
  // superseded (e.g. user navigates between documents quickly).
  const activeDocIdRef = useRef<string | null>(documentId)
  useEffect(() => {
    activeDocIdRef.current = documentId
  }, [documentId])

  const refresh = useCallback(async () => {
    if (!documentId) return
    setIsLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/documents/${documentId}/conversation`, {
        cache: 'no-store',
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string
          message?: string
        }
        throw new Error(body.message ?? body.error ?? `HTTP ${res.status}`)
      }
      const json = (await res.json()) as MountResponse
      // If the user has already moved on, drop the result.
      if (activeDocIdRef.current !== documentId) return
      setConversation(json.conversation)
      setMessages(json.recent_messages ?? [])
      setCurrentWorkflow(json.current_workflow ?? null)
      setInterruptedMessageId(json.interrupted_message_id ?? null)
    } catch (e) {
      if (activeDocIdRef.current !== documentId) return
      setError(e instanceof Error ? e.message : 'Failed to load conversation')
    } finally {
      if (activeDocIdRef.current === documentId) setIsLoading(false)
    }
  }, [documentId])

  // Initial load when the document changes.
  useEffect(() => {
    if (!documentId) {
      // Clear stale state on document detach. Eslint warns about
      // setState-in-effect; this is a legitimate input-driven reset
      // (the input is `documentId`; deriving these on every render
      // would re-allocate arrays). Same pattern as AppShell width
      // hydration.
      /* eslint-disable react-hooks/set-state-in-effect */
      setConversation(null)
      setMessages([])
      setCurrentWorkflow(null)
      setInterruptedMessageId(null)
      setIsLoading(false)
      setError(null)
      /* eslint-enable react-hooks/set-state-in-effect */
      return
    }
    void refresh()
  }, [documentId, refresh])

  // F-204 (round-3 audit): debounce real-time-driven refreshes. A
  // 30-step workflow firing 30 step transitions + 2 status updates
  // pre-fix produced ~32 full GETs to the conversation endpoint. The
  // 200ms debounce coalesces bursts into a single refresh while
  // staying snappy enough that single events feel instant.
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const debouncedRefresh = useCallback(() => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
    debounceTimerRef.current = setTimeout(() => {
      debounceTimerRef.current = null
      void refresh()
    }, 200)
  }, [refresh])

  // Phase 8.5b B.5c — Realtime via the multiplexed user channel. Two
  // topic subscriptions instead of two standalone channels. Filters
  // run at the subscriber level because workflows / workflow_steps are
  // not org-scoped at the channel level (no `organisation_id` column).
  //
  // Both subscriptions share the same debounced refresher so a burst
  // hitting both topics coalesces into a single fetch.
  useRealtimeTopic<{ document_id?: string }>(
    'workflows',
    () => debouncedRefresh(),
    (payload) => {
      if (!documentId) return false
      const row = (payload.new && Object.keys(payload.new).length > 0 ? payload.new : payload.old)
      return row.document_id === documentId
    },
  )
  useRealtimeTopic<{ workflow_id?: string }>(
    'workflow_steps',
    () => debouncedRefresh(),
    (payload) => {
      const wfId = currentWorkflow?.id
      if (!wfId) return false
      const row = (payload.new && Object.keys(payload.new).length > 0 ? payload.new : payload.old)
      return row.workflow_id === wfId
    },
  )

  // Clean up any pending debounce timer on unmount.
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
        debounceTimerRef.current = null
      }
    }
  }, [])

  const appendMessage = useCallback((msg: ConversationMessageDto) => {
    setMessages((prev) => [...prev, msg])
  }, [])

  const replaceMessage = useCallback(
    (id: string, msg: ConversationMessageDto) => {
      setMessages((prev) => prev.map((m) => (m.id === id ? msg : m)))
    },
    [],
  )

  return {
    conversation,
    messages,
    currentWorkflow,
    interruptedMessageId,
    isLoading,
    error,
    refresh,
    appendMessage,
    replaceMessage,
  }
}
