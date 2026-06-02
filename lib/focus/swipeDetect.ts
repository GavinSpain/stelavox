// Phase 8.01.B T-5 — swipe-gesture detection for Focus Mode beat-nav.
//
// Pure function: takes pointer start + end coordinates and returns the
// swipe direction. Caller (FocusMode) wires it to pointer events with a
// pointerType === 'touch' guard. Thresholds per Component Spec v2.21
// §18.3 + wireframe iter1 F-2:
//   - Horizontal distance > 60px (decisive intent, not noise)
//   - Duration < 350ms (decisive speed, not slow drag)
//   - Vertical drift < 30px (otherwise scroll wins)
//
// Mouse / pen pointerType returns 'none' — only touch is admitted.

export type PointerKind = 'touch' | 'pen' | 'mouse' | string

export interface SwipeSample {
  startX: number
  startY: number
  endX: number
  endY: number
  /** Milliseconds between pointerdown and pointerup. */
  durationMs: number
  /** PointerEvent.pointerType. */
  pointerType: PointerKind
}

export type SwipeDirection = 'prev' | 'next' | 'none'

// Phase 8.01.B T-5 — thresholds. Centralised so unit tests + UI both
// reference the same constants and future tuning is a single edit.
export const SWIPE_MIN_DISTANCE_PX = 60
export const SWIPE_MAX_DURATION_MS = 350
export const SWIPE_MAX_VERTICAL_DRIFT_PX = 30

/**
 * Classify a pointer gesture as a beat-nav swipe.
 *   - Left swipe (deltaX < -60 in <350ms with <30px vertical drift) → 'next'
 *     (matches ⌘ → on desktop — advance to the next beat)
 *   - Right swipe (deltaX > 60 ...) → 'prev'
 *     (matches ⌘ ← — go back to the previous beat)
 * Any other shape, or any non-touch pointer, returns 'none'.
 */
export function classifySwipe(s: SwipeSample): SwipeDirection {
  // Gate: only touch counts (mouse / pen / trackpad swipes conflict with
  // text selection and would steal the gesture from the editor).
  if (s.pointerType !== 'touch') return 'none'

  const deltaX = s.endX - s.startX
  const deltaY = s.endY - s.startY

  if (Math.abs(deltaY) > SWIPE_MAX_VERTICAL_DRIFT_PX) return 'none'
  if (s.durationMs > SWIPE_MAX_DURATION_MS) return 'none'
  if (Math.abs(deltaX) < SWIPE_MIN_DISTANCE_PX) return 'none'

  return deltaX < 0 ? 'next' : 'prev'
}
