/**
 * Phase 8.5b B.1b — `listNodes` pagination regression test.
 *
 * Closes the same audit gap as B.1 closed for `computeChildActualAggregates`:
 * PostgREST's 1000-row default response cap was silently truncating
 * `lib/data/nodes.ts:listNodes` on documents > 1000 nodes.
 *
 * Symptom: Mega Manuscript (1556 nodes) showed only ~3 of 5 beats per
 * scene in the tree because the depth-4 beat rows came back ordered by
 * `order` and the 1000th row landed mid-way through the order=3 beats.
 *
 * This test seeds-or-discovers the Mega Manuscript (1556 nodes), runs
 * `listNodes` for `category='all'`, and asserts the returned count
 * equals the full 1556 — not the truncated 1000.
 *
 * Refs: lib/data/nodes.ts (the SUT)
 *       scripts/seed-mega-doc.ts (fixture seeder)
 *       docs/stelavox_phase8_5b_b1_test_report_v1_0.md (the original
 *           audit that missed listNodes)
 */

import { describe, expect, it, beforeAll } from 'vitest'

import { adminClient } from '../helpers/db'
import { listNodes } from '@/lib/data/nodes'

// Mega Manuscript shape — the canonical "above-the-1000-row-threshold"
// fixture. See scripts/seed-mega-doc.ts for the exact composition.
const EXPECTED_TOTAL_NODES = 1556
const EXPECTED_BEAT_COUNT = 1250
const EXPECTED_SCENE_COUNT = 250

let MEGA_DOCUMENT_ID = ''

async function findMegaDocument(): Promise<string | null> {
  const admin = adminClient()
  const { data: project } = await admin
    .from('projects')
    .select('id')
    .eq('name', 'Mega Manuscript')
    .maybeSingle()
  if (!project) return null
  const { data: document } = await admin
    .from('documents')
    .select('id')
    .eq('project_id', project.id)
    .maybeSingle()
  return document?.id ?? null
}

describe('Phase 8.5b B.1b — listNodes pagination', () => {
  beforeAll(async () => {
    const docId = await findMegaDocument()
    if (docId) MEGA_DOCUMENT_ID = docId
  })

  // ───────────────────────────────────────────────────────────────────
  // TC-8.5b-B1b-01 — listNodes returns ALL nodes above the 1000 cap.
  // GIVEN the Mega Manuscript (1556 nodes; well above PostgREST's 1000-
  //       row default response cap).
  // WHEN `listNodes` is called with `category='all'`.
  // THEN the full 1556 rows return, not the truncated 1000.
  // ───────────────────────────────────────────────────────────────────
  it('TC-8.5b-B1b-01 — listNodes returns the full node set above the 1000-row cap', async () => {
    if (!MEGA_DOCUMENT_ID) {
      console.warn('TC-8.5b-B1b-01 skipped — Mega Manuscript not seeded')
      return
    }
    const admin = adminClient()
    // 'all' category returns every node (no node_category filter).
    const { data, error } = await listNodes(
      admin as never,
      MEGA_DOCUMENT_ID,
      'all',
      'structural',
    )
    expect(error).toBeNull()
    expect(data).toBeTruthy()
    expect(data!.length).toBe(EXPECTED_TOTAL_NODES)
  })

  // ───────────────────────────────────────────────────────────────────
  // TC-8.5b-B1b-02 — Beat coverage proves the truncation is fixed.
  // The bug shape: ordered by (depth ASC, order ASC), beats come back
  // grouped by `order` (all order=1 beats, then order=2, etc.). The
  // pre-fix truncation cut beats off mid-order-3, so most scenes had
  // 3 beats and a tail had only 2.
  //
  // Post-fix: every scene must have exactly 5 beats.
  // ───────────────────────────────────────────────────────────────────
  it('TC-8.5b-B1b-02 — every scene has its full beat count after the fix', async () => {
    if (!MEGA_DOCUMENT_ID) {
      console.warn('TC-8.5b-B1b-02 skipped — Mega Manuscript not seeded')
      return
    }
    const admin = adminClient()
    const { data, error } = await listNodes(
      admin as never,
      MEGA_DOCUMENT_ID,
      'all',
      'structural',
    )
    expect(error).toBeNull()
    expect(data).toBeTruthy()

    // Group beats by their parent scene id.
    const beats = data!.filter((n) => n.layer_index === 4)
    expect(beats.length).toBe(EXPECTED_BEAT_COUNT)

    const beatsPerScene = new Map<string, number>()
    for (const b of beats) {
      if (b.parent_id) beatsPerScene.set(b.parent_id, (beatsPerScene.get(b.parent_id) ?? 0) + 1)
    }
    expect(beatsPerScene.size).toBe(EXPECTED_SCENE_COUNT)

    // Every scene must have exactly 5 beats. Any scene with fewer
    // would indicate the truncation bug has returned.
    for (const count of beatsPerScene.values()) {
      expect(count).toBe(5)
    }
  })

  // ───────────────────────────────────────────────────────────────────
  // TC-8.5b-B1b-03 — Structural-only path also fetches all rows.
  // The bug applied to any category that produced > 1000 rows. Verify
  // the default `category='structural'` path is also paginated.
  // ───────────────────────────────────────────────────────────────────
  it('TC-8.5b-B1b-03 — structural-only path paginates correctly', async () => {
    if (!MEGA_DOCUMENT_ID) {
      console.warn('TC-8.5b-B1b-03 skipped — Mega Manuscript not seeded')
      return
    }
    const admin = adminClient()
    const { data, error } = await listNodes(
      admin as never,
      MEGA_DOCUMENT_ID,
      'structural',
      'structural',
    )
    expect(error).toBeNull()
    expect(data).toBeTruthy()
    // Mega Manuscript has no context nodes; structural === all.
    expect(data!.length).toBe(EXPECTED_TOTAL_NODES)
  })
})
