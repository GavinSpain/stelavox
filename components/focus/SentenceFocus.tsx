'use client'

// Spec: stelavox_component_specification_v2_1.md §6.5
// 🔒 Locked: 1.0 active / 0.85 adjacent / 0.55 minimum (never below).
// Cursor-move transition 200ms --easing-prose; selection returns all to 1.0.
// Sentence detection: Intl.Segmenter (Chrome 87+/Firefox 125+/Safari 16.4+);
// regex fallback handles common abbreviations.

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
