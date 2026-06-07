'use client'

// Spec: stelavox_component_specification_v2_10.md v2.21 §6.5
//
// Phase 8.9 — full implementation (the Phase 3 stub becomes complete):
//
//   • Toggle host — Phase 8.8 ProseSettingsMenu writes the
//     `stelavox_sentence_focus_enabled` localStorage key via
//     useProseSettings. ProseEditor reads the same hook and either
//     mounts the SentenceFocus component (this file) and registers
//     the ProseMirror plugin, or doesn't.
//   • Sentence segmentation — Intl.Segmenter (locale default,
//     granularity: 'sentence') in lib/editor/sentence-focus-plugin.ts,
//     called per paragraph on every document or selection change.
//   • Span wrapping — implemented as ProseMirror inline decorations.
//     The plugin produces a [data-sentence] attribute on each
//     sentence span; this file installs the CSS that consumes it.
//   • Active / adjacent marking — the plugin sets [data-active="true"]
//     on the sentence containing the cursor, and [data-adjacent="true"]
//     on the immediate previous and next sentences (by global index).
//   • Selection restore — the selectionchange listener below toggles
//     [data-selecting="true"] on the focus root while the user has a
//     non-collapsed selection, restoring all text to 1.0 opacity.
//
// Deferred to Phase 8.11: prefers-reduced-motion collapse for the
// 200ms transition.
//
// 🔒 Behaviour contract — locked opacity values:
//   • Active sentence  → 1.00
//   • Adjacent (±1)    → 0.85
//   • All other text   → 0.55  (floor — below this, text reads
//                                 "disabled" rather than "backgrounded")
//   • During selection → all return to 1.00 until deselect

import { useEffect } from 'react'

interface SentenceFocusProps {
  enabled: boolean
}

const STYLE_ID = 'stelavox-sentence-focus-style'

function ensureStyle(enabled: boolean) {
  if (typeof document === 'undefined') return
  let el = document.getElementById(STYLE_ID) as HTMLStyleElement | null
  if (!enabled) {
    if (el) el.remove()
    return
  }
  if (!el) {
    el = document.createElement('style')
    el.id = STYLE_ID
    document.head.appendChild(el)
  }
  // Phase 8.11 — the @media block collapses the 200ms opacity
  // transition when the OS-level reduced-motion preference is set.
  // Opacity values themselves are unchanged; only the transition
  // animation disappears. Same approach the existing globals.css uses
  // for cursor blink and elsewhere — pure-CSS, no React hook needed
  // for the styles themselves.
  el.textContent = `
    [data-sentence-focus] [data-sentence] {
      opacity: 0.55;
      transition: opacity 200ms var(--easing-prose, cubic-bezier(0.16, 1, 0.3, 1));
    }
    [data-sentence-focus] [data-sentence][data-adjacent="true"] { opacity: 0.85; }
    [data-sentence-focus] [data-sentence][data-active="true"]   { opacity: 1.0; }
    [data-sentence-focus][data-selecting="true"] [data-sentence]  { opacity: 1.0; }
    @media (prefers-reduced-motion: reduce) {
      [data-sentence-focus] [data-sentence] { transition: none; }
    }
  `
}

export function SentenceFocus({ enabled }: SentenceFocusProps) {
  useEffect(() => {
    ensureStyle(enabled)
    if (!enabled) return

    function onSelectionChange() {
      // 8.9 broadening — Edit Mode + Focus Mode both qualify now.
      // We query all `[data-sentence-focus]` ancestors that contain
      // the current selection and flip their data-selecting attribute.
      // (Practically there's one ProseEditor visible at a time, but
      // querying all is robust to layouts that surface more than one.)
      const sel = window.getSelection()
      const isSelecting = sel !== null && sel.rangeCount > 0 && !sel.isCollapsed
      const roots = document.querySelectorAll<HTMLElement>('[data-sentence-focus]')
      for (const root of roots) {
        if (isSelecting) root.dataset.selecting = 'true'
        else delete root.dataset.selecting
      }
    }

    document.addEventListener('selectionchange', onSelectionChange)
    return () => {
      document.removeEventListener('selectionchange', onSelectionChange)
    }
  }, [enabled])

  return null
}
