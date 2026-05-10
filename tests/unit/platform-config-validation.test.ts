// B2.1 — round-3 audit F-07 (and cascade F-20).
//
// F-07: getConfig<T>() does an unchecked `data.value as T` cast. The four
// typed aliases (getConfigInt, getConfigNumber, getConfigString,
// getConfigBool) are all the same generic call; *none* coerce or validate.
// If platform_config stores `"5"` (string) where 5 (number) is expected,
// callers receive `"5" as number` and downstream arithmetic / comparisons
// silently misbehave (string-concatenation, JS-coerced comparison, etc.).
//
// F-20 cascade: token-budget.ts uses getConfigInt('token_budget.<plan>')
// then does `used + estimatedTokens <= budget`. With a string-typed
// budget, JS does lexicographic comparison — silent budget bypass or
// false-positive over-limit. Explicitly noted in the audit text:
// "Compounds with F-07. Worth fixing F-07 first; this site falls out
// automatically."
//
// Failing-test-first protocol:
//   Test 1 (F-07 directly) — store a string "5" against an int-typed
//     key; getConfigInt() must throw a clear error naming the key, not
//     silently return "5".
//   Test 2 (F-07 directly) — store a number 5 against an int-typed key;
//     getConfigInt() must return 5 (happy path unchanged).
//   Test 3 (F-20 cascade) — store a string "500000" against
//     'token_budget.starter'; checkTokenBudget must throw the same
//     clear error from F-07's fix, not silently treat the string as a
//     number.
//
// Pre-fix: tests 1 and 3 fail (no throw, wrong-typed value returned).
// Post-fix: all three pass.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/service', () => ({
  createServiceRoleClient: vi.fn(),
}))

import { createServiceRoleClient } from '@/lib/supabase/service'

const mockedCreateClient = createServiceRoleClient as unknown as ReturnType<typeof vi.fn>

// Build a chain whose .single() resolves with a configurable value cell.
// The platform_config wrapper structure is:
//   supabase.from('platform_config').select('value').eq('key', key).single()
// → { data: { value: <stored> }, error: null }
function buildChainReturning(stored: unknown) {
  const chain = {
    from: () => chain,
    select: () => chain,
    eq: () => chain,
    single: () => Promise.resolve({ data: { value: stored }, error: null }),
  }
  return chain as unknown as ReturnType<typeof createServiceRoleClient>
}

describe('B2.1 — F-07: getConfig typed aliases must runtime-validate', () => {
  beforeEach(async () => {
    // Reset the module-scoped cache between tests by reloading the
    // module (the cache lives in module scope — there is no clear()
    // export — so vi.resetModules() is the cleanest reset).
    vi.resetModules()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('getConfigInt throws when platform_config stores a string where an integer is expected', async () => {
    mockedCreateClient.mockReturnValue(buildChainReturning('5')) // string!
    const { getConfigInt } = await import('@/lib/config/platform-config')

    await expect(getConfigInt('test.int_key')).rejects.toThrow(/test\.int_key/)
  })

  it('getConfigInt returns the value when platform_config stores a real integer', async () => {
    mockedCreateClient.mockReturnValue(buildChainReturning(5))
    const { getConfigInt } = await import('@/lib/config/platform-config')

    await expect(getConfigInt('test.int_key')).resolves.toBe(5)
  })

  it('getConfigString throws when platform_config stores a number where a string is expected', async () => {
    mockedCreateClient.mockReturnValue(buildChainReturning(42))
    const { getConfigString } = await import('@/lib/config/platform-config')

    await expect(getConfigString('test.string_key')).rejects.toThrow(/test\.string_key/)
  })

  it('getConfigBool throws when platform_config stores a string where a boolean is expected', async () => {
    mockedCreateClient.mockReturnValue(buildChainReturning('true'))
    const { getConfigBool } = await import('@/lib/config/platform-config')

    await expect(getConfigBool('test.bool_key')).rejects.toThrow(/test\.bool_key/)
  })

  it('getConfigNumber accepts integers and floats but throws on non-numeric strings', async () => {
    // Integer fine
    mockedCreateClient.mockReturnValue(buildChainReturning(3))
    const cfg1 = await import('@/lib/config/platform-config')
    await expect(cfg1.getConfigNumber('test.num_key')).resolves.toBe(3)

    // Float fine
    vi.resetModules()
    mockedCreateClient.mockReturnValue(buildChainReturning(3.14))
    const cfg2 = await import('@/lib/config/platform-config')
    await expect(cfg2.getConfigNumber('test.num_key')).resolves.toBe(3.14)

    // String NOT fine
    vi.resetModules()
    mockedCreateClient.mockReturnValue(buildChainReturning('3'))
    const cfg3 = await import('@/lib/config/platform-config')
    await expect(cfg3.getConfigNumber('test.num_key')).rejects.toThrow(/test\.num_key/)
  })

  it('F-20 cascade: checkTokenBudget surfaces the F-07 type error rather than silently misbehaving', async () => {
    // platform_config stores the budget as a STRING — the audit's exact
    // F-07/F-20 scenario.
    mockedCreateClient.mockReturnValue(buildChainReturning('500000'))

    const { checkTokenBudget } = await import('@/lib/llm/token-budget')
    await expect(
      checkTokenBudget(
        { id: 'org-x', plan: 'starter', current_period_start: null },
        100_000,
      ),
    ).rejects.toThrow(/token_budget\.starter/)
  })
})
