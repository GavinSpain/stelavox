// Phase 3 — autosave timing helpers.
// Spec: stelavox_phase3_test_plan_v1_0.md §1.4

import type { Page, Request } from '@playwright/test'

export const DEBOUNCE_MS = 1500
export const DEBOUNCE_TOLERANCE_MS = 300

// Waits for the next PATCH /api/nodes/[nodeId] (excluding /move) and
// returns its parsed body and the response.
export async function waitForPatch(
  page: Page,
  nodeId: string,
  timeout = 5000,
): Promise<{ body: Record<string, unknown>; status: number; responseBody: unknown }> {
  const req: Request = await page.waitForRequest(
    r =>
      r.method() === 'PATCH' &&
      r.url().includes(`/api/nodes/${nodeId}`) &&
      !r.url().endsWith('/move'),
    { timeout },
  )
  let body: Record<string, unknown> = {}
  try { body = JSON.parse(req.postData() ?? '{}') } catch { /* empty */ }
  const res = await req.response()
  let responseBody: unknown = null
  try { responseBody = await res?.json() } catch { /* empty */ }
  return { body, status: res?.status() ?? 0, responseBody }
}

// Asserts that no PATCH fires for `nodeId` within `windowMs` of now.
export async function expectNoPatchWithin(
  page: Page,
  nodeId: string,
  windowMs: number,
): Promise<void> {
  let fired = false
  const handler = (r: Request) => {
    if (
      r.method() === 'PATCH' &&
      r.url().includes(`/api/nodes/${nodeId}`) &&
      !r.url().endsWith('/move')
    ) {
      fired = true
    }
  }
  page.on('request', handler)
  await new Promise(r => setTimeout(r, windowMs))
  page.off('request', handler)
  if (fired) throw new Error(`Unexpected PATCH for node ${nodeId} fired within ${windowMs}ms`)
}
