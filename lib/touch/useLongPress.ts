'use client'

// Phase 8.01.F T-8 — long-press detection.
//
// Spec: Component Spec v2.21 §18.3 (touch interactions).
//   - 350ms hold → onDragStart (touch-initiated drag)
//   - 800ms hold → onContextMenu (touch context menu)
//   - Movement > moveThreshold pixels aborts both timers (it's a scroll/swipe)
//   - PointerCancel aborts both timers (system-cancelled gesture)
//   - Mouse / pen pointers do NOT engage long-press (desktop right-click
//     stays the existing context-menu path)
//
// Returns event handlers to spread onto an element. Internal timers
// cleared on every release/move/cancel; no setInterval drift.

import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react'

export const LONG_PRESS_DRAG_MS = 350
export const LONG_PRESS_CONTEXT_MENU_MS = 800
export const LONG_PRESS_MOVE_THRESHOLD_PX = 8

export type LongPressEventKind = 'tap' | 'drag' | 'context' | 'cancel'

export interface UseLongPressOptions {
  onDragStart?: () => void
  onContextMenu?: () => void
  /** Pixels of finger movement that aborts the long-press. Default 8. */
  moveThreshold?: number
}

/**
 * Pure classifier — given a hold duration + movement + pointer type,
 * return the kind of long-press event that should fire. Exported for
 * unit testing (the actual handler implementation is timer-driven and
 * harder to test deterministically).
 */
export interface ClassifyInputs {
  durationMs: number
  movedPx: number
  pointerType: string
  moveThreshold?: number
}

export function classifyLongPress({
  durationMs,
  movedPx,
  pointerType,
  moveThreshold = LONG_PRESS_MOVE_THRESHOLD_PX,
}: ClassifyInputs): LongPressEventKind {
  if (pointerType !== 'touch') return 'cancel'
  if (movedPx > moveThreshold) return 'cancel'
  if (durationMs >= LONG_PRESS_CONTEXT_MENU_MS) return 'context'
  if (durationMs >= LONG_PRESS_DRAG_MS) return 'drag'
  return 'tap'
}

interface ActivePress {
  startX: number
  startY: number
  startedAt: number
  pointerType: string
  fired: 'none' | 'drag' | 'context'
  /** Both timers, cleared on cancel. */
  dragTimer: ReturnType<typeof setTimeout> | null
  contextTimer: ReturnType<typeof setTimeout> | null
}

export function useLongPress({ onDragStart, onContextMenu, moveThreshold = LONG_PRESS_MOVE_THRESHOLD_PX }: UseLongPressOptions) {
  const stateRef = useRef<ActivePress | null>(null)

  // Clear timers on unmount.
  useEffect(() => {
    return () => {
      const s = stateRef.current
      if (s) {
        if (s.dragTimer) clearTimeout(s.dragTimer)
        if (s.contextTimer) clearTimeout(s.contextTimer)
      }
      stateRef.current = null
    }
  }, [])

  function abort() {
    const s = stateRef.current
    if (!s) return
    if (s.dragTimer) clearTimeout(s.dragTimer)
    if (s.contextTimer) clearTimeout(s.contextTimer)
    stateRef.current = null
  }

  function onPointerDown(e: ReactPointerEvent) {
    // Ignore non-touch pointers — desktop right-click still owns the
    // context-menu path at the row level.
    if (e.pointerType !== 'touch') {
      abort()
      return
    }
    const start: ActivePress = {
      startX: e.clientX,
      startY: e.clientY,
      startedAt: performance.now(),
      pointerType: e.pointerType,
      fired: 'none',
      dragTimer: null,
      contextTimer: null,
    }
    stateRef.current = start
    if (onDragStart) {
      start.dragTimer = setTimeout(() => {
        // Only fire if still active and we haven't moved.
        if (stateRef.current === start && start.fired === 'none') {
          start.fired = 'drag'
          onDragStart()
        }
      }, LONG_PRESS_DRAG_MS)
    }
    if (onContextMenu) {
      start.contextTimer = setTimeout(() => {
        if (stateRef.current === start && start.fired !== 'context') {
          start.fired = 'context'
          onContextMenu()
        }
      }, LONG_PRESS_CONTEXT_MENU_MS)
    }
  }

  function onPointerMove(e: ReactPointerEvent) {
    const s = stateRef.current
    if (!s) return
    const dx = e.clientX - s.startX
    const dy = e.clientY - s.startY
    if (Math.hypot(dx, dy) > moveThreshold) {
      abort()
    }
  }

  function onPointerUp() {
    abort()
  }

  function onPointerCancel() {
    abort()
  }

  return { onPointerDown, onPointerMove, onPointerUp, onPointerCancel }
}
