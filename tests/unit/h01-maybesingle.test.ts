// H-01 regression guards (round-3 audit batch B1.1).
//
// H-01 says: when zero rows is a valid result of a query, use
// `.maybeSingle()`, not `.single()`. The audit found three production
// wrappers in lib/data that use `.single()` on UPDATE-by-id paths where
// the row could legitimately be missing (concurrent delete between the
// route's pre-check and the wrapper's UPDATE):
//
//   F-144  lib/data/projects.ts   updateProject
//   F-148  lib/data/documents.ts  updateDocument
//   F-155  lib/data/nodes.ts      updateNode
//
// PostgREST's contract (mirrored by supabase-js):
//   .single():       on 0 rows, returns { data: null, error: PGRST116 }
//   .maybeSingle():  on 0 rows, returns { data: null, error: null }
//
// The H-01 contract is: a missing-row UPDATE must return a clean null,
// not an error, so the route can decide what to do (route-layer null
// guard maps to 404 not_found instead of conflating with internal error).
//
// Each test below mocks the supabase chain so the terminal method
// determines the returned shape. Before the fix the wrappers call
// `.single()`, the mock returns the PGRST116 error shape, and the
// assertion `expect(error).toBeNull()` fails. After the fix the wrappers
// call `.maybeSingle()`, the mock returns clean null, and the assertion
// passes.

import { describe, it, expect } from 'vitest'

import { updateProject } from '@/lib/data/projects'
import { updateDocument } from '@/lib/data/documents'
import { updateNode } from '@/lib/data/nodes'

// Minimal PostgREST response shapes — enough to satisfy the wrapper
// type assertions without pulling in the full supabase-js types.
const MISSING_ROW_SINGLE = {
  data: null,
  error: { code: 'PGRST116', message: 'No rows returned by .single()' },
}
const MISSING_ROW_MAYBE_SINGLE = {
  data: null,
  error: null,
}

// Mock supabase chain. Tracks which terminal was called so we can
// (a) return the appropriate shape and (b) assert in tests.
//
// The chain is built as a self-referential object: every fluent method
// returns the chain itself, and the two terminal methods (single,
// maybeSingle) resolve a Promise. The wrapper functions cast the chain
// through `as unknown as PostgrestSingleResponse` so the surface area
// the wrappers actually invoke is just from / select / update / eq /
// single / maybeSingle — no need for the full SupabaseClient surface.
type MockChain = {
  from:        () => MockChain
  select:      () => MockChain
  update:      () => MockChain
  eq:          () => MockChain
  single:      () => Promise<typeof MISSING_ROW_SINGLE>
  maybeSingle: () => Promise<typeof MISSING_ROW_MAYBE_SINGLE>
}

function makeMockClient() {
  let terminalCalled: 'single' | 'maybeSingle' | null = null

  const chain: MockChain = {
    from:   () => chain,
    select: () => chain,
    update: () => chain,
    eq:     () => chain,
    single: () => {
      terminalCalled = 'single'
      return Promise.resolve(MISSING_ROW_SINGLE)
    },
    maybeSingle: () => {
      terminalCalled = 'maybeSingle'
      return Promise.resolve(MISSING_ROW_MAYBE_SINGLE)
    },
  }

  return {
    // Wrappers expect a SupabaseClient<Database>; the mock implements
    // only the chain-call surface they exercise.
    client: chain as unknown as Parameters<typeof updateProject>[0],
    getTerminalCalled: () => terminalCalled,
  }
}

describe('H-01 — wrappers must use .maybeSingle() on UPDATE-by-id', () => {
  it('F-144: updateProject returns clean null on missing row', async () => {
    const { client, getTerminalCalled } = makeMockClient()
    const { data, error } = await updateProject(
      client,
      'non-existent-id',
      { name: 'Updated' },
    )

    // The H-01 contract: zero rows is not an error.
    expect(error).toBeNull()
    expect(data).toBeNull()
    // And specifically: the wrapper must call .maybeSingle().
    expect(getTerminalCalled()).toBe('maybeSingle')
  })

  it('F-148: updateDocument returns clean null on missing row', async () => {
    const { client, getTerminalCalled } = makeMockClient()
    const { data, error } = await updateDocument(
      client,
      'non-existent-id',
      { name: 'Updated' },
    )

    expect(error).toBeNull()
    expect(data).toBeNull()
    expect(getTerminalCalled()).toBe('maybeSingle')
  })

  it('F-155: updateNode returns clean null on missing row', async () => {
    const { client, getTerminalCalled } = makeMockClient()
    const { data, error } = await updateNode(
      client,
      'non-existent-id',
      { name: 'Updated' } as never,
    )

    expect(error).toBeNull()
    expect(data).toBeNull()
    expect(getTerminalCalled()).toBe('maybeSingle')
  })
})
