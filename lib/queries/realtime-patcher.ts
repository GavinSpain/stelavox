'use client'

// Phase 8.5b B.3 — Realtime → TanStack cache patcher.
//
// Subscribes to postgres_changes on the `nodes` table and patches the
// TanStack Query cache directly when events arrive. No refetch fires
// on event receipt; the cache is updated in place. This is what
// eliminates the refetch-on-Realtime-event anti-pattern documented in
// Tier-A §1.5.
//
// Refs: docs/stelavox_document_load_architecture_v1_0.md §3.4 + §3.4.1
//       lib/queries/keys.ts (typed key factories)
//       lib/supabase/realtime-auth.ts (auth race fix)
//
// Patch shapes:
//   INSERT  → append the new row to the document.nodes array
//   UPDATE  → replace the matching row in the document.nodes array
//             AND replace the single-node cache for the row
//             AND invalidate document.rollup if word_count_actual /
//                 word_count_target / status changed (aggregate-affecting)
//   DELETE  → remove the row from the document.nodes array
//             AND remove the single-node cache entry
//             AND invalidate document.rollup (count + leaf totals affected)
//
// Ordering guarantee (Tier-A §3.4.1, H-33):
//   A Realtime event can arrive BEFORE the initial fetch lands when
//   the page just mounted. Without the buffer: setQueryData on an
//   empty cache writes the patch as initial data, then the fetch result
//   overwrites it. The patch is lost.
//
//   With the buffer: when getQueryData returns undefined for the
//   target key, the patch is queued in `pendingPatches`. The hook
//   side (useDocumentNodes) calls `flushPending(key)` after onSuccess
//   resolves the first fetch. Buffer bounded at 1000 (FIFO eviction).

import type { QueryClient, QueryKey } from '@tanstack/react-query'

import { documentKeys, nodeKeys } from './keys'
import type { TreeNodeRow } from './useDocumentNodes'
import type { NodeRecord } from './useNode'

interface PendingPatch {
  key: QueryKey
  apply: (queryClient: QueryClient) => void
  /** Order of arrival; oldest evicted first when buffer fills. */
  seq: number
}

const PENDING_BUFFER_MAX = 1000
let pendingPatches: PendingPatch[] = []
let nextSeq = 1

function bufferPatch(patch: Omit<PendingPatch, 'seq'>) {
  pendingPatches.push({ ...patch, seq: nextSeq++ })
  if (pendingPatches.length > PENDING_BUFFER_MAX) {
    // FIFO eviction.
    pendingPatches.splice(0, pendingPatches.length - PENDING_BUFFER_MAX)
  }
}

