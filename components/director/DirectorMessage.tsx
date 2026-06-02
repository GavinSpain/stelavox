// Spec: stelavox_component_specification_v2_7.md §7.4 (DirectorMessage)
//       stelavox_phase5b_build_checklist_v1_0.md §3.14 T-14.3
//       stelavox_phase8_01_C_build_checklist_v1_0.md T-5.
//
// Renders one assistant message. Plan/Execution cards (T-15) mount as
// children — when an assistant message has an associated workflow, the
// caller passes a <PlanCard /> or <ExecutionCard /> as children.
//
// Phase 8.01.C T-5: three additions — (a) collapsed ReasoningChip mounts
// above the prose body when the message contains a <plan> block,
// (b) ToolCallChips mounts below the prose body when toolCalls is
// non-empty, (c) InlineWorkflowProposalCard mounts after ToolCallChips
// when the message carries a workflow_proposal artefact. PlanCard
// remains the authoritative detail-panel dispatch surface — the inline
// card is an additional conversation-thread mount per §18.5.

import type { ReactNode } from 'react'

import { parseMessageProposals } from '@/lib/director/parse-message-proposals'
import { ReasoningChip } from './ReasoningChip'
import { ToolCallChips } from './ToolCallChips'
import { InlineWorkflowProposalCard } from './InlineWorkflowProposalCard'
import type { ToolCallEntry } from '@/lib/director/groupToolCalls'

interface DirectorMessageProps {
  content: string
  createdAt: string
  isStreaming?: boolean
  children?: ReactNode
  /** Phase 8.01.C T-5.2 — tool_calls extracted from conversation_messages
   *  for this assistant message. Rendered as ToolCallChips when non-empty. */
  toolCalls?: ToolCallEntry[]
  /** Phase 8.01.C T-5.3 — Approve handler for the inline workflow proposal.
   *  When the message has a workflow_proposal AND this handler is provided,
   *  InlineWorkflowProposalCard mounts. */
  onApproveWorkflow?: () => void
  /** Phase 8.01.C T-5.3 — optional Modify handler. */
  onModifyWorkflow?: () => void
  /** When true, the inline Approve button is disabled (e.g. approval in flight). */
  approvalInFlight?: boolean
}

function formatTime(iso: string) {
  try {
    const d = new Date(iso)
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
}

// Minimal **bold** → <strong> transformer. Spec §7.4: bold within text is
// Inter 500 --color-text-primary. Anything outside the bold runs is the
// default secondary colour. Markdown is conservative: only `**...**` is
// recognised; backslash-escaped `\*\*` are passed through literally.
function renderInlineBold(text: string): ReactNode[] {
  const out: ReactNode[] = []
  const re = /\*\*([^*\n]+?)\*\*/g
  let last = 0
  let m: RegExpExecArray | null
  let key = 0
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(<span key={key++}>{text.slice(last, m.index)}</span>)
    out.push(
      <strong
        key={key++}
        style={{
          fontWeight: 500,
          color: 'var(--color-text-primary)',
        }}
      >
        {m[1]}
      </strong>,
    )
    last = m.index + m[0].length
  }
  if (last < text.length) out.push(<span key={key++}>{text.slice(last)}</span>)
  return out
}

export function DirectorMessage({
  content,
  createdAt,
  isStreaming = false,
  children,
  toolCalls,
  onApproveWorkflow,
  onModifyWorkflow,
  approvalInFlight = false,
}: DirectorMessageProps) {
  // Strip any embedded proposal blocks from the rendered text. The
  // persisted content includes the raw <workflow_proposal> /
  // <brief_proposal> XML — proposal cards render those separately,
  // so we don't want the JSON shown as text.
  // Phase 8.01.C T-1: planText is now exposed (was discarded) so we can
  // render the collapsed ReasoningChip.
  const { cleanedContent, planText, workflowProposal } = parseMessageProposals(content)
  return (
    <div
      role="article"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        maxWidth: '90%',
        marginBottom: 16,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 8,
          marginBottom: 6,
        }}
      >
        <span
          style={{
            fontFamily: 'var(--font-inter), Inter, sans-serif',
            fontWeight: 500,
            fontSize: 10,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: 'var(--color-text-muted)',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
          }}
        >
          <span aria-hidden="true" style={{ color: 'var(--color-accent)' }}>◆</span>
          Director
        </span>
        <time
          dateTime={createdAt}
          style={{
            fontFamily: 'var(--font-inter), Inter, sans-serif',
            fontWeight: 300,
            fontSize: 10,
            color: 'var(--color-text-muted)',
          }}
        >
          {formatTime(createdAt)}
        </time>
      </div>
      {/* Phase 8.01.C T-5.1 — collapsed Reasoning chip above the prose body. */}
      {planText && <ReasoningChip text={planText} />}
      <div
        aria-live={isStreaming ? 'polite' : undefined}
        style={{
          fontFamily: 'var(--font-inter), Inter, sans-serif',
          fontWeight: 400,
          fontSize: 12,
          lineHeight: 1.6,
          color: 'var(--color-text-secondary)',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        {renderInlineBold(cleanedContent)}
      </div>
      {/* Phase 8.01.C T-5.2 — tool-call chips after the prose body. */}
      {toolCalls && toolCalls.length > 0 && <ToolCallChips calls={toolCalls} />}
      {/* Phase 8.01.C T-5.3 — inline workflow proposal card after tool chips. */}
      {workflowProposal && onApproveWorkflow && (
        <InlineWorkflowProposalCard
          workflowProposal={workflowProposal}
          onApprove={onApproveWorkflow}
          onModify={onModifyWorkflow}
          disabled={approvalInFlight}
        />
      )}
      {children ? <div style={{ marginTop: 12, width: '100%' }}>{children}</div> : null}
    </div>
  )
}
