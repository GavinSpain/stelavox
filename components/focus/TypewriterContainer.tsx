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

    function onSelectionChange() {
      const sel = window.getSelection()
      if (!sel || sel.rangeCount === 0) return
      const range = sel.getRangeAt(0).cloneRange()
      // Use the start container's parent as a positional anchor.
      const node = range.startContainer
      const elRect = (node.nodeType === Node.ELEMENT_NODE
        ? (node as HTMLElement)
        : node.parentElement
      )?.getBoundingClientRect()
      if (!elRect) return

      const targetY = window.innerHeight * 0.42
      const delta = elRect.top - targetY
      // ±2px tolerance to avoid micro-scrolls
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
