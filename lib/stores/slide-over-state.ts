// Phase 8.01.F T-4 — slide-over open/closed state.
//
// useSyncExternalStore pattern matches 8.01.C mentioned-nodes + 8.01.D
// localStorage-backed UI state. No new dependency.
//
// Two independent slide-overs at tablet-portrait:
//   - tree (anchored left)
//   - director (anchored right, only mounted when ModeTabBar is on Director)

import { useSyncExternalStore } from 'react'

interface State {
  tree: boolean
  director: boolean
}

let state: State = { tree: false, director: false }
const listeners: Set<() => void> = new Set()

function emit() {
  for (const l of listeners) l()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

// ─── Tree slide-over ──────────────────────────────────────────────────

export function setTreeSlideOverOpen(open: boolean): void {
  if (state.tree === open) return
  state = { ...state, tree: open }
  emit()
}

export function useTreeSlideOverOpen(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => state.tree,
    () => false,
  )
}

export function toggleTreeSlideOver(): void {
  setTreeSlideOverOpen(!state.tree)
}

// ─── Director slide-over ──────────────────────────────────────────────

export function setDirectorSlideOverOpen(open: boolean): void {
  if (state.director === open) return
  state = { ...state, director: open }
  emit()
}

export function useDirectorSlideOverOpen(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => state.director,
    () => false,
  )
}

export function toggleDirectorSlideOver(): void {
  setDirectorSlideOverOpen(!state.director)
}

// ─── For unit testing — peek + reset ──────────────────────────────────

export function _peekSlideOverState(): State {
  return state
}

export function _resetSlideOverState(): void {
  state = { tree: false, director: false }
  emit()
}
