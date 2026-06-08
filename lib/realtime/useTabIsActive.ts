'use client'

// Phase 8.5b B.6 — Idle-tab activity tracker.
//
// Returns true while the tab is "active" — currently meaning the tab
// either has document.visibilityState === 'visible' OR has had visibility
// in the last IDLE_THRESHOLD_MS. When the tab transitions to hidden, a
// timer starts; if visibility returns before it elapses, the timer
// resets. When the timer fires, the hook returns false, which the
// ChannelGate uses to unmount UserRealtimeChannel and close the
// Supabase Realtime channel — freeing the slot in the 500-cap count.
//
// Refs: docs/stelavox_document_load_architecture_v1_0.md §5.7
//       lib/realtime/ChannelGate.tsx (the consumer)
//       lib/realtime/useUserChannel.ts (what gets gated)
//
// Threshold rationale: 10 minutes is long enough that brief tab
// switches (alt-tab to look something up) don't trip the timer, and
// short enough that lunch breaks are caught. Tunable to platform_config
// if metrics show wanting to tighten or loosen.
//
// Signal scope: visibility only in v1. Visible-but-no-input is NOT
// in scope — a visible tab is treated as active regardless of input.
// Adding input-tracking as a secondary close signal is deferred.

import { useEffect, useState } from 'react'

/** 10 minutes. Hardcoded in v1; tunable via platform_config later. */
export const IDLE_THRESHOLD_MS = 10 * 60 * 1000

/**
 * Pure idle-tracker state machine. Factored out for unit testing — the
 * React hook below is a thin wiring layer that hooks this up to
 * `document.visibilityState` and React state.
 *
 * Contract:
 *   - call `notify(visible)` whenever the visibility state changes.
 *   - if `visible=true`, fires `setActive(true)` synchronously and
 *     cancels any pending close.
 *   - if `visible=false`, starts (or resets) an `idleMs` timer. When it
 *     fires, calls `setActive(false)`. A subsequent `notify(true)`
 *     cancels the timer.
 *   - call `dispose()` to cancel any pending timer.
 *
 * The tracker is idempotent on `notify` — calling `notify(false)` twice
 * in a row resets the timer rather than stacking timers.
 */
export interface IdleTracker {
  notify(visible: boolean): void
  dispose(): void
}

export function makeIdleTracker(opts: {
  idleMs: number
  setActive: (active: boolean) => void
  setTimeout?: typeof globalThis.setTimeout
  clearTimeout?: typeof globalThis.clearTimeout
}): IdleTracker {
  const setT = opts.setTimeout ?? globalThis.setTimeout
  const clearT = opts.clearTimeout ?? globalThis.clearTimeout
  let timer: ReturnType<typeof globalThis.setTimeout> | null = null

  const clearTimer = () => {
    if (timer !== null) {
      clearT(timer)
      timer = null
    }
  }

  return {
    notify(visible: boolean) {
      clearTimer()
      if (visible) {
        opts.setActive(true)
      } else {
        timer = setT(() => {
          timer = null
          opts.setActive(false)
        }, opts.idleMs)
      }
    },
    dispose() {
      clearTimer()
    },
  }
}

/**
 * Returns true while the tab is considered active. Flips to false when
 * the tab has been continuously hidden for `idleMs`. Flips back to true
 * on visibility return.
 *
 * Server-rendered initial value is `true` so first paint mounts the
 * channel (the user just opened the page, so the tab is by definition
 * active).
 *
 * `idleMs` parameter is for unit-test injection; production callers
 * should rely on the default `IDLE_THRESHOLD_MS`.
 */
export function useTabIsActive(idleMs: number = IDLE_THRESHOLD_MS): boolean {
  const [active, setActive] = useState<boolean>(true)

  useEffect(() => {
    if (typeof document === 'undefined') return

    const tracker = makeIdleTracker({ idleMs, setActive })

    const onVisibilityChange = () => {
      tracker.notify(document.visibilityState === 'visible')
    }

    document.addEventListener('visibilitychange', onVisibilityChange)

    // Initial state: if the tab was hidden when the hook mounted (e.g.
    // user opened the page in a backgrounded tab), schedule the close
    // immediately rather than waiting for the next visibility flip.
    if (document.visibilityState !== 'visible') {
      tracker.notify(false)
    }

    return () => {
      tracker.dispose()
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [idleMs])

  return active
}