function keysEqual(a: QueryKey, b: QueryKey): boolean {
  if (a === b) return true
  if (!Array.isArray(a) || !Array.isArray(b)) return false
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

/**
 * Called by useDocumentNodes after its first fetch resolves. Applies
 * any pending patches that were buffered while the fetch was in flight.
 * Exported for tests.
 */
export function flushPendingPatches(queryClient: QueryClient, key: QueryKey): number {
  const toApply = pendingPatches.filter((p) => keysEqual(p.key, key))
  for (const p of toApply) p.apply(queryClient)
  pendingPatches = pendingPatches.filter((p) => !keysEqual(p.key, key))
  return toApply.length
}

/**
 * Test-only — reset the buffer. Production code does not call this.
 */
export function __resetPendingPatchesForTest() {
  pendingPatches = []
  nextSeq = 1
}

/**
 * Test-only — read the buffer size.
 */
export function __pendingPatchCountForTest(): number {
  return pendingPatches.length
}

const AGGREGATE_AFFECTING_FIELDS = [
  'word_count_actual',
  'word_count_target',
  'status',
  'layer_index',
  'parent_id',
] as const

function aggregatesChanged(
  oldRow: Partial<TreeNodeRow> | null,
  newRow: Partial<TreeNodeRow>,
): boolean {
  if (!oldRow) return true
  for (const f of AGGREGATE_AFFECTING_FIELDS) {
    if (oldRow[f] !== newRow[f]) return true
  }
  return false
}

/**
 * Apply an UPDATE patch to the cache. Idempotent; safe to call
 * multiple times. Exported for tests.
 */
export function applyNodeUpdate(
  queryClient: QueryClient,
  oldRow: Partial<TreeNodeRow> | null,
  newRow: Partial<TreeNodeRow> & { id: string; document_id?: string | null },
) {
  // Patch the tree array if it's in cache.
  if (newRow.document_id) {
    const treeKey = documentKeys.nodes(newRow.document_id)
    const current = queryClient.getQueryData<TreeNodeRow[]>(treeKey)
    if (current === undefined) {
      bufferPatch({
        key: treeKey,
        apply: (qc) => applyNodeUpdate(qc, oldRow, newRow),
      })
    } else {
      queryClient.setQueryData<TreeNodeRow[]>(treeKey, (prev) =>
        prev?.map((r) => (r.id === newRow.id ? ({ ...r, ...newRow } as TreeNodeRow) : r)) ?? prev,
      )
    }
  }
  // Patch the single-node cache if it's in cache.
  const nodeKey = nodeKeys.single(newRow.id)
  const prevNode = queryClient.getQueryData<NodeRecord>(nodeKey)
  if (prevNode !== undefined) {
    queryClient.setQueryData<NodeRecord>(nodeKey, { ...prevNode, ...(newRow as Partial<NodeRecord>) })
  }
  // Invalidate the rollup if the aggregate-affecting fields changed.
  if (newRow.document_id && aggregatesChanged(oldRow, newRow)) {
    queryClient.invalidateQueries({ queryKey: documentKeys.rollup(newRow.document_id) })
  }
}

/**
 * Apply an INSERT patch. Same buffering rules as updates — if the
 * tree cache isn't populated yet, the insert is buffered.
 */
export function applyNodeInsert(
  queryClient: QueryClient,
  newRow: TreeNodeRow & { document_id: string },
) {
  const treeKey = documentKeys.nodes(newRow.document_id)
  const current = queryClient.getQueryData<TreeNodeRow[]>(treeKey)
  if (current === undefined) {
    bufferPatch({
      key: treeKey,
      apply: (qc) => applyNodeInsert(qc, newRow),
    })
  } else {
    queryClient.setQueryData<TreeNodeRow[]>(treeKey, (prev) =>
      prev ? [...prev, newRow] : [newRow],
    )
  }
  // Inserts always affect rollup (count + leaf_count + last_updated_at).
  queryClient.invalidateQueries({ queryKey: documentKeys.rollup(newRow.document_id) })
}

/**
 * Apply a DELETE patch.
 */
export function applyNodeDelete(
  queryClient: QueryClient,
  oldRow: { id: string; document_id: string | null },
) {
  if (oldRow.document_id) {
    const treeKey = documentKeys.nodes(oldRow.document_id)
    const current = queryClient.getQueryData<TreeNodeRow[]>(treeKey)
    if (current === undefined) {
      bufferPatch({
        key: treeKey,
        apply: (qc) => applyNodeDelete(qc, oldRow),
      })
    } else {
      queryClient.setQueryData<TreeNodeRow[]>(treeKey, (prev) =>
        prev?.filter((r) => r.id !== oldRow.id) ?? prev,
      )
    }
    queryClient.invalidateQueries({ queryKey: documentKeys.rollup(oldRow.document_id) })
  }
  // Drop the single-node cache entry.
  queryClient.removeQueries({ queryKey: nodeKeys.single(oldRow.id), exact: true })
}

// B.5c — `attachNodesRealtimePatcher` removed. The patcher functions
// above are now driven by a `useRealtimeTopic('nodes', ...)` subscriber
// in `lib/queries/NodesPatcherMount.tsx`. No consumer opens a standalone
// channel for nodes events anymore.
