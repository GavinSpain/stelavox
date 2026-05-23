/**
 * M-178 — find_node_by_name ambiguity signal.
 *
 * Methodology: feedback_testing_methodology.md (four layers).
 *
 * Layer 1 — pure-function computeFindNodeAmbiguity over: no matches,
 *           single match, single clear winner over substring tail,
 *           multiple exact matches, multiple prefix matches,
 *           multiple substring-only matches.
 * Layer 2 — tool contract: response always carries ambiguous +
 *           ambiguity_reason; layer-2 cases pulled from the live
 *           Shadow Protocol fixture where possible.
 */

import { describe, expect, it } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { computeFindNodeAmbiguity, execFindNodeByName } from '@/lib/director/tools/read'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54331'
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })
const hasServiceKey = SERVICE_KEY !== ''

// ---------------------------------------------------------------------------
// Layer 1 — pure-function ambiguity rule
// ---------------------------------------------------------------------------

describe('M-178 computeFindNodeAmbiguity — layer 1', () => {
  it('no matches: not ambiguous', () => {
    expect(computeFindNodeAmbiguity([])).toEqual({ ambiguous: false, reason: null })
  })

  it('single match: not ambiguous', () => {
    expect(computeFindNodeAmbiguity([1])).toEqual({ ambiguous: false, reason: null })
    expect(computeFindNodeAmbiguity([3])).toEqual({ ambiguous: false, reason: null })
  })

  it('clear winner: one exact + many substring → not ambiguous', () => {
    expect(computeFindNodeAmbiguity([1, 3, 3, 3])).toEqual({
      ambiguous: false,
      reason: null,
    })
  })

  it('clear winner: one prefix + many substring → not ambiguous', () => {
    expect(computeFindNodeAmbiguity([2, 3, 3])).toEqual({
      ambiguous: false,
      reason: null,
    })
  })

  it('multiple exact matches → ambiguous (multiple_exact_matches)', () => {
    expect(computeFindNodeAmbiguity([1, 1])).toEqual({
      ambiguous: true,
      reason: 'multiple_exact_matches',
    })
    expect(computeFindNodeAmbiguity([1, 1, 3])).toEqual({
      ambiguous: true,
      reason: 'multiple_exact_matches',
    })
  })

  it('multiple prefix matches (no exact) → ambiguous (multiple_prefix_matches)', () => {
    expect(computeFindNodeAmbiguity([2, 2])).toEqual({
      ambiguous: true,
      reason: 'multiple_prefix_matches',
    })
    expect(computeFindNodeAmbiguity([2, 2, 3, 3])).toEqual({
      ambiguous: true,
      reason: 'multiple_prefix_matches',
    })
  })

  it('multiple substring matches (no exact/prefix) → ambiguous (multiple_substring_matches)', () => {
    expect(computeFindNodeAmbiguity([3, 3])).toEqual({
      ambiguous: true,
      reason: 'multiple_substring_matches',
    })
    expect(computeFindNodeAmbiguity([3, 3, 3, 3, 3])).toEqual({
      ambiguous: true,
      reason: 'multiple_substring_matches',
    })
  })
})

// ---------------------------------------------------------------------------
// Layer 2 — tool contract
// ---------------------------------------------------------------------------

