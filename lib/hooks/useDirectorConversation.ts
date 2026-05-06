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
import { createClient } from '@/lib/supabase/client'

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
}

export function useDirectorConversation(
  documentId: string | null,
): UseDirectorConversationResult {
  const [conversation, setConversation] = useState<ConversationDto | null>(null)
  const [messages, setMessages] = useState<ConversationMessageDto[]>([])
  const [currentWorkflow, setCurrentWorkflow] = useState<WorkflowDto | null>(null)
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
      setIsLoading(false)
      setError(null)
      /* eslint-enable react-hooks/set-state-in-effect */
      return
    }
    void refresh()
  }, [documentId, refresh])

  // Real-time on workflows for this document — fire a refresh when any
  // row changes. Cheap because the GET endpoint resolves the right
  // current workflow for us.
  useEffect(() => {
    if (!documentId) return
    const supabase = createClient()
    const channel = supabase
      .channel(`director-workflows:${documentId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'workflows',
          filter: `document_id=eq.${documentId}`,
        },
        () => {
          void refresh()
        },
      )
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [documentId, refresh])

  // Real-time on workflow_steps for the current workflow — same
  // refresh-on-event pattern. Re-subscribes when the active workflow
  // changes.
  useEffect(() => {
    if (!currentWorkflow?.id) return
    const supabase = createClient()
    const wfId = currentWorkflow.id
    const channel = supabase
      .channel(`director-workflow-steps:${wfId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'workflow_steps',
          filter: `workflow_id=eq.${wfId}`,
        },
        () => {
          void refresh()
        },
      )
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [currentWorkflow?.id, refresh])

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
    isLoading,
    error,
    refresh,
    appendMessage,
    replaceMessage,
  }
}
