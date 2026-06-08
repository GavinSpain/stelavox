/**
 * Phase 8.5b B.6 — Idle-tab tracker unit tests.
 *
 * Pins the state-machine contract of `makeIdleTracker`:
 *   - `notify(visible=false)` schedules the close after `idleMs`
 *   - `notify(visible=true)` cancels any pending close and reports active
 *   - rapid hidden/visible toggles don't stack timers
 *   - `dispose()` cancels any pending timer cleanly
 *   - the timer only fires once even if multiple hidden notifies arrive
 *
 * Refs: docs/stelavox_document_load_architecture_v1_0.md §5.7
 *       lib/realtime/useTabIsActive.ts (the SUT)
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

import { makeIdleTracker, IDLE_THRESHOLD_MS } from '@/lib/realtime/useTabIsActive'

describe('Phase 8.5b B.6 — makeIdleTracker state machine', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // ───────────────────────────────────────────────────────────────────
  // TC-8.5b-B6-01 — visible immediately fires setActive(true).
  // ───────────────────────────────────────────────────────────────────
  it('TC-8.5b-B6-01 — notify(true) reports active synchronously', () => {
    const setActive = vi.fn()
    const tracker = makeIdleTracker({ idleMs: 1000, setActive })

    tracker.notify(true)

    expect(setActive).toHaveBeenCalledWith(true)
    expect(setActive).toHaveBeenCalledTimes(1)
  })

  // ───────────────────────────────────────────────────────────────────
  // TC-8.5b-B6-02 — hidden does NOT fire setActive(false) before the
  // idle threshold elapses.
  // ───────────────────────────────────────────────────────────────────
  it('TC-8.5b-B6-02 — notify(false) does not fire setActive until idleMs elapses', () => {
    const setActive = vi.fn()
    const tracker = makeIdleTracker({ idleMs: 1000, setActive })

    tracker.notify(false)
    expect(setActive).not.toHaveBeenCalled()

    vi.advanceTimersByTime(999)
    expect(setActive).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(setActive).toHaveBeenCalledWith(false)
    expect(setActive).toHaveBeenCalledTimes(1)
  })

  // ───────────────────────────────────────────────────────────────────
  // TC-8.5b-B6-03 — visibility returning before threshold cancels the
  // close.
  // ───────────────────────────────────────────────────────────────────
  it('TC-8.5b-B6-03 — visibility return cancels the pending close', () => {
    const setActive = vi.fn()
    const tracker = makeIdleTracker({ idleMs: 1000, setActive })

    tracker.notify(false)
    vi.advanceTimersByTime(500)
    expect(setActive).not.toHaveBeenCalled()

    tracker.notify(true)
    expect(setActive).toHaveBeenCalledWith(true)

    // Advance well past the original timer's deadline — setActive(false)
    // must not fire.
    vi.advanceTimersByTime(2000)
    expect(setActive).toHaveBeenCalledTimes(1)
    expect(setActive).not.toHaveBeenCalledWith(false)
  })

  // ───────────────────────────────────────────────────────────────────
  // TC-8.5b-B6-04 — rapid hidden/visible toggles never stack timers.
  // Each new notify resets the previous one.
  // ───────────────────────────────────────────────────────────────────
  it('TC-8.5b-B6-04 — repeated notify(false) resets rather than stacks', () => {
    const setActive = vi.fn()
    const tracker = makeIdleTracker({ idleMs: 1000, setActive })

    tracker.notify(false)
    vi.advanceTimersByTime(500)
    tracker.notify(false)  // resets the timer
    vi.advanceTimersByTime(500)
    expect(setActive).not.toHaveBeenCalled()  // would have fired at 1000 if stacked

    vi.advanceTimersByTime(500)
    expect(setActive).toHaveBeenCalledWith(false)
    expect(setActive).toHaveBeenCalledTimes(1)
  })

  // ───────────────────────────────────────────────────────────────────
  // TC-8.5b-B6-05 — dispose() cancels any pending timer; setActive
  // never fires after dispose.
  // ───────────────────────────────────────────────────────────────────
  it('TC-8.5b-B6-05 — dispose cancels the pending timer', () => {
    const setActive = vi.fn()
    const tracker = makeIdleTracker({ idleMs: 1000, setActive })

    tracker.notify(false)
    vi.advanceTimersByTime(500)
    tracker.dispose()

    vi.advanceTimersByTime(2000)
    expect(setActive).not.toHaveBeenCalled()
  })

  // ───────────────────────────────────────────────────────────────────
  // TC-8.5b-B6-06 — alternating sequence: hidden → visible → hidden
  // schedules a fresh timer each hidden cycle.
  // ───────────────────────────────────────────────────────────────────
  it('TC-8.5b-B6-06 — fresh timer scheduled after visible interlude', () => {
    const setActive = vi.fn()
    const tracker = makeIdleTracker({ idleMs: 1000, setActive })

    tracker.notify(false)
    vi.advanceTimersByTime(900)
    tracker.notify(true)
    setActive.mockClear()

    // New hidden cycle — fresh 1000ms timer.
    tracker.notify(false)
    vi.advanceTimersByTime(999)
    expect(setActive).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(setActive).toHaveBeenCalledWith(false)
    expect(setActive).toHaveBeenCalledTimes(1)
  })

  // ───────────────────────────────────────────────────────────────────
  // TC-8.5b-B6-07 — dispose mid-active interval is safe (no-op).
  // ───────────────────────────────────────────────────────────────────
  it('TC-8.5b-B6-07 — dispose after notify(true) is a safe no-op', () => {
    const setActive = vi.fn()
    const tracker = makeIdleTracker({ idleMs: 1000, setActive })

    tracker.notify(true)
    tracker.dispose()

    vi.advanceTimersByTime(5000)
    expect(setActive).toHaveBeenCalledTimes(1)  // only the initial true
    expect(setActive).toHaveBeenCalledWith(true)
  })

  // ───────────────────────────────────────────────────────────────────
  // TC-8.5b-B6-08 — IDLE_THRESHOLD_MS is 10 minutes. Pins the contract.
  // ───────────────────────────────────────────────────────────────────
  it('TC-8.5b-B6-08 — IDLE_THRESHOLD_MS is exactly 10 minutes', () => {
    expect(IDLE_THRESHOLD_MS).toBe(10 * 60 * 1000)
  })
})
