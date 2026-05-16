/**
 * V1.x-F.2 — failure-message templates + interpolation.
 *
 * Source: stelavox_v1x_f_build_checklist_v1_1.md §5 F.2 +
 *         lib/ui/failureMessages.ts (server) +
 *         lib/ui/failureMessageInterpolate.ts (client-safe helper).
 *
 * Templates live in platform_config (M-147). The interpolation
 * invariant — `{token}` occurrences replace literally; missing tokens
 * pass through — is tested on the client-safe helper here. The
 * server-only fetch path is covered by Playwright at the route level.
 */

import { describe, expect, it } from 'vitest'

import { interpolateFailureMessage } from '@/lib/ui/failureMessageInterpolate'

describe('interpolateFailureMessage (V1.x-F.2)', () => {
  it('substitutes a single {token} with the provided value', () => {
    expect(
      interpolateFailureMessage('Job {job_id} failed', { job_id: 'abc-123' }),
    ).toBe('Job abc-123 failed')
  })

  it('substitutes multiple {tokens} in one template', () => {
    expect(
      interpolateFailureMessage(
        'Attempt {attempt} of {max_attempts}',
        { attempt: 2, max_attempts: 3 },
      ),
    ).toBe('Attempt 2 of 3')
  })

  it('substitutes the same token repeated', () => {
    expect(
      interpolateFailureMessage('{x}/{x}', { x: 'a' }),
    ).toBe('a/a')
  })

  it('leaves unrecognised {tokens} in place', () => {
    expect(
      interpolateFailureMessage('Job {job_id} — {missing}', { job_id: 'abc' }),
    ).toBe('Job abc — {missing}')
  })

  it('coerces numeric values to strings', () => {
    expect(
      interpolateFailureMessage('Pause {seconds}s', { seconds: 30 }),
    ).toBe('Pause 30s')
  })

  it('returns the template unchanged when no vars are provided', () => {
    expect(
      interpolateFailureMessage('static message no tokens', {}),
    ).toBe('static message no tokens')
  })

  it('matches the M-147 Class A template shape', () => {
    const template = 'Provider returned a transient error · attempt {attempt} of {max_attempts}'
    expect(
      interpolateFailureMessage(template, { attempt: 2, max_attempts: 3 }),
    ).toBe('Provider returned a transient error · attempt 2 of 3')
  })

  it('matches the M-147 Class D template shape with multiple tokens', () => {
    const template =
      "The {failure_class} step for '{node_name}' was rejected: {reason}. The job is marked failed; the node is unchanged."
    expect(
      interpolateFailureMessage(template, {
        failure_class: 'synthesise',
        node_name: 'Bridge Crossing',
        reason: 'atom-size guardrail exceeded',
      }),
    ).toContain("'Bridge Crossing'")
    expect(
      interpolateFailureMessage(template, {
        failure_class: 'synthesise',
        node_name: 'Bridge Crossing',
        reason: 'atom-size guardrail exceeded',
      }),
    ).toContain('atom-size guardrail exceeded')
  })

  it('matches the M-147 Class E template shape', () => {
    const template = "Job {job_id} failed with a hard system error."
    expect(
      interpolateFailureMessage(template, { job_id: 'd4a91b' }),
    ).toBe('Job d4a91b failed with a hard system error.')
  })
})
