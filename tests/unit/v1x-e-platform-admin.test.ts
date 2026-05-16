/**
 * V1.x-E.2 — isPlatformAdmin allowlist parsing + lookup.
 *
 * Pure unit test of the auth helper: feeds a fake supabase client that
 * returns canned getUser() responses + sets PLATFORM_ADMIN_EMAILS in
 * process.env; asserts the boolean outcome.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { isPlatformAdmin } from '@/lib/admin/isPlatformAdmin'

type FakeUser = { email: string | null } | null

function fakeSupabase(user: FakeUser): unknown {
  return {
    auth: {
      getUser: async () => ({ data: { user } }),
    },
  }
}

describe('isPlatformAdmin (V1.x-E.2)', () => {
  const originalEnv = process.env.PLATFORM_ADMIN_EMAILS

  beforeEach(() => {
    delete process.env.PLATFORM_ADMIN_EMAILS
  })

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.PLATFORM_ADMIN_EMAILS
    } else {
      process.env.PLATFORM_ADMIN_EMAILS = originalEnv
    }
  })

  it('returns false when allowlist env is empty', async () => {
    const sb = fakeSupabase({ email: 'admin@stelavox.local' }) as never
    expect(await isPlatformAdmin(sb)).toBe(false)
  })

  it('returns false when user is missing', async () => {
    process.env.PLATFORM_ADMIN_EMAILS = 'admin@stelavox.local'
    const sb = fakeSupabase(null) as never
    expect(await isPlatformAdmin(sb)).toBe(false)
  })

  it('returns false when user email is missing', async () => {
    process.env.PLATFORM_ADMIN_EMAILS = 'admin@stelavox.local'
    const sb = fakeSupabase({ email: null }) as never
    expect(await isPlatformAdmin(sb)).toBe(false)
  })

  it('returns true on case-insensitive email match', async () => {
    process.env.PLATFORM_ADMIN_EMAILS = 'Admin@Stelavox.local'
    const sb = fakeSupabase({ email: 'admin@stelavox.local' }) as never
    expect(await isPlatformAdmin(sb)).toBe(true)
  })

  it('returns true when one of multiple comma-separated entries matches', async () => {
    process.env.PLATFORM_ADMIN_EMAILS = 'a@x.com, b@y.com ,c@z.com'
    const sb = fakeSupabase({ email: 'b@y.com' }) as never
    expect(await isPlatformAdmin(sb)).toBe(true)
  })

  it('returns false when email is not in allowlist', async () => {
    process.env.PLATFORM_ADMIN_EMAILS = 'admin@stelavox.local'
    const sb = fakeSupabase({ email: 'random@stelavox.local' }) as never
    expect(await isPlatformAdmin(sb)).toBe(false)
  })

  it('ignores blank entries from trailing commas', async () => {
    process.env.PLATFORM_ADMIN_EMAILS = 'admin@stelavox.local,,,'
    const sb = fakeSupabase({ email: 'admin@stelavox.local' }) as never
    expect(await isPlatformAdmin(sb)).toBe(true)
  })
})
