// B3.5 — round-3 audit F-201.
//
// useAgentJobsRealtime wired its supabase real-time subscription with a
// bare `.subscribe()` call — no callback. If the WebSocket failed
// (network drop, Vercel WS limit, transient broker failure), the
// subscription dropped silently. UI showed no progress on jobs because
// no events arrived; user couldn't tell the difference between "nothing
// happening" and "live updates broken".
//
// Fix: wire the `subscribe((status, err) => {...})` callback. On
// CHANNEL_ERROR / TIMED_OUT / CLOSED, console.error and set a
// `realtimeError` field on the store. On SUBSCRIBED, clear it. The
// store field can drive a "live updates unavailable" banner in a future
// Phase 7 polish — Phase 3's job is to stop the silence.
//
// The subscription-status handler is exported as `handleRealtimeStatus`
// from the hook module so this test can exercise it directly without
// having to render the hook.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

beforeEach(() => {
  vi.resetModules()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('B3.5 — F-201: useAgentJobsRealtime subscription-status handler', () => {
  it('sets realtimeError on CHANNEL_ERROR', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const mod = await import('@/lib/hooks/useAgentJobsRealtime')

    mod.handleRealtimeStatus('CHANNEL_ERROR', new Error('broker dropped'))

    const state = mod.useAgentJobsErrorStore.getState()
    expect(state.realtimeError).toBeTruthy()
    expect(state.realtimeError).toMatch(/broker dropped|channel|error/i)
    expect(consoleErrorSpy).toHaveBeenCalled()
  })

  it('sets realtimeError on TIMED_OUT', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const mod = await import('@/lib/hooks/useAgentJobsRealtime')

    mod.handleRealtimeStatus('TIMED_OUT', undefined)

    expect(mod.useAgentJobsErrorStore.getState().realtimeError).toBeTruthy()
    expect(mod.useAgentJobsErrorStore.getState().realtimeError).toMatch(/time/i)
  })

  it('sets realtimeError on CLOSED', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const mod = await import('@/lib/hooks/useAgentJobsRealtime')

    mod.handleRealtimeStatus('CLOSED', undefined)

    expect(mod.useAgentJobsErrorStore.getState().realtimeError).toBeTruthy()
  })

  it('clears realtimeError on SUBSCRIBED', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const mod = await import('@/lib/hooks/useAgentJobsRealtime')

    // First trigger an error so the field is populated.
    mod.handleRealtimeStatus('CHANNEL_ERROR', new Error('blip'))
    expect(mod.useAgentJobsErrorStore.getState().realtimeError).toBeTruthy()

    // Then a successful subscribe should clear it.
    mod.handleRealtimeStatus('SUBSCRIBED', undefined)
    expect(mod.useAgentJobsErrorStore.getState().realtimeError).toBeNull()
  })
})
