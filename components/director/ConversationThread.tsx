'use client'

// Spec: stelavox_component_specification_v2_7.md §7.2 (ConversationThread)
//       stelavox_phase5b_build_checklist_v1_0.md §3.14 T-14.2
//
// Scrollable message list. Auto-scrolls to bottom on new messages unless
// the author has scrolled up — in that case a "Jump to latest" button
// appears. Renders UserMessage / DirectorMessage and an optional
// ThinkingIndicator at the bottom while the Director is processing.
//
// Plan / Execution cards (T-15) mount through the renderWorkflowSlot
// prop. The thread doesn't know about workflows itself.

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { UserMessage } from './UserMessage'
import { DirectorMessage } from './DirectorMessage'
import { ThinkingIndicator } from './ThinkingIndicator'

export interface ConversationMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  created_at: string
  workflow_id: string | null
}

interface ConversationThreadProps {
  messages: ConversationMessage[]
  isThinking?: boolean
  streamingMessageId?: string | null
  renderWorkflowSlot?: (messageId: string, workflowId: string) => ReactNode
  /**
   * Render Brief proposal / amendment cards for an assistant message
   * based on its raw content. Called for every assistant message so the
   * panel can parse the content and return the appropriate card or null.
   */
  renderBriefSlot?: (messageId: string, content: string) => ReactNode
}

const NEAR_BOTTOM_PX = 40

export function ConversationThread({
  messages,
  isThinking = false,
  streamingMessageId = null,
  renderWorkflowSlot,
  renderBriefSlot,
}: ConversationThreadProps) {
  const scrollerRef = useRef<HTMLDivElement>(null)
  const [autoFollow, setAutoFollow] = useState(true)

  const scrollToBottom = useCallback((smooth: boolean) => {
    const el = scrollerRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' })
  }, [])

  // Initial mount: jump to bottom without animation so a refreshed
  // conversation lands at the latest message.
  useEffect(() => {
    scrollToBottom(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // On new message / streaming-token / thinking-state change, follow the
  // bottom only if the author hasn't scrolled away.
  useEffect(() => {
    if (autoFollow) scrollToBottom(true)
  }, [messages, isThinking, autoFollow, scrollToBottom])

  const onScroll = useCallback(() => {
    const el = scrollerRef.current
    if (!el) return
    const distanceFromBottom = el.scrollHeight - (el.scrollTop + el.clientHeight)
    setAutoFollow(distanceFromBottom <= NEAR_BOTTOM_PX)
  }, [])

  const handleJumpToLatest = useCallback(() => {
    setAutoFollow(true)
    scrollToBottom(true)
  }, [scrollToBottom])

  return (
    <div
      style={{
        position: 'relative',
        flex: 1,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        ref={scrollerRef}
        onScroll={onScroll}
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          padding: '16px 20px 12px 20px',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {messages.length === 0 && !isThinking ? (
          <div
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontFamily: 'var(--font-inter), Inter, sans-serif',
              fontWeight: 300,
              fontSize: 12,
              color: 'var(--color-text-muted)',
              fontStyle: 'italic',
              textAlign: 'center',
              padding: 24,
            }}
          >
            Start a conversation with the Director to plan changes to this document.
          </div>
        ) : (
          messages.map((m) =>
            m.role === 'user' ? (
              <UserMessage key={m.id} content={m.content} createdAt={m.created_at} />
            ) : (
              <DirectorMessage
                key={m.id}
                content={m.content}
                createdAt={m.created_at}
                isStreaming={m.id === streamingMessageId}
              >
                {m.workflow_id && renderWorkflowSlot
                  ? renderWorkflowSlot(m.id, m.workflow_id)
                  : null}
                {renderBriefSlot ? renderBriefSlot(m.id, m.content) : null}
              </DirectorMessage>
            ),
          )
        )}
        {isThinking ? <ThinkingIndicator /> : null}
      </div>

      {!autoFollow && (
        <button
          type="button"
          onClick={handleJumpToLatest}
          style={{
            position: 'absolute',
            bottom: 12,
            left: '50%',
            transform: 'translateX(-50%)',
            fontFamily: 'var(--font-inter), Inter, sans-serif',
            fontWeight: 400,
            fontSize: 11,
            color: 'var(--color-text-muted)',
            background: 'var(--color-bg-elevated)',
            border: '1px solid var(--color-border-default)',
            borderRadius: 12,
            padding: '4px 12px',
            boxShadow: 'var(--shadow-sm, 0 1px 2px rgba(0,0,0,0.2))',
            cursor: 'pointer',
          }}
        >
          ↓ Jump to latest
        </button>
      )}
    </div>
  )
}
