// Phase 3 — reduced-motion helpers.
// Spec: stelavox_phase3_test_plan_v1_0.md §1.4

import type { Page } from '@playwright/test'

export async function withReducedMotion<T>(
  page: Page,
  fn: () => Promise<T>,
): Promise<T> {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  try {
    return await fn()
  } finally {
    await page.emulateMedia({ reducedMotion: 'no-preference' })
  }
}

// Captures the start timestamp of a CSS transition on a target element by
// polling getComputedStyle for opacity changes. Returns ms since `started`.
export async function timeOpacityChange(
  page: Page,
  selector: string,
  startedAt: number,
  threshold: number,  // opacity at which we consider it "started transitioning"
  timeout = 1500,
): Promise<number> {
  const deadline = startedAt + timeout
  while (Date.now() < deadline) {
    const o = await page.evaluate((sel: string) => {
      const el = document.querySelector(sel)
      if (!el) return NaN
      return parseFloat(getComputedStyle(el).opacity)
    }, selector)
    if (Number.isFinite(o) && Math.abs(o - 1) > threshold) {
      return Date.now() - startedAt
    }
    await new Promise(r => setTimeout(r, 8))
  }
  return -1
}
