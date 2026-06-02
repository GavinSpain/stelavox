// Phase 8.01.C T-9 — parseMessageProposals planText extraction.

import { describe, expect, it } from 'vitest'

import { parseMessageProposals } from '@/lib/director/parse-message-proposals'

describe('parseMessageProposals — planText extraction (T-1)', () => {
  it('extracts the body of a single <plan> block', () => {
    const content = 'Hello.\n<plan>step 1\nstep 2</plan>\nDone.'
    const { planText, cleanedContent } = parseMessageProposals(content)
    expect(planText).toBe('step 1\nstep 2')
    // cleanedContent still strips the plan block.
    expect(cleanedContent).not.toContain('<plan>')
    expect(cleanedContent).toContain('Hello.')
    expect(cleanedContent).toContain('Done.')
  })

  it('joins multiple <plan> blocks with a blank line', () => {
    const content = '<plan>A</plan>\n<plan>B</plan>'
    const { planText } = parseMessageProposals(content)
    expect(planText).toBe('A\n\nB')
  })

  it('returns null when no <plan> tag is present', () => {
    const content = 'Just prose. No plan here.'
    const { planText } = parseMessageProposals(content)
    expect(planText).toBeNull()
  })

  it('tolerant fallback: open <plan> without close captures partial body', () => {
    const content = 'Hi.\n<plan>truncated mid-thought'
    const { planText, cleanedContent } = parseMessageProposals(content)
    expect(planText).toBe('truncated mid-thought')
    expect(cleanedContent).not.toContain('<plan>')
  })

  it('empty plan body still triggers extraction but produces null (no useful text)', () => {
    const content = 'Hi.\n<plan></plan>'
    const { planText, cleanedContent } = parseMessageProposals(content)
    // Empty body → not pushed to planBodies → planText null.
    expect(planText).toBeNull()
    expect(cleanedContent).not.toContain('<plan>')
  })
})
