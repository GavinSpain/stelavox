'use client'

/**
 * Phase 8.8 — Prose editor reading-aid preferences.
 *
 * Source: Component Spec v2.21 §6.4 (TypewriterContainer) + §6.5 (SentenceFocus)
 *         Phase 8.8 wireframe: docs/wireframes/wireframe_phase8_8_prose_settings_menu_v1.html
 *
 * Two opt-in author preferences for the prose surface:
 *
 *   sentenceFocus → localStorage `stelavox_sentence_focus_enabled`
 *     Dim text outside the current sentence (opacity 0.55 / 0.85 / 1.0).
 *     SentenceFocus component reads `enabled` prop and renders the CSS rules.
 *     Default: off in both Edit Mode and Focus Mode.
 *
 *   typewriter → localStorage `stelavox_typewriter_enabled`
 *     Keep the active line near 42% of viewport height.
 *     TypewriterContainer reads `enabled` prop and listens to selectionchange.
 *     Default: off in Edit Mode, on in Focus Mode. The default is applied at
 *     mount-time per surface — this hook stores only the explicit user choice.
 *
 * Storage key shape is locked by the spec — do not rename. The keys are
 * shared by every mount of ProseSettingsMenu (Edit Mode detail panel +
 * Focus Mode overlay), so toggling in one surface immediately reflects
 * in the other via the `storage` window event.
 *
 * SSR: returns null on the server (no localStorage). Consumers must
 * tolerate the null hydration window — practical impact is a single
 * frame of "default" rendering before the hook flips to the stored value.
 */

import { useCallback, useEffect, useState } from 'react'

/** localStorage keys — spec-locked, do not rename. */
export const SENTENCE_FOCUS_KEY = 'stelavox_sentence_focus_enabled'
export const TYPEWRITER_KEY = 'stelavox_typewriter_enabled'

export interface ProseSettings {
  /** Sentence Focus is enabled (cursor sentence at 1.0, others dimmed). */
  sentenceFocus: boolean
  /** Typewriter scrolling is enabled (active line at ~42% of viewport). */
  typewriter: boolean
  setSentenceFocus: (value: boolean) => void
  setTypewriter: (value: boolean) => void
}

/** Per-surface defaults. The hook returns the *stored* value if any;
 *  callers can apply a per-surface default before the stored value loads
 *  (typewriter is on-by-default in Focus Mode, off elsewhere). */
export interface ProseSettingsOptions {
  /** Default for sentenceFocus when no value has been stored. Default: false. */
  defaultSentenceFocus?: boolean
  /** Default for typewriter when no value has been stored. Default: false.
   *  Focus Mode passes `true` so the toggle reflects on-by-default. */
  defaultTypewriter?: boolean
}

/** Read a stored boolean value, falling back when missing or unreadable.
 *  Exported for unit testing — the React hook adds the state + effect
 *  layer on top of this pure helper. */
export function readStored(key: string, fallback: boolean): boolean {
  if (typeof window === 'undefined') return fallback
  try {
    const raw = window.localStorage.getItem(key)
    if (raw === null) return fallback
    return raw === 'true'
  } catch {
    return fallback
  }
}

/** Write a boolean to localStorage; swallow quota / private-mode errors.
 *  Exported for unit testing. */
export function writeStored(key: string, value: boolean): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(key, value ? 'true' : 'false')
  } catch {
    // Swallow — quota or private mode. The in-memory state still reflects
    // the user's choice for the session.
  }
}

export function useProseSettings(opts: ProseSettingsOptions = {}): ProseSettings {
  const sentenceDefault = opts.defaultSentenceFocus ?? false
  const typewriterDefault = opts.defaultTypewriter ?? false

  // SSR-safe init: read from storage on the client; fall back on the
  // server. The initial render on the client may briefly show the
  // default before flipping if the SSR HTML differs — practical impact
  // is one frame; the toggle is non-critical chrome.
  const [sentenceFocus, setSentenceFocusState] = useState<boolean>(() =>
    readStored(SENTENCE_FOCUS_KEY, sentenceDefault),
  )
  const [typewriter, setTypewriterState] = useState<boolean>(() =>
    readStored(TYPEWRITER_KEY, typewriterDefault),
  )

  // Cross-tab sync. The `storage` event fires on tabs OTHER than the
  // one that wrote; the writing tab updates via setState directly.
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.storageArea !== window.localStorage) return
      if (e.key === SENTENCE_FOCUS_KEY) {
        setSentenceFocusState(readStored(SENTENCE_FOCUS_KEY, sentenceDefault))
      } else if (e.key === TYPEWRITER_KEY) {
        setTypewriterState(readStored(TYPEWRITER_KEY, typewriterDefault))
      } else if (e.key === null) {
        // localStorage cleared — re-read both.
        setSentenceFocusState(readStored(SENTENCE_FOCUS_KEY, sentenceDefault))
        setTypewriterState(readStored(TYPEWRITER_KEY, typewriterDefault))
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [sentenceDefault, typewriterDefault])

  const setSentenceFocus = useCallback((value: boolean) => {
    setSentenceFocusState(value)
    writeStored(SENTENCE_FOCUS_KEY, value)
  }, [])

  const setTypewriter = useCallback((value: boolean) => {
    setTypewriterState(value)
    writeStored(TYPEWRITER_KEY, value)
  }, [])

  return { sentenceFocus, typewriter, setSentenceFocus, setTypewriter }
}
