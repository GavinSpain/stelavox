/**
 * Phase 8.5b B.3 — Realtime → TanStack cache patcher unit tests.
 *
 * Pins the architectural contract of lib/queries/realtime-patcher.ts:
 *   - UPDATE / INSERT / DELETE patches apply correctly to the
 *     document.nodes array AND the per-node cache
 *   - aggregate-affecting field changes invalidate document.rollup
 *   - Realtime-before-fetch events get buffered and flushed when the
 *     first fetch lands (Tier-A §3.4.1; H-33 mitigation)
 *   - the buffer is bounded at 1000 with FIFO eviction
 *
 * Refs: docs/stelavox_phase8_5b_test_plan_v1_0.md §3 (TC-8.5b-B3-07..11 + 21)
 *       docs/stelavox_document_load_architecture_v1_0.md §3.4 + §3.4.1
 */

import { describe, expect, it, beforeEach, vi } from 'vitest'
import { QueryClient } from '@tanstack/react-query'

import { documentKeys, nodeKeys } from '@/lib/queries/keys'
import {
  applyNodeUpdate,
  applyNodeInsert,
  applyNodeDelete,
  flushPendingPatches,
  __resetPendingPatchesForTest,
  __pendingPatchCountForTest,
} from '@/lib/queries/realtime-patcher'
import type { TreeNodeRow } from '@/lib/queries/useDocumentNodes'

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 60_000 } },
  })
}

function makeRow(overrides: Partial<TreeNodeRow> = {}): TreeNodeRow {
  return {
    id: 'row-1',
    parent_id: null,
    order: 0,
    node_category: 'structural',
    node_type: 'beat',
    layer_index: 4,
    name: 'Test Beat',
    status: 'draft',
    word_count_actual: 0,
    word_count_target: 100,
    updated_at: '2026-06-08T00:00:00Z',
    created_at: '2026-06-08T00:00:00Z',
    is_leaf: true,
    locked: false,
    document_id: 'doc-1',
    project_id: 'proj-1',
    organisation_id: 'org-1',
    scope: null,
    ...overrides,
  } as TreeNodeRow
}

