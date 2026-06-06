'use client'

// Spec: stelavox_component_specification_v2_7.md §7.1 (DirectorPanel)
//       stelavox_phase5b_api_contract_v1_0.md §3.1, §3.3, §2.16, §2.17, G-12
//       stelavox_phase5b_build_checklist_v1_0.md §3.14 T-14.1, §3.16 T-16
//
// Mounts in the right column when ModeTabBar is on Director. Header +
// scrollable ConversationThread + DirectorInput. Conversation state
// via useDirectorConversation (fetch + real-time on workflows /
// workflow_steps). Send goes through streamDirectorMessage and the
// SSE handlers update local streaming state; on `done` we refresh the
// canonical message list from the server.
//
// Width: 580px preferred (clamped by the host slot to 400–55vw).
//
// PlanCard / ExecutionCard mount via children of DirectorMessage —
// renderWorkflowSlot returns the right card based on workflow.status.
//
// H-05: subscriptions live in useDirectorConversation and are torn
// down by its own useEffect cleanup.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  useDirectorConversation,
  type ConversationMessageDto,
} from '@/lib/hooks/useDirectorConversation'
import { ConversationThread, type ConversationMessage } from './ConversationThread'
import { DirectorInput } from './DirectorInput'
import { PlanCard } from './PlanCard'
import { ExecutionCard } from './ExecutionCard'
import { WorkflowCompletionAck } from './WorkflowCompletionAck'
import { BriefProposalCard } from './BriefProposalCard'
import { BriefCancellationProposalCard } from './BriefCancellationProposalCard'
import { CapabilityLimitCard } from './CapabilityLimitCard'
import { ProjectProfileAmendmentCard } from './ProjectProfileAmendmentCard'
import { DirectorMark, DirectorLabel } from './DirectorMark'
import { ConversationClearButton } from './ConversationClearButton'
import { StopButton } from './StopButton'
import { streamDirectorMessage } from '@/lib/director/streamMessage'
import { findProposalInToolCalls } from '@/lib/director/parse-message-proposals'

interface DirectorPanelProps {
  documentId: string
  documentName: string
  profileId?: string | null
  onClose?: () => void
}

interface StreamingState {
  // Synthetic local message ids while the SSE turn is in flight.
  userMessageId: string
  assistantMessageId: string
  conversationId: string | null
  /** V1.x-B.2.1 — director_turn id surfaced for the StopButton wiring. */
  turnId: string | null
  text: string
  isThinking: boolean // true between start and first text_delta
}

