// H-01 regression guards (round-3 audit batches B1.1 + B1.2).
//
// H-01 says: when zero rows is a valid result of a query, use
// `.maybeSingle()`, not `.single()`. The audit found:
//
// Production wrappers (B1.1 — UPDATE-by-id paths where the row could
// legitimately be missing because of a concurrent delete between the
// route's pre-check and the wrapper's UPDATE):
//
//   F-144  lib/data/projects.ts   updateProject
//   F-148  lib/data/documents.ts  updateDocument
//   F-155  lib/data/nodes.ts      updateNode
//
// Test helpers (B1.2 — selecting an org row for a user who may not be
// in any organisation):
//
//   F-258  tests/helpers/db.ts                getOrgId
//   F-259  tests/helpers/agent-fixtures.ts    getOrgIdForUser
//
// PostgREST's contract (mirrored by supabase-js):
//   .single():       on 0 rows, returns { data: null, error: PGRST116 }
//   .maybeSingle():  on 0 rows, returns { data: null, error: null }
//
// The H-01 contract for B1.1 wrappers: a missing-row UPDATE must return
// a clean null so the route layer can map it to 404. The route-layer
// null guards live in app/api/projects/[projectId]/route.ts and
// app/api/documents/[documentId]/route.ts.
//
// The H-01 contract for B1.2 helpers: zero rows is valid (a user who
// is not yet in any org). `getOrgId` returns null cleanly. `getOrgIdForUser`
// has a non-nullable return contract, so it throws an informative error
// instead of the prior `data!` non-null-assertion crash.
//
// Each test below mocks the supabase chain so the terminal method
// determines the returned shape. Before the fix the wrappers call
// `.single()`, the mock returns the PGRST116 error shape, and the
// assertion fails. After the fix the wrappers call `.maybeSingle()`,
// the mock returns clean null, and the assertion passes.

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

describe('H-01 — wrappers must use .maybeSingle() on UPDATE-by-id (B1.1)', () => {
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

// ─── B1.2: tests/helpers H-01 violations ─────────────────────────────────
//
// The two helpers below run against a real supabase admin client in the
// test corpus. Their `adminClient()` factory reads from process.env, so
// to test them in isolation we stub the @supabase/supabase-js export
// `createClient` via vi.mock — every adminClient() call returns our mock.

import { vi } from 'vitest'

vi.mock('@supabase/supabase-js', async () => {
  const actual = await vi.importActual<typeof import('@supabase/supabase-js')>(
    '@supabase/supabase-js',
  )
  return {
    ...actual,
    createClient: vi.fn(),
  }
})

import { createClient as mockedCreateClient } from '@supabase/supabase-js'

describe('H-01 — test helpers must use .maybeSingle() on user→org lookup (B1.2)', () => {
  it('F-258: getOrgId returns null cleanly when user has no org membership', async () => {
    let terminalCalled: 'single' | 'maybeSingle' | null = null
    const chain: MockChain = {
      from:   () => chain,
      select: () => chain,
      update: () => chain,
      eq:     () => chain,
      single: () => { terminalCalled = 'single'; return Promise.resolve(MISSING_ROW_SINGLE) },
      maybeSingle: () => { terminalCalled = 'maybeSingle'; return Promise.resolve(MISSING_ROW_MAYBE_SINGLE) },
    }
    ;(mockedCreateClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(chain)

    const { getOrgId } = await import('@/tests/helpers/db')
    const result = await getOrgId('user-with-no-org')

    expect(result).toBeNull()
    expect(terminalCalled).toBe('maybeSingle')
  })

  it('F-259: getOrgIdForUser throws an informative error when user has no org membership', async () => {
    let terminalCalled: 'single' | 'maybeSingle' | null = null
    const chain: MockChain = {
      from:   () => chain,
      select: () => chain,
      update: () => chain,
      eq:     () => chain,
      single: () => { terminalCalled = 'single'; return Promise.resolve(MISSING_ROW_SINGLE) },
      maybeSingle: () => { terminalCalled = 'maybeSingle'; return Promise.resolve(MISSING_ROW_MAYBE_SINGLE) },
    }
    // getOrgIdForUser also calls adminClient().auth.admin.listUsers; stub
    // that path so the email→userId resolution succeeds.
    const fakeUserId = '00000000-0000-0000-0000-000000000001'
    const clientWithAuth = {
      ...chain,
      auth: {
        admin: {
          listUsers: () => Promise.resolve({
            data: { users: [{ id: fakeUserId, email: 'no-org@example.com' }] },
          }),
        },
      },
    }
    ;(mockedCreateClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(clientWithAuth)

    const { getOrgIdForUser } = await import('@/tests/helpers/agent-fixtures')

    // Pre-fix code did `data!.organisation_id` and crashed with
    // "Cannot read properties of null (reading 'organisation_id')".
    // Post-fix throws an informative error message naming the email.
    await expect(getOrgIdForUser('no-org@example.com')).rejects.toThrow(
      /no-org@example\.com/,
    )
    expect(terminalCalled).toBe('maybeSingle')
  })
})
