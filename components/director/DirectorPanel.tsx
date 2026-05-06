'use client'

// Spec: stelavox_component_specification_v2_7.md §7.1 (DirectorPanel)
//       stelavox_phase5b_api_contract_v1_0.md §3.3, §2.17, G-12
//       stelavox_phase5b_build_checklist_v1_0.md §3.14 T-14.1
//
// The Director panel mounts in the right column when ModeTabBar is on
// Director. Header (◆ The Director + document tag + History) at top,
// scrollable ConversationThread below, DirectorInput (T-16) at the
// bottom. Conversation state via useDirectorConversation (fetch +
// real-time on workflows / workflow_steps).
//
// Width: 580px preferred (clamped by the host slot to 400–55vw). The
// AppShell right slot enforces actual layout width; here we pin a
// min-width so the slot expands to fit when entering Director Mode.
//
// PlanCard / ExecutionCard mount via children of DirectorMessage in
// T-15; this panel passes a renderWorkflowSlot callback through that
// is currently a no-op (returns null). T-15 will replace that.
//
// H-05: subscriptions live in useDirectorConversation and are torn down
// by its own useEffect cleanup.

import { useDirectorConversation } from '@/lib/hooks/useDirectorConversation'
import { ConversationThread, type ConversationMessage } from './ConversationThread'

interface DirectorPanelProps {
  documentId: string
  documentName: string
  onClose?: () => void
}

export function DirectorPanel({
  documentId,
  documentName,
  onClose,
}: DirectorPanelProps) {
  const { messages, isLoading, error } = useDirectorConversation(documentId)

  const threadMessages: ConversationMessage[] = messages.map((m) => ({
    id: m.id,
    role: m.role,
    content: m.content,
    created_at: m.created_at,
    workflow_id: m.workflow_id,
  }))

  return (
    <section
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
      <DirectorHeader documentName={documentName} onClose={onClose} />

      {error ? (
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
          Director unavailable — {error}
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
        <ConversationThread messages={threadMessages} />
      )}

      <DirectorInputPlaceholder />
    </section>
  )
}

// ────────────────────────────────────────────────────────────────────
// DirectorHeader (Component Spec §7.1)
//
// Title "◆ The Director" Inter 600 13px (◆ in --color-accent — brand
// identity marker, not subject to the nine-use rule per §7.1).
// Document tag chip + History button on the right.

function DirectorHeader({
  documentName,
  onClose,
}: {
  documentName: string
  onClose?: () => void
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
      <h2
        style={{
          margin: 0,
          fontFamily: 'var(--font-inter), Inter, sans-serif',
          fontWeight: 600,
          fontSize: 13,
          color: 'var(--color-text-primary)',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        <span aria-hidden="true" style={{ color: 'var(--color-accent)' }}>◆</span>
        The Director
      </h2>

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

// Placeholder for the DirectorInput surface (T-16). Keeping it here so
// the panel lays out correctly during T-14 — flex column with a fixed
// bottom region. T-16 replaces this with the real DirectorInput.

function DirectorInputPlaceholder() {
  return (
    <div
      style={{
        flexShrink: 0,
        padding: '12px 20px 16px',
        borderTop: '1px solid var(--color-border-subtle)',
        background: 'var(--color-bg-surface)',
      }}
    >
      <div
        style={{
          background: 'var(--color-bg-base)',
          border: '1px solid var(--color-border-subtle)',
          borderRadius: 5,
          padding: '10px 12px',
          fontFamily: 'var(--font-inter), Inter, sans-serif',
          fontWeight: 300,
          fontSize: 12,
          color: 'var(--color-text-disabled)',
          fontStyle: 'italic',
        }}
      >
        Director input arrives in T-16…
      </div>
    </div>
  )
}
