// Phase 3 — Visual / opacity-state helpers.
// Spec: stelavox_phase3_test_plan_v1_0.md §1.4

import type { Locator } from '@playwright/test'

export const FOCUS_MODE_TRANSITION_MS  = 280
export const WORD_COUNT_FADE_MS        = 800
export const SENTENCE_FOCUS_MS         = 200
export const ESC_HINT_FADE_DELAY_MS    = 5000
export const TIMING_TOLERANCE_MS       = 50

// Polls the locator's computed opacity until it's within [low, high] or
// timeout expires. Throws with the last-observed value on failure.
export async function expectOpacityWithin(
  locator: Locator,
  low: number,
  high: number,
  timeout = 2000,
): Promise<void> {
  const start = Date.now()
  let last = NaN
  while (Date.now() - start < timeout) {
    last = await locator.evaluate(
      (node: Element) => parseFloat(window.getComputedStyle(node).opacity),
    )
    if (last >= low && last <= high) return
    await new Promise(r => setTimeout(r, 50))
  }
  throw new Error(`Expected opacity ∈ [${low}, ${high}], got ${last} after ${timeout}ms`)
}

export async function readOpacity(locator: Locator): Promise<number> {
  return locator.evaluate(
    (node: Element) => parseFloat(window.getComputedStyle(node).opacity),
  )
}
