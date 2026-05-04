'use client'

// Spec: stelavox_component_specification_v2_1.md §6.4
// Keeps the active line at 42% of viewport height (±2 px tolerance).
// Default ON in Focus Mode (per spec); persisted under
// stelavox_typewriter_enabled.

import { useEffect, useRef } from 'react'

interface TypewriterContainerProps {
  enabled: boolean
  children: React.ReactNode
}

export function TypewriterContainer({ enabled, children }: TypewriterContainerProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!enabled) return
    const el = ref.current
    if (!el) return

    function findScrollContainer(start: Element | null): Element | Window {
      let cur = start
      while (cur) {
        const overflowY = window.getComputedStyle(cur).overflowY
        if (overflowY === 'auto' || overflowY === 'scroll') return cur
        cur = cur.parentElement
      }
      return window
    }

    function cursorLineTop(): number | null {
      const sel = window.getSelection()
      if (!sel || sel.rangeCount === 0) return null
      const range = sel.getRangeAt(0)

      // Primary: range.getBoundingClientRect() on a collapsed range returns
      // a 0-width rect at the cursor position with top/bottom = the cursor's
      // VISUAL LINE top/bottom. This is the correct anchor — it follows the
      // cursor through every line of a wrapped paragraph, not just the
      // paragraph's first line. Brand Identity v2.0 §7.4 + Component Spec
      // v2.4 §6.4: "active line centres at 42% across all typing actions."
      const rangeRect = range.getBoundingClientRect()
      if (rangeRect.height > 0) return rangeRect.top

      // Fallback: range rect is degenerate (e.g., cursor at start of an
      // empty paragraph that contains only a <br>). Use the parent element's
      // rect — for a single-line empty paragraph this matches the cursor.
      const node = range.startContainer
      const fallback = (node.nodeType === Node.ELEMENT_NODE
        ? (node as HTMLElement)
        : node.parentElement
      )?.getBoundingClientRect()
      return fallback?.top ?? null
    }

    function onSelectionChange() {
      const top = cursorLineTop()
      if (top === null) return

      const targetY = window.innerHeight * 0.42
      const delta = top - targetY
      // ±2px tolerance to avoid micro-scrolls (Component Spec §6.4).
      if (Math.abs(delta) <= 2) return

      // FocusMode sets `overflow: auto` on a position:fixed div; that becomes
      // the scrolling context, not window. Find it and scroll there instead.
      const container = findScrollContainer(ref.current)
      if (container === window) {
        window.scrollBy({ top: delta, behavior: 'smooth' })
      } else {
        (container as Element).scrollBy({ top: delta, behavior: 'smooth' })
      }
    }

    document.addEventListener('selectionchange', onSelectionChange)
    return () => document.removeEventListener('selectionchange', onSelectionChange)
  }, [enabled])

  return (
    <div
      ref={ref}
      style={{
        scrollBehavior: 'smooth',
      }}
    >
      {children}
    </div>
  )
}
