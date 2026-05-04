'use client'

// Spec: stelavox_component_specification_v2_5.md §6.5
//
// ⚠️  PHASE 3 SHIPS A STUB — FULL IMPLEMENTATION DEFERRED TO PHASE 8 ⚠️
//
// Per TA v1.7 §11 (Phase 8 row), Component Spec v2.5 §6.5 deferred banner,
// Phase 3 Test Plan v1.2 §10.1, and Build Checklist v1.2 SU-13:
//
// What this file ships in Phase 3:
//   • The opacity CSS rules targeting [data-sentence-focus] / [data-sentence]
//     elements (no-op until those elements exist).
//   • A selectionchange listener that toggles a `data-selecting` attribute
//     on the focus root (also no-op for the same reason).
//
// What's NOT shipped in Phase 3 (all Phase 8):
//   • The toggle host — a three-dot menu in the prose editor panel header.
//     Without it, `enabled` stays at the default `false` from
//     localStorage.stelavox_sentence_focus_enabled, so this component is
//     dormant in production use.
//   • The Intl.Segmenter-based sentence segmentation walk over Tiptap's
//     prose JSON.
//   • Wrapping each sentence in a <span data-sentence> element that
//     survives Tiptap's transactions.
//   • Active-sentence marking on cursor moves (data-active / data-adjacent).
//   • prefers-reduced-motion collapse for the 200ms transition.
//
// Tests TC-U-14 / TC-M-04 / TC-M-06 are correspondingly deferred to Phase 8.
//
// 🔒 The behaviour contract below is unchanged — it is what Phase 8 must
// deliver. Locked values: 1.0 active / 0.85 adjacent / 0.55 minimum. The
// 0.55 minimum is the floor below which text reads as disabled or deleted.

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
  el.textContent = `
    [data-sentence-focus] [data-sentence] {
      opacity: 0.55;
      transition: opacity 200ms var(--easing-prose, cubic-bezier(0.16, 1, 0.3, 1));
    }
    [data-sentence-focus] [data-sentence][data-adjacent="true"] { opacity: 0.85; }
    [data-sentence-focus] [data-sentence][data-active="true"]   { opacity: 1.0; }
    [data-sentence-focus][data-selecting="true"] [data-sentence]  { opacity: 1.0; }
  `
}

export function SentenceFocus({ enabled }: SentenceFocusProps) {
  useEffect(() => {
    ensureStyle(enabled)
    if (!enabled) return

    function onSelectionChange() {
      const editor = document.querySelector<HTMLElement>('[data-editor="prose"][data-mode="focus"] .tiptap')
      if (!editor) return
      const sel = window.getSelection()
      const isSelecting = sel !== null && sel.rangeCount > 0 && !sel.isCollapsed
      const root = editor.closest('[data-sentence-focus]') as HTMLElement | null
      if (root) {
        if (isSelecting) root.dataset.selecting = 'true'
        else delete root.dataset.selecting
      }
      // Active-sentence marking is computed lazily in the wrapping component
      // (this hook just renders the styles + selection class). Phase 3 keeps
      // sentence segmentation in the wrapper to avoid coupling.
    }

    document.addEventListener('selectionchange', onSelectionChange)
    return () => {
      document.removeEventListener('selectionchange', onSelectionChange)
    }
  }, [enabled])

  return null
}
