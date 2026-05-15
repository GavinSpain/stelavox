/**
 * V1.x-D.2 — useAiChangedFlag + lifecycleFromJobStatus unit tests.
 *
 * Source: Component Spec §17.8 · wireframe_node_row_v2_badges_v1.html.
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest'

import {
  lifecycleFromJobStatus,
} from '@/components/tree/NodeLifecycleBadge'
import { markNodeAsViewed } from '@/lib/hooks/useAiChangedFlag'

// localStorage shim — vitest in jsdom provides it; if running in node,
// stub a minimal Map-backed version.
function ensureLocalStorage() {
  if (typeof globalThis.localStorage === 'undefined') {
    const store = new Map<string, string>()
    const shim = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v)
      },
      removeItem: (k: string) => {
        store.delete(k)
      },
      clear: () => store.clear(),
      key: (i: number) => Array.from(store.keys())[i] ?? null,
      get length() {
        return store.size
      },
    }
    ;(globalThis as unknown as { localStorage: Storage }).localStorage =
      shim as unknown as Storage
    if (typeof (globalThis as unknown as { window?: unknown }).window === 'undefined') {
      ;(globalThis as unknown as { window: { localStorage: Storage } }).window = {
        localStorage: shim as unknown as Storage,
      }
    }
  }
}

describe('V1.x-D.2 — lifecycleFromJobStatus', () => {
  it('maps pending to queued', () => {
    expect(lifecycleFromJobStatus('pending')).toBe('queued')
  })
  it('maps running to running', () => {
    expect(lifecycleFromJobStatus('running')).toBe('running')
  })
  it('maps completed to completed-pending-review', () => {
    expect(lifecycleFromJobStatus('completed')).toBe('completed-pending-review')
  })
  it('maps terminal statuses to null', () => {
    expect(lifecycleFromJobStatus('accepted')).toBeNull()
    expect(lifecycleFromJobStatus('dismissed')).toBeNull()
    expect(lifecycleFromJobStatus('cancelled')).toBeNull()
    expect(lifecycleFromJobStatus('failed')).toBeNull()
  })
  it('maps undefined to null', () => {
    expect(lifecycleFromJobStatus(undefined)).toBeNull()
  })
})

describe('V1.x-D.2 — markNodeAsViewed localStorage behaviour', () => {
  beforeEach(() => {
    ensureLocalStorage()
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.clear()
    } else if (typeof globalThis.localStorage !== 'undefined') {
      ;(globalThis.localStorage as Storage).clear?.()
    }
  })
  afterEach(() => {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.clear()
    }
  })

  it('writes a node-viewed entry to localStorage', () => {
    markNodeAsViewed('node-abc')
    const stored = (
      typeof window !== 'undefined'
        ? window.localStorage
        : (globalThis.localStorage as Storage | undefined)
    )?.getItem('node-viewed:node-abc')
    expect(stored).not.toBeNull()
    expect(stored).toMatch(/^\d{4}-\d{2}-\d{2}T/)  // ISO timestamp
  })

  it('subsequent calls overwrite the timestamp', async () => {
    markNodeAsViewed('node-abc')
    const first = (
      typeof window !== 'undefined'
        ? window.localStorage
        : (globalThis.localStorage as Storage | undefined)
    )?.getItem('node-viewed:node-abc')
    await new Promise((r) => setTimeout(r, 5))
    markNodeAsViewed('node-abc')
    const second = (
      typeof window !== 'undefined'
        ? window.localStorage
        : (globalThis.localStorage as Storage | undefined)
    )?.getItem('node-viewed:node-abc')
    expect(second).not.toBe(first)
  })

  it('different node ids get distinct entries (separate keys)', () => {
    markNodeAsViewed('node-a')
    markNodeAsViewed('node-b')
    const ls =
      typeof window !== 'undefined'
        ? window.localStorage
        : (globalThis.localStorage as Storage | undefined)
    // Both entries exist under their own keys; whether the timestamps
    // match (same millisecond) is irrelevant — the key separation is
    // what matters.
    expect(ls?.getItem('node-viewed:node-a')).not.toBeNull()
    expect(ls?.getItem('node-viewed:node-b')).not.toBeNull()
    // Clearing one doesn't clear the other.
    ls?.removeItem('node-viewed:node-a')
    expect(ls?.getItem('node-viewed:node-a')).toBeNull()
    expect(ls?.getItem('node-viewed:node-b')).not.toBeNull()
  })
})
