// Unit test for the Director text-delta suppression of the
// <workflow_proposal>...</workflow_proposal> block.
//
// Bug context (2026-05-08): the executor was yielding every text chunk
// from streamWithTools verbatim as a text_delta SSE event, including
// chunks that contained the literal <workflow_proposal> XML markup. The
// markup was meant to be parsed into a structured PlanCard at the end
// of the turn, not displayed as raw text. Users saw the XML markup
// briefly before the PlanCard rendered.
//
// Fix: a small state machine in lib/director/executor.ts:
// `consumeTextForDelta`. This test exercises the state machine
// independently of the full agentic loop — no LLM, no Supabase, pure.

import { describe, expect, it } from 'vitest'

import {
  consumeTextForDelta,
  freshSuppressionState,
  type WorkflowSuppressionState,
} from '@/lib/director/executor'

function runChunks(chunks: string[]): { visible: string; finalState: WorkflowSuppressionState } {
  let state = freshSuppressionState()
  let visible = ''
  for (const chunk of chunks) {
    const r = consumeTextForDelta(chunk, state)
    state = r.state
    visible += r.visible
  }
  return { visible, finalState: state }
}

describe('consumeTextForDelta — workflow_proposal suppression', () => {
  it('passes through normal text unchanged when no tag appears', () => {
    const { visible, finalState } = runChunks([
      'Here is some thinking. ',
      'No proposal in this response.',
    ])
    // The full text is yielded; final tail buffer holds at most 18 chars
    // (OPEN_TAG.length - 1) — those are pending-flush.
    expect(visible + finalState.tail).toBe('Here is some thinking. No proposal in this response.')
    expect(finalState.suppressing).toBe(false)
  })

  it('suppresses everything from <workflow_proposal> onward (single chunk)', () => {
    const { visible, finalState } = runChunks([
      'Here is the plan: <workflow_proposal>{"steps":[]}</workflow_proposal>',
    ])
    expect(visible).toBe('Here is the plan: ')
    expect(finalState.suppressing).toBe(true)
  })

  it('suppresses across chunks when tag splits at the boundary', () => {
    // 19 chars in OPEN_TAG; split right in the middle.
    const { visible, finalState } = runChunks([
      'Here is the plan: <workflow',
      '_proposal>{"steps":[]}</workflow_proposal>',
    ])
    // First chunk's "<workflow" is held in tail until second chunk completes
    // the tag. Visible prefix is "Here is the plan: ".
    expect(visible).toBe('Here is the plan: ')
    expect(finalState.suppressing).toBe(true)
  })

  it('suppresses across many small chunks (one char at a time)', () => {
    const message = 'Here. <workflow_proposal>{"a":1}</workflow_proposal> done.'
    const chunks = message.split('') // 1-char chunks — extreme split case
    const { visible, finalState } = runChunks(chunks)
    expect(visible).toBe('Here. ')
    expect(finalState.suppressing).toBe(true)
  })

  it('does not start suppressing on a partial tag that never completes', () => {
    // Model writes "<workflow" but never closes — could be a partial token
    // at end of stream, or a false positive in non-proposal text.
    const { visible, finalState } = runChunks([
      'Mentioning <workflow not the tag',
    ])
    // The tail-buffer holds the trailing 18 chars; the rest is yielded.
    // Combined with the tail it should be the full input.
    expect(visible + finalState.tail).toBe('Mentioning <workflow not the tag')
    expect(finalState.suppressing).toBe(false)
  })

  it('drops the tail when suppression engages — XML never reaches output', () => {
    const { visible } = runChunks([
      'Here: <workflow_proposal>',
      '{"title":"Plan A","steps":[{"a":1}]}',
      '</workflow_proposal>',
    ])
    expect(visible).toBe('Here: ')
    expect(visible).not.toContain('<workflow_proposal>')
    expect(visible).not.toContain('</workflow_proposal>')
    expect(visible).not.toContain('Plan A')
  })

  it('suppression persists across subsequent chunks once engaged', () => {
    const { visible, finalState } = runChunks([
      '<workflow_proposal>',
      'json content here',
      'more json content',
      '</workflow_proposal>',
      'and even text after the close tag is also suppressed in V1',
    ])
    expect(visible).toBe('')
    expect(finalState.suppressing).toBe(true)
  })

  it('handles whitespace and punctuation immediately before the tag', () => {
    const { visible } = runChunks(['Here is the workflow:\n\n<workflow_proposal>...</workflow_proposal>'])
    expect(visible).toBe('Here is the workflow:\n\n')
  })

  it('resets cleanly when freshSuppressionState() is used between iterations', () => {
    // Iteration 1 — opens suppression
    const r1 = runChunks(['<workflow_proposal>x</workflow_proposal>'])
    expect(r1.finalState.suppressing).toBe(true)

    // Iteration 2 — fresh state, normal text passes through
    const r2 = runChunks(['Normal text in next iteration.'])
    expect(r2.visible + r2.finalState.tail).toBe('Normal text in next iteration.')
    expect(r2.finalState.suppressing).toBe(false)
  })
})
