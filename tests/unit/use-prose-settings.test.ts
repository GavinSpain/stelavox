/**
 * Phase 8.8 unit — useProseSettings storage helpers.
 *
 * The hook itself wraps two pure helpers (readStored / writeStored) plus
 * React state + a `storage` event listener for cross-tab sync. Testing
 * the helpers directly covers the round-trip + default + edge cases
 * without needing a DOM or React renderer (codebase convention is
 * renderToString-only — see tests/unit/dashboard-component-render.test.ts).
 *
 * The React hook's storage-event behaviour is exercised at integration
 * time via the manual verification path in the wireframe; this file
 * pins the contract of the pure functions that the hook delegates to.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  SENTENCE_FOCUS_KEY,
  TYPEWRITER_KEY,
  readStored,
  writeStored,
} from '@/lib/hooks/useProseSettings'

// Pure helpers go through `window.localStorage`. Vitest's node env has
// no DOM but we can fabricate one. The simplest shim is to attach a
// minimal localStorage to globalThis.window for the duration of these
// tests.
function setupLocalStorage(): Storage {
  const store = new Map<string, string>()
  const stub: Storage = {
    get length() { return store.size },
    clear: () => store.clear(),
    getItem: (k) => (store.has(k) ? store.get(k)! : null),
    key: (i) => Array.from(store.keys())[i] ?? null,
    removeItem: (k) => { store.delete(k) },
    setItem: (k, v) => { store.set(k, String(v)) },
  }
  ;(globalThis as { window?: { localStorage: Storage } }).window = { localStorage: stub }
  return stub
}

describe('useProseSettings — storage helpers', () => {
  let storage: Storage

  beforeEach(() => {
    storage = setupLocalStorage()
  })

  afterEach(() => {
    storage.clear()
    delete (globalThis as { window?: unknown }).window
  })

  it('returns the fallback when the key is absent', () => {
    expect(readStored(SENTENCE_FOCUS_KEY, false)).toBe(false)
    expect(readStored(SENTENCE_FOCUS_KEY, true)).toBe(true)
    expect(readStored(TYPEWRITER_KEY, false)).toBe(false)
    expect(readStored(TYPEWRITER_KEY, true)).toBe(true)
  })

  it('returns true when stored as the string "true"', () => {
    storage.setItem(SENTENCE_FOCUS_KEY, 'true')
    expect(readStored(SENTENCE_FOCUS_KEY, false)).toBe(true)
  })

  it('returns false when stored as the string "false"', () => {
    storage.setItem(TYPEWRITER_KEY, 'false')
    expect(readStored(TYPEWRITER_KEY, true)).toBe(false)
  })

  it('round-trips through write + read', () => {
    writeStored(SENTENCE_FOCUS_KEY, true)
    expect(storage.getItem(SENTENCE_FOCUS_KEY)).toBe('true')
    expect(readStored(SENTENCE_FOCUS_KEY, false)).toBe(true)

    writeStored(SENTENCE_FOCUS_KEY, false)
    expect(storage.getItem(SENTENCE_FOCUS_KEY)).toBe('false')
    expect(readStored(SENTENCE_FOCUS_KEY, true)).toBe(false)

    writeStored(TYPEWRITER_KEY, true)
    expect(storage.getItem(TYPEWRITER_KEY)).toBe('true')
  })

  it('returns the fallback on SSR (no window)', () => {
    delete (globalThis as { window?: unknown }).window
    expect(readStored(SENTENCE_FOCUS_KEY, false)).toBe(false)
    expect(readStored(SENTENCE_FOCUS_KEY, true)).toBe(true)
  })

  it('writeStored is a no-op on SSR (no window)', () => {
    delete (globalThis as { window?: unknown }).window
    // Should not throw.
    expect(() => writeStored(SENTENCE_FOCUS_KEY, true)).not.toThrow()
  })

  it('swallows getItem exceptions and returns the fallback', () => {
    const throwingStorage = {
      ...storage,
      getItem: vi.fn(() => { throw new Error('private mode') }),
    } as unknown as Storage
    ;(globalThis as { window?: { localStorage: Storage } }).window = { localStorage: throwingStorage }
    expect(readStored(SENTENCE_FOCUS_KEY, false)).toBe(false)
    expect(readStored(TYPEWRITER_KEY, true)).toBe(true)
  })

  it('swallows setItem exceptions silently', () => {
    const throwingStorage = {
      ...storage,
      setItem: vi.fn(() => { throw new Error('quota exceeded') }),
    } as unknown as Storage
    ;(globalThis as { window?: { localStorage: Storage } }).window = { localStorage: throwingStorage }
    expect(() => writeStored(SENTENCE_FOCUS_KEY, true)).not.toThrow()
  })

  it('exposes the spec-locked storage keys verbatim', () => {
    // The key strings are part of the public contract — SentenceFocus,
    // TypewriterContainer, and FocusMode all reference these literals.
    // Renaming would silently invalidate users' persisted preferences.
    expect(SENTENCE_FOCUS_KEY).toBe('stelavox_sentence_focus_enabled')
    expect(TYPEWRITER_KEY).toBe('stelavox_typewriter_enabled')
  })
})
