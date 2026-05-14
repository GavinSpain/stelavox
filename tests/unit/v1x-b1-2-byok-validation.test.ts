/**
 * V1.x-B.1.2 — validateAnthropicKey unit tests.
 *
 * Mocks global fetch + getConfigString. Verifies:
 *   - 200 OK → {valid: true}
 *   - 401 / 403 → {valid: false, reason: 'key_rejected', status}
 *   - other 4xx with structured error message → {valid: false, reason}
 *   - network failure throws ValidationInfraError (caller can distinguish
 *     "key bad" from "validation infra broken")
 *   - empty / too-short key → {valid: false, reason: 'key_too_short'}
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/config/platform-config', () => ({
  getConfigString: vi.fn().mockResolvedValue('claude-haiku-4-5-20251001'),
}))

import { validateAnthropicKey, ValidationInfraError } from '@/lib/byok/validateAgainstAnthropic'

describe('validateAnthropicKey', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns valid:true on Anthropic 200', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'msg', content: [] }), { status: 200 })),
    )
    const r = await validateAnthropicKey('sk-ant-test-1234')
    expect(r.valid).toBe(true)
  })

  it('returns valid:false reason key_rejected on 401', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: 'auth' } }), { status: 401 })),
    )
    const r = await validateAnthropicKey('sk-ant-bad-1234')
    expect(r.valid).toBe(false)
    if (!r.valid) {
      expect(r.reason).toBe('key_rejected')
      expect(r.status).toBe(401)
    }
  })

  it('returns valid:false reason key_rejected on 403', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: 'forbidden' } }), { status: 403 })),
    )
    const r = await validateAnthropicKey('sk-ant-forbidden-1234')
    expect(r.valid).toBe(false)
    if (!r.valid) expect(r.reason).toBe('key_rejected')
  })

  it('returns valid:false with Anthropic error message on other 4xx', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { message: 'rate_limit_exceeded' } }), { status: 429 }),
      ),
    )
    const r = await validateAnthropicKey('sk-ant-rate-1234')
    expect(r.valid).toBe(false)
    if (!r.valid) expect(r.reason).toBe('rate_limit_exceeded')
  })

  it('throws ValidationInfraError on network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')))
    await expect(validateAnthropicKey('sk-ant-test-1234')).rejects.toBeInstanceOf(ValidationInfraError)
  })

  it('rejects empty / too-short key without calling Anthropic', async () => {
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    const r1 = await validateAnthropicKey('')
    expect(r1.valid).toBe(false)
    if (!r1.valid) expect(r1.reason).toBe('key_too_short')
    const r2 = await validateAnthropicKey('short')
    expect(r2.valid).toBe(false)
    expect(f).not.toHaveBeenCalled()
  })
})