describe('Phase 8.5b B.3 — Realtime cache patcher', () => {
  beforeEach(() => {
    __resetPendingPatchesForTest()
  })

  // ───────────────────────────────────────────────────────────────────
  // TC-8.5b-B3-07 — Patcher updates the document.nodes cache.
  // GIVEN cache populated with one row that has id 'X'.
  // WHEN applyNodeUpdate is invoked with new data for 'X'.
  // THEN the cached row reflects the update; other rows unchanged.
  // ───────────────────────────────────────────────────────────────────
  it('TC-8.5b-B3-07 — UPDATE patches the row in the tree cache', () => {
    const qc = makeQueryClient()
    const rowA = makeRow({ id: 'A', name: 'Original' })
    const rowB = makeRow({ id: 'B', name: 'Other' })
    qc.setQueryData(documentKeys.nodes('doc-1'), [rowA, rowB])

    applyNodeUpdate(qc, rowA, { id: 'A', name: 'Updated', document_id: 'doc-1' })

    const after = qc.getQueryData<TreeNodeRow[]>(documentKeys.nodes('doc-1'))!
    expect(after).toHaveLength(2)
    expect(after.find(r => r.id === 'A')!.name).toBe('Updated')
    expect(after.find(r => r.id === 'B')!.name).toBe('Other')
  })

  // ───────────────────────────────────────────────────────────────────
  // TC-8.5b-B3-08 — Patcher updates the per-node cache when present.
  // GIVEN nodeKeys.single('A') cache populated.
  // WHEN applyNodeUpdate is invoked with new data for 'A'.
  // THEN the per-node cache reflects the merged update.
  // ───────────────────────────────────────────────────────────────────
  it('TC-8.5b-B3-08 — UPDATE patches the per-node cache when present', () => {
    const qc = makeQueryClient()
    qc.setQueryData(nodeKeys.single('A'), { id: 'A', name: 'Original', prose: 'old' })

    applyNodeUpdate(qc, null, { id: 'A', name: 'Updated', document_id: 'doc-1' })

    const after = qc.getQueryData<{ id: string; name: string; prose: string }>(nodeKeys.single('A'))!
    expect(after.name).toBe('Updated')
    expect(after.prose).toBe('old')  // unchanged fields preserved
  })

  // ───────────────────────────────────────────────────────────────────
  // TC-8.5b-B3-09 — Aggregate-affecting change invalidates rollup.
  // GIVEN rollup cache populated AND invalidateQueries spied.
  // WHEN word_count_actual changes.
  // THEN invalidateQueries called with documentKeys.rollup(doc).
  // ───────────────────────────────────────────────────────────────────
  it('TC-8.5b-B3-09 — aggregate-affecting change invalidates rollup', () => {
    const qc = makeQueryClient()
    qc.setQueryData(documentKeys.nodes('doc-1'), [makeRow({ id: 'A' })])
    qc.setQueryData(documentKeys.rollup('doc-1'), { words_drafted: 100 })
    const spy = vi.spyOn(qc, 'invalidateQueries')

    applyNodeUpdate(
      qc,
      { id: 'A', word_count_actual: 100 } as Partial<TreeNodeRow>,
      { id: 'A', document_id: 'doc-1', word_count_actual: 200 } as TreeNodeRow & { document_id: string },
    )

    expect(spy).toHaveBeenCalledWith({ queryKey: documentKeys.rollup('doc-1') })
  })

  // ───────────────────────────────────────────────────────────────────
  // TC-8.5b-B3-10 — INSERT adds the row to the tree cache.
  // ───────────────────────────────────────────────────────────────────
  it('TC-8.5b-B3-10 — INSERT appends to the tree cache', () => {
    const qc = makeQueryClient()
    qc.setQueryData(documentKeys.nodes('doc-1'), [makeRow({ id: 'A' })])

    applyNodeInsert(qc, makeRow({ id: 'B' }) as TreeNodeRow & { document_id: string })

    const after = qc.getQueryData<TreeNodeRow[]>(documentKeys.nodes('doc-1'))!
    expect(after).toHaveLength(2)
    expect(after.find(r => r.id === 'B')).toBeDefined()
  })

  // ───────────────────────────────────────────────────────────────────
  // TC-8.5b-B3-11 — DELETE removes the row from the tree cache.
  // ───────────────────────────────────────────────────────────────────
  it('TC-8.5b-B3-11 — DELETE removes from the tree cache', () => {
    const qc = makeQueryClient()
    qc.setQueryData(documentKeys.nodes('doc-1'), [
      makeRow({ id: 'A' }),
      makeRow({ id: 'B' }),
    ])

    applyNodeDelete(qc, { id: 'A', document_id: 'doc-1' })

    const after = qc.getQueryData<TreeNodeRow[]>(documentKeys.nodes('doc-1'))!
    expect(after).toHaveLength(1)
    expect(after.find(r => r.id === 'A')).toBeUndefined()
    expect(after.find(r => r.id === 'B')).toBeDefined()
  })

  // ───────────────────────────────────────────────────────────────────
  // TC-8.5b-B3-21 — Realtime event before initial fetch is buffered
  // and applied when the fetch lands. The headline ordering guarantee
  // from Tier-A §3.4.1; H-33 mitigation.
  //
  // GIVEN tree cache is cold (no setQueryData called).
  // WHEN applyNodeUpdate is called for a row in that documentId.
  // THEN the patch is buffered (pendingPatchCount += 1) AND the cache
  //      remains cold (no setQueryData ran).
  // WHEN flushPendingPatches is called for that key.
  // THEN the buffered patch applies to the (now-populated) cache
  //      AND the buffer empties.
  // ───────────────────────────────────────────────────────────────────
  it('TC-8.5b-B3-21 — event-before-fetch is buffered and flushed on fetch land', () => {
    const qc = makeQueryClient()
    expect(__pendingPatchCountForTest()).toBe(0)

    // Cache cold; UPDATE arrives.
    applyNodeUpdate(qc, null, { id: 'A', document_id: 'doc-1', name: 'Patched' })
    expect(__pendingPatchCountForTest()).toBe(1)
    // Cache should still be cold.
    expect(qc.getQueryData(documentKeys.nodes('doc-1'))).toBeUndefined()

    // Now the first fetch lands.
    qc.setQueryData(documentKeys.nodes('doc-1'), [makeRow({ id: 'A', name: 'Initial' })])

    // Flush.
    const applied = flushPendingPatches(qc, documentKeys.nodes('doc-1'))
    expect(applied).toBe(1)
    expect(__pendingPatchCountForTest()).toBe(0)

    // Cache now reflects the buffered patch.
    const after = qc.getQueryData<TreeNodeRow[]>(documentKeys.nodes('doc-1'))!
    expect(after.find(r => r.id === 'A')!.name).toBe('Patched')
  })

  // ───────────────────────────────────────────────────────────────────
  // TC-8.5b-B3-EDGE-10 — pendingPatches buffer bound.
  // GIVEN buffer at 999 entries (synthetic load).
  // WHEN a 1001st patch arrives.
  // THEN oldest patches are evicted (FIFO); buffer size stays ≤ 1000.
  // ───────────────────────────────────────────────────────────────────
  it('TC-8.5b-B3-EDGE-10 — pending buffer bounded at 1000 with FIFO eviction', () => {
    const qc = makeQueryClient()
    // Synthesize > 1000 events to a cold cache (all get buffered).
    for (let i = 0; i < 1050; i++) {
      applyNodeUpdate(qc, null, { id: `R${i}`, document_id: 'doc-X', name: `n${i}` })
    }
    expect(__pendingPatchCountForTest()).toBe(1000)
  })

  // ───────────────────────────────────────────────────────────────────
  // TC-8.5b-B3-INSERT-COLD — INSERT to cold cache is buffered + flushed.
  // ───────────────────────────────────────────────────────────────────
  it('INSERT to cold cache is buffered and applies on flush', () => {
    const qc = makeQueryClient()
    applyNodeInsert(qc, makeRow({ id: 'new', document_id: 'doc-1' }) as TreeNodeRow & { document_id: string })
    expect(__pendingPatchCountForTest()).toBe(1)
    qc.setQueryData(documentKeys.nodes('doc-1'), [])
    flushPendingPatches(qc, documentKeys.nodes('doc-1'))
    const after = qc.getQueryData<TreeNodeRow[]>(documentKeys.nodes('doc-1'))!
    expect(after).toHaveLength(1)
    expect(after[0]!.id).toBe('new')
  })

  // ───────────────────────────────────────────────────────────────────
  // Hot cache: UPDATE not buffered.
  // ───────────────────────────────────────────────────────────────────
  it('UPDATE with cache present applies immediately, not buffered', () => {
    const qc = makeQueryClient()
    qc.setQueryData(documentKeys.nodes('doc-1'), [makeRow({ id: 'A' })])
    applyNodeUpdate(qc, null, { id: 'A', document_id: 'doc-1', name: 'Now' })
    expect(__pendingPatchCountForTest()).toBe(0)
    const after = qc.getQueryData<TreeNodeRow[]>(documentKeys.nodes('doc-1'))!
    expect(after[0]!.name).toBe('Now')
  })
})
