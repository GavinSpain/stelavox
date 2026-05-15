/**
 * V1.x-C.3 — per-org BYOK routing unit tests.
 *
 * Source: stelavox_v1x_c_build_checklist_v1_0.md §6 CK-7 + §3 C.3.
 *
 * Covers the BYOK-detection helpers used by lib/llm/factory.ts's Option A
 * precedence layer:
 *   - userHasByokKey now filters out deprecated_at != NULL rows
 *   - orgHasByokKey returns true iff byok_enabled AND vault id is set
 *
 * Factory itself is `import 'server-only'` so direct loading from Playwright
 * isn't viable; these unit tests exercise the helper-level decisions that
 * compose the factory's precedence.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/service', () => ({
  createServiceRoleClient: vi.fn(),
}))

import { createServiceRoleClient } from '@/lib/supabase/service'

const mockedCreateClient = createServiceRoleClient as unknown as ReturnType<typeof vi.fn>

/**
 * Build a flexible mock supabase client. The two helpers in scope use
 * different chains:
 *   - userHasByokKey: select().eq().is() → { count, error }
 *   - orgHasByokKey: select().eq().maybeSingle() → { data, error }
 */
function buildClient(opts: {
  userKeyCount?: number
  userKeyError?: { message: string } | null
  orgRow?: { byok_enabled: boolean | null; byok_api_key_vault_id: string | null } | null
  orgError?: { message: string } | null
}) {
  let lastShape: 'user' | 'org' = 'user'
  const chain: Record<string, unknown> = {}
  chain.from = (table: string) => {
    lastShape = table === 'organisations' ? 'org' : 'user'
    return chain
  }
  chain.select = () => chain
  chain.eq = () => chain
  chain.is = () =>
    Promise.resolve({
      count: opts.userKeyCount ?? 0,
      error: opts.userKeyError ?? null,
    })
  chain.maybeSingle = () => {
    if (lastShape === 'org') {
      return Promise.resolve({ data: opts.orgRow ?? null, error: opts.orgError ?? null })
    }
    return Promise.resolve({ data: null, error: null })
  }
  return chain as unknown as ReturnType<typeof createServiceRoleClient>
}

describe('V1.x-C.3 — userHasByokKey filters out deprecated rows', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns true when count > 0 (non-deprecated rows exist)', async () => {
    mockedCreateClient.mockReturnValue(buildClient({ userKeyCount: 1 }))
    const { userHasByokKey } = await import('@/lib/llm/byok')
    const result = await userHasByokKey(
      createServiceRoleClient() as unknown as Parameters<typeof userHasByokKey>[0],
      '00000000-0000-0000-0000-000000000001',
    )
    expect(result).toBe(true)
  })

  it('returns false when count is 0 (deprecated rows filtered, none active)', async () => {
    mockedCreateClient.mockReturnValue(buildClient({ userKeyCount: 0 }))
    const { userHasByokKey } = await import('@/lib/llm/byok')
    const result = await userHasByokKey(
      createServiceRoleClient() as unknown as Parameters<typeof userHasByokKey>[0],
      '00000000-0000-0000-0000-000000000001',
    )
    expect(result).toBe(false)
  })

  it('returns false on query error (defensive — fall through to platform)', async () => {
    mockedCreateClient.mockReturnValue(
      buildClient({ userKeyCount: 0, userKeyError: { message: 'db unavailable' } }),
    )
    const { userHasByokKey } = await import('@/lib/llm/byok')
    const result = await userHasByokKey(
      createServiceRoleClient() as unknown as Parameters<typeof userHasByokKey>[0],
      '00000000-0000-0000-0000-000000000001',
    )
    expect(result).toBe(false)
  })
})

describe('V1.x-C.3 — orgHasByokKey routes by enabled + vault presence', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('returns true when byok_enabled AND vault id are both set', async () => {
    mockedCreateClient.mockReturnValue(
      buildClient({
        orgRow: { byok_enabled: true, byok_api_key_vault_id: 'some-vault-uuid' },
      }),
    )
    const { orgHasByokKey } = await import('@/lib/byok/orgKey')
    const result = await orgHasByokKey(
      createServiceRoleClient() as unknown as Parameters<typeof orgHasByokKey>[0],
      'org-1',
    )
    expect(result).toBe(true)
  })

  it('returns false when byok_enabled is true but no vault id (pre-enable + no key uploaded)', async () => {
    mockedCreateClient.mockReturnValue(
      buildClient({
        orgRow: { byok_enabled: true, byok_api_key_vault_id: null },
      }),
    )
    const { orgHasByokKey } = await import('@/lib/byok/orgKey')
    const result = await orgHasByokKey(
      createServiceRoleClient() as unknown as Parameters<typeof orgHasByokKey>[0],
      'org-1',
    )
    expect(result).toBe(false)
  })

  it('returns false when vault id is set but byok_enabled is false (admin paused)', async () => {
    mockedCreateClient.mockReturnValue(
      buildClient({
        orgRow: { byok_enabled: false, byok_api_key_vault_id: 'some-vault-uuid' },
      }),
    )
    const { orgHasByokKey } = await import('@/lib/byok/orgKey')
    const result = await orgHasByokKey(
      createServiceRoleClient() as unknown as Parameters<typeof orgHasByokKey>[0],
      'org-1',
    )
    expect(result).toBe(false)
  })

  it('returns false when row not found', async () => {
    mockedCreateClient.mockReturnValue(buildClient({ orgRow: null }))
    const { orgHasByokKey } = await import('@/lib/byok/orgKey')
    const result = await orgHasByokKey(
      createServiceRoleClient() as unknown as Parameters<typeof orgHasByokKey>[0],
      'org-not-found',
    )
    expect(result).toBe(false)
  })

  it('returns false on query error', async () => {
    mockedCreateClient.mockReturnValue(
      buildClient({ orgRow: null, orgError: { message: 'db unavailable' } }),
    )
    const { orgHasByokKey } = await import('@/lib/byok/orgKey')
    const result = await orgHasByokKey(
      createServiceRoleClient() as unknown as Parameters<typeof orgHasByokKey>[0],
      'org-1',
    )
    expect(result).toBe(false)
  })
})