export function DirectorPanel({
  documentId,
  documentName,
  profileId,
  onClose,
}: DirectorPanelProps) {
  const {
    conversation,
    messages,
    isLoading,
    error,
    currentWorkflow,
    refresh,
    appendMessage,
  } = useDirectorConversation(documentId)
  const [streaming, setStreaming] = useState<StreamingState | null>(null)
  const [streamError, setStreamError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  // Tear down any in-flight stream on unmount.
  useEffect(() => {
    return () => {
      abortRef.current?.abort()
    }
  }, [])

  const handleSend = useCallback(
    async (content: string, mentionedNodeIds: string[]) => {
      if (streaming) return
      setStreamError(null)
      const ts = new Date().toISOString()
      const localUserId = `_local-user-${Date.now()}`
      const localAssistantId = `_local-assistant-${Date.now()}`
      // Optimistically show the user's message and a thinking-state
      // assistant placeholder.
      appendMessage({
        id: localUserId,
        conversation_id: conversation?.id ?? '',
        role: 'user',
        content,
        sequence: -1,
        tool_calls: [],
        workflow_id: null,
        created_at: ts,
      })
      setStreaming({
        userMessageId: localUserId,
        assistantMessageId: localAssistantId,
        conversationId: conversation?.id ?? null,
        turnId: null,
        text: '',
        isThinking: true,
      })
      const ctrl = new AbortController()
      abortRef.current = ctrl
      try {
        await streamDirectorMessage(
          {
            documentId,
            conversationId: conversation?.id ?? null,
            content,
            mentionedNodeIds,
            signal: ctrl.signal,
          },
          {
            onStart: (d) => {
              setStreaming((s) =>
                s
                  ? { ...s, conversationId: d.conversation_id, turnId: d.turn_id ?? null, isThinking: true }
                  : s,
              )
            },
            onTextDelta: (delta) => {
              setStreaming((s) =>
                s ? { ...s, text: s.text + delta, isThinking: false } : s,
              )
            },
            onToolUseStart: () => {
              // Show a brief thinking pulse between tool boundaries.
              setStreaming((s) => (s ? { ...s, isThinking: true } : s))
            },
            onToolUseComplete: () => {
              setStreaming((s) => (s ? { ...s, isThinking: false } : s))
            },
            onWorkflowProposal: () => {
              // The workflow row will arrive via real-time; force a
              // refresh so the inline PlanCard mounts immediately.
              void refresh()
            },
            onAssistantMessageComplete: () => {
              // Persisted; canonical state will be reloaded on done.
            },
            onError: (d) => {
              setStreamError(d.message ?? d.error ?? 'Stream error')
            },
            onDone: () => {
              // No-op here; the finally block clears streaming and
              // triggers a refresh.
            },
          },
        )
      } catch (e) {
        if ((e as { name?: string })?.name === 'AbortError') return
        setStreamError(e instanceof Error ? e.message : 'Stream failed')
      } finally {
        abortRef.current = null
        setStreaming(null)
        // Final reconciliation with the server.
        await refresh()
      }
    },
    [appendMessage, conversation, documentId, refresh, streaming],
  )

  // Compose the rendered message list: server messages + (if streaming)
  // a synthetic assistant message with the current text. The user's
  // optimistic message is already in `messages` via appendMessage().
  const threadMessages: ConversationMessage[] = useMemo(() => {
    const mapped: ConversationMessage[] = messages.map((m: ConversationMessageDto) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      created_at: m.created_at,
      workflow_id: m.workflow_id,
      // Phase 8.01.C T-6.1 — surface tool_calls so DirectorMessage can
      // render the chip strip. Pre-V1.x-A messages may not have this
      // column populated; the DirectorMessage component handles undefined
      // by rendering nothing.
      tool_calls: extractToolCallEntries(m.tool_calls),
    }))
    if (streaming && streaming.text.length > 0) {
      mapped.push({
        id: streaming.assistantMessageId,
        role: 'assistant',
        content: streaming.text,
        created_at: new Date().toISOString(),
        workflow_id: null,
      })
    }
    return mapped
  }, [messages, streaming])

  // Phase 8.01.C T-6.1 — narrow the conversation_messages.tool_calls JSONB
  // to the ToolCallEntry shape the chip component expects. Defensive: any
  // entry missing name or arguments is skipped.
  function extractToolCallEntries(
    raw: unknown,
  ): { name: string; arguments: Record<string, unknown> }[] | undefined {
    if (!Array.isArray(raw)) return undefined
    const out: { name: string; arguments: Record<string, unknown> }[] = []
    for (const entry of raw) {
      if (entry && typeof entry === 'object') {
        const e = entry as Record<string, unknown>
        const name = typeof e.name === 'string' ? e.name : null
        const args = e.arguments && typeof e.arguments === 'object' ? (e.arguments as Record<string, unknown>) : {}
        if (name) out.push({ name, arguments: args })
      }
    }
    return out.length > 0 ? out : undefined
  }

  const renderWorkflowSlot = useCallback(
    (_messageId: string, workflowId: string) => {
      if (!currentWorkflow || currentWorkflow.id !== workflowId) return null
      const status = currentWorkflow.status
      if (status === 'draft') {
        return (
          <PlanCard
            workflow={currentWorkflow}
            onApproved={() => void refresh()}
            onCancelled={() => void refresh()}
          />
        )
      }
      // V1.x-D.3 — for terminal-state workflows, the ExecutionCard
      // still shows the per-step status; the WorkflowCompletionAck
      // adds the mechanical acknowledgement line below it.
      const isTerminal = status === 'completed' || status === 'cancelled'
      const stepsTotal = currentWorkflow.steps?.length ?? 0
      const stepsSucceeded =
        currentWorkflow.steps?.filter((s) => s.status === 'completed').length ?? 0
      const stepsFailed =
        currentWorkflow.steps?.filter((s) => s.status === 'failed').length ?? 0
      // Translate workflow.status → ack status (paused/cancelled don't
      // emit an ack; only completed/failed/partially_completed).
      let ackStatus: string | null = null
      if (status === 'completed') {
        ackStatus = stepsFailed > 0 ? 'partially_completed' : 'completed'
      } else if (
        currentWorkflow.error_message &&
        (status === 'cancelled' || status === 'paused')
      ) {
        ackStatus = 'failed'
      }
      return (
        <>
          <ExecutionCard
            workflow={currentWorkflow}
            onUpdated={() => void refresh()}
          />
          {ackStatus && isTerminal ? (
            <WorkflowCompletionAck
              status={ackStatus}
              stepsTotal={stepsTotal}
              stepsSucceeded={stepsSucceeded}
              stepsFailed={stepsFailed}
              failureClass={null}
            />
          ) : null}
        </>
      )
    },
    [currentWorkflow, refresh],
  )

  const renderBriefSlot = useCallback(
    (messageId: string, _content: string) => {
      // V1.x-A.1 (v1.6): read proposal artefacts from the message's
      // tool_calls audit log, not from XML in the rendered text. The
      // executor stashes the validated artefact on the propose_brief /
      // propose_profile_amendment tool_call entry.
      const message = messages.find((m) => m.id === messageId)
      if (!message) return null
      const {
        briefProposal,
        briefProposalConcurrentEdit,
        profileAmendmentProposal,
        briefCancellationProposal,
        capabilityLimitProposal,
      } = findProposalInToolCalls(message.tool_calls)
      if (briefProposal) {
        return (
          <BriefProposalCard
            documentId={documentId}
            proposal={briefProposal}
            concurrentEditWarning={briefProposalConcurrentEdit}
            onApproved={() => void refresh()}
          />
        )
      }
      if (profileAmendmentProposal && profileId) {
        return (
          <ProjectProfileAmendmentCard
            profileId={profileId}
            amendment={profileAmendmentProposal}
            onApproved={() => void refresh()}
          />
        )
      }
      if (briefCancellationProposal) {
        return (
          <BriefCancellationProposalCard
            proposal={briefCancellationProposal}
            onApproved={() => void refresh()}
          />
        )
      }
      if (capabilityLimitProposal) {
        // V1.x-F.1 — Director self-rejection. No "Approved" callback;
        // the user reformulates their request manually.
        return <CapabilityLimitCard proposal={capabilityLimitProposal} />
      }
      return null
    },
    [documentId, messages, profileId, refresh],
  )

  const showThinking = !!streaming && streaming.isThinking
  const streamingMessageId = streaming?.assistantMessageId ?? null

  return (
    <section
      data-testid="director-panel"
      role="complementary"
      aria-label="Director"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minWidth: 400,
        background: 'var(--color-bg-surface)',
      }}
    >
      <DirectorHeader
        documentName={documentName}
        conversationId={conversation?.id ?? null}
        onClose={onClose}
        onCleared={() => void refresh()}
        activeTurnId={streaming?.turnId ?? null}
        onTurnStopped={() => {
          // Stop API marks the turn cancelled; abort the in-flight SSE
          // so the UI exits the streaming state and refreshes.
          abortRef.current?.abort()
        }}
      />

      {error || streamError ? (
        <div
          role="alert"
          style={{
            padding: '12px 20px',
            margin: '12px 20px 0',
            background: 'rgba(184,48,48,0.08)',
            border: '1px solid var(--color-error, #b83030)',
            borderRadius: 4,
            fontFamily: 'var(--font-inter), Inter, sans-serif',
            fontSize: 11,
            color: 'var(--color-text-primary)',
          }}
        >
          Director — {streamError ?? error}
        </div>
      ) : null}

      {isLoading && messages.length === 0 ? (
        <div
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: 'var(--font-inter), Inter, sans-serif',
            fontSize: 11,
            color: 'var(--color-text-muted)',
          }}
        >
          Loading conversation…
        </div>
      ) : (
        <ConversationThread
          messages={threadMessages}
          isThinking={showThinking}
          streamingMessageId={streamingMessageId}
          renderWorkflowSlot={renderWorkflowSlot}
          renderBriefSlot={renderBriefSlot}
        />
      )}

      <DirectorInput
        documentId={documentId}
        isStreaming={streaming !== null}
        onSend={handleSend}
      />
    </section>
  )
}