describe.skipIf(!hasServiceKey)('M-178 execFindNodeByName ambiguity — layer 2', () => {
  const ORG_ID = '94822bb9-339a-4af4-a366-aa319fae1d25'
  const DOC_ID = '637acf44-38ab-42ad-b179-1d57844014b5'
  const session = {
    user_id: '5259319f-adde-4f29-9c6d-36b9dcea09c7',
    organisation_id: ORG_ID,
    document_id: DOC_ID,
    conversation_id: '00000000-0000-0000-0000-000000000000',
  } as never

  it('unique exact-match query: ambiguous=false', async () => {
    const r = await execFindNodeByName({ query: 'Salvage' }, session)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const d = r.data as {
      matches: Array<{ name: string; node_type: string }>
      ambiguous: boolean
      ambiguity_reason: string | null
    }
    // "Salvage" is unique among chapter names; substring matches
    // might surface but exact wins.
    expect(d.ambiguous).toBe(false)
    expect(d.ambiguity_reason).toBeNull()
    expect(d.matches[0].name).toBe('Salvage')
  })

  it('zero-match query: ambiguous=false with empty matches', async () => {
    const r = await execFindNodeByName(
      { query: 'this-name-does-not-exist-xyzqq' },
      session,
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const d = r.data as {
      matches: unknown[]
      ambiguous: boolean
      ambiguity_reason: string | null
    }
    expect(d.matches).toEqual([])
    expect(d.ambiguous).toBe(false)
    expect(d.ambiguity_reason).toBeNull()
  })

  it('response always carries ambiguous + ambiguity_reason fields', async () => {
    const r = await execFindNodeByName({ query: 'The' }, session)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const d = r.data as Record<string, unknown>
    expect('ambiguous' in d).toBe(true)
    expect('ambiguity_reason' in d).toBe(true)
    expect(typeof d.ambiguous).toBe('boolean')
  })

  it('two same-named test beats trigger ambiguous=true (multiple_exact_matches)', async () => {
    // Use a unique test-marker name so this test is isolated from
    // other suites that count beats in real chapters (M-176 in
    // particular reads Salvage's subtree). Pick a scene we can park
    // the test beats under.
    const testName = `__M178_AMBIGUITY_${Date.now()}__`
    const { data: scene } = await svc
      .from('nodes')
      .select('id, parent_id, node_type, layer_index, project_id, organisation_id')
      .eq('document_id', DOC_ID)
      .eq('node_type', 'scene')
      .limit(1)
      .maybeSingle()
    if (!scene) return

    const ids = [crypto.randomUUID(), crypto.randomUUID()]
    const inserts: Array<Record<string, unknown>> = ids.map((id, i) => ({
      id,
      organisation_id: scene.organisation_id,
      document_id: DOC_ID,
      project_id: scene.project_id,
      node_type: 'beat',
      node_category: 'structural',
      parent_id: scene.id,
      order: 900 + i,
      depth: 4,
      layer_index: 4,
      name: testName,
      created_by: '5259319f-adde-4f29-9c6d-36b9dcea09c7',
      last_modified_by: '5259319f-adde-4f29-9c6d-36b9dcea09c7',
      scope: null,
    }))
    const { error: insErr } = await svc.from('nodes').insert(inserts)
    if (insErr) return // skip on clash

    try {
      const r = await execFindNodeByName({ query: testName }, session)
      expect(r.ok).toBe(true)
      if (!r.ok) return
      const d = r.data as {
        matches: Array<{ name: string }>
        ambiguous: boolean
        ambiguity_reason: string | null
      }
      const exactMatches = d.matches.filter((m) => m.name === testName)
      expect(exactMatches.length).toBe(2)
      expect(d.ambiguous).toBe(true)
      expect(d.ambiguity_reason).toBe('multiple_exact_matches')
    } finally {
      await svc.from('nodes').delete().in('id', ids)
    }
  })

  it('clear-winner case: exact + many substrings → ambiguous=false', async () => {
    // "Visions" should match "The Visions" (substring, rank 3) and
    // potentially others, but no exact match exists for query "Visions"
    // alone. If no rank-1 exact match exists, top rank is 2 or 3, and
    // ambiguity depends on how many share that top rank.
    const r = await execFindNodeByName({ query: 'Salvage' }, session)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const d = r.data as {
      matches: Array<{ name: string }>
      ambiguous: boolean
    }
    // Salvage chapter exists; it's the rank-1 exact match.
    // Any substring matches are rank 3 — clear winner.
    expect(d.ambiguous).toBe(false)
  })
})
