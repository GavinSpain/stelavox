// Phase 8.01.C T-8.3 — mentioned-node state.
//
// Tracks the set of node ids currently referenced by active mention chips
// in DirectorInput. NodeRow reads from this store via useIsNodeMentioned
// to apply the verdigris-left-border highlight (reuses Inviolable #2 use
// #9 active-node treatment — no new use category).
//
// Zustand-free implementation matches the existing simple-store pattern
// used elsewhere in lib/stores/ (no new dependency). The mentioned set is
// session-only — clears on page reload, never persisted.

import { useSyncExternalStore } from 'react'

let mentionedSet: Set<string> = new Set()
const listeners: Set<() => void> = new Set()

function emit() {
  for (const l of listeners) l()
}

export function setMentionedNodeIds(ids: Iterable<string>): void {
  mentionedSet = new Set(ids)
  emit()
}

export function clearMentionedNodes(): void {
  if (mentionedSet.size === 0) return
  mentionedSet = new Set()
  emit()
}

export function getMentionedNodeIds(): ReadonlySet<string> {
  return mentionedSet
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * React hook returning whether a given node is currently in the
 * mentioned set. Re-renders only when the membership state for THIS node
 * id flips (the snapshot is the boolean answer for this id).
 */
export function useIsNodeMentioned(nodeId: string): boolean {
  return useSyncExternalStore(
    subscribe,
    () => mentionedSet.has(nodeId),
    () => false, // SSR snapshot — never mentioned on the server
  )
}