// ────────────────────────────────────────────────────────────────────
// DirectorHeader (Component Spec §7.1)

function DirectorHeader({
  documentName,
  conversationId,
  onClose,
  onCleared,
  activeTurnId,
  onTurnStopped,
}: {
  documentName: string
  conversationId: string | null
  onClose?: () => void
  onCleared?: () => void
  /** V1.x-B.2.1 — Director turn id for the StopButton. Null when no turn in flight. */
  activeTurnId?: string | null
  onTurnStopped?: () => void
}) {
  return (
    <header
      style={{
        flexShrink: 0,
        padding: '12px 20px',
        borderBottom: '1px solid var(--color-border-subtle)',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        background: 'var(--color-bg-surface)',
      }}
    >
      {/* Phase 8.01 wireframe-alignment round 2 — Director-persona
          brand mark + label per wireframe
          05_director_mode_v1_iter1.html .dp-mark + .dp-name. The mark
          + label live in components/director/DirectorMark.tsx which is
          the sanctioned brand-mark site for the agent persona
          (Inviolable #3 v2.4 refinement; see Brand Identity §12). */}
      <DirectorBrandHeading />
      {/* Working-state indicator — small status line under the mark,
          showing "working…" + pulsing pip when a turn is in flight. */}
      <DirectorWorkingIndicator active={!!activeTurnId} />

      <span
        title={documentName}
        style={{
          fontFamily: 'var(--font-inter), Inter, sans-serif',
          fontWeight: 300,
          fontSize: 10,
          color: 'var(--color-text-secondary)',
          background: 'var(--color-bg-base)',
          border: '1px solid var(--color-border-subtle)',
          borderRadius: 3,
          padding: '2px 6px',
          maxWidth: 180,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {documentName}
      </span>

      <div style={{ marginLeft: 'auto', display: 'inline-flex', gap: 8 }}>
        {activeTurnId ? (
          <StopButton turnId={activeTurnId} onStopped={onTurnStopped} />
        ) : null}
        {conversationId ? (
          <ConversationClearButton
            conversationId={conversationId}
            onCleared={onCleared}
          />
        ) : null}
        <button
          type="button"
          disabled
          aria-disabled="true"
          title="History (V2)"
          style={{
            fontFamily: 'var(--font-inter), Inter, sans-serif',
            fontWeight: 300,
            fontSize: 11,
            color: 'var(--color-text-muted)',
            background: 'transparent',
            border: '1px solid var(--color-border-subtle)',
            borderRadius: 3,
            padding: '3px 10px',
            cursor: 'not-allowed',
            opacity: 0.6,
          }}
        >
          History
        </button>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Director"
            style={{
              fontFamily: 'var(--font-inter), Inter, sans-serif',
              fontWeight: 300,
              fontSize: 14,
              lineHeight: 1,
              color: 'var(--color-text-muted)',
              background: 'transparent',
              border: 'none',
              padding: '0 4px',
              cursor: 'pointer',
            }}
          >
            ✕
          </button>
        ) : null}
      </div>
    </header>
  )
}

// ────────────────────────────────────────────────────────────────────
// Phase 8.01 v2.4 — Director brand heading + working-state indicator.

function DirectorBrandHeading() {
  return (
    <div
      data-testid="director-brand-heading"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 10,
        flexShrink: 0,
      }}
    >
      <DirectorMark />
      <DirectorLabel />
    </div>
  )
}

function DirectorWorkingIndicator({ active }: { active: boolean }) {
  if (!active) return null
  return (
    <span
      data-testid="director-working-indicator"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        fontFamily: 'var(--font-inter), Inter, sans-serif',
        fontSize: 10.5,
        color: 'var(--color-info)',
        marginLeft: 4,
      }}
    >
      <span
        aria-hidden
        className="agent-activity-pulse"
        style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: 'var(--color-info)',
          boxShadow: '0 0 5px rgba(77,143,214,0.55)',
        }}
      />
      working…
    </span>
  )
}
