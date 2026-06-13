'use client'

/**
 * Phase 9.E (DR-020) — client hook fetching the failure-message bundle.
 *
 * Module-level cache: the bundle is fetched once per browser session
 * (the templates change rarely, admin-only). All FailureSurface
 * instances share the cached promise.
 */

import { useEffect, useState } from 'react'

export interface FailureMessageBundle {
  class_a_template: string
  class_c_template: string
  class_c_min_pause_seconds: number
  class_d_template: string
  class_e_template: string
  class_e_admin_contact: string
  injection_blocked_message: string
}

let cachedBundle: FailureMessageBundle | null = null
let inflight: Promise<FailureMessageBundle | null> | null = null

async function fetchBundle(): Promise<FailureMessageBundle | null> {
  if (cachedBundle) return cachedBundle
  if (inflight) return inflight
  inflight = (async () => {
    try {
      const res = await fetch('/api/failure-messages')
      if (!res.ok) return null
      const json = (await res.json()) as FailureMessageBundle
      cachedBundle = json
      return json
    } catch {
      return null
    } finally {
      inflight = null
    }
  })()
  return inflight
}

export function useFailureMessages(): FailureMessageBundle | null {
  const [bundle, setBundle] = useState<FailureMessageBundle | null>(cachedBundle)
  useEffect(() => {
    if (bundle) return
    let active = true
    void fetchBundle().then((b) => {
      if (active && b) setBundle(b)
    })
    return () => {
      active = false
    }
  }, [bundle])
  return bundle
}

/** Test-only: reset the module cache between cases. */
export function __resetFailureMessagesCache(): void {
  cachedBundle = null
  inflight = null
}
