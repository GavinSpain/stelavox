// Platform config — canonical entry point for operational tunables (TA §3.7,
// H-12). All mutable system parameters (token budgets, prices, model IDs,
// timeouts, limits) live in the `platform_config` table and are read here.
//
// Cache: in-memory, 60s TTL, process-local. The TTL is the one hardcoded
// constant H-12 *allows* — bootstrap chicken-and-egg (the cache config
// would itself need fetching from a cache).
//
// F-07 (round-3 audit): the four typed aliases below do *runtime* type
// validation, throwing a clear error when the stored JSONB value does not
// match the alias's claimed type. Pre-fix, the aliases were unchecked
// generic casts: a string "5" stored against an int-typed key would flow
// through `getConfigInt` as `"5" as number` and silently misbehave in
// downstream arithmetic (string-concat, JS-coerced comparison). The
// post-fix throw names the key, so misconfigurations surface clearly at
// the read site rather than as garbled output downstream.

import 'server-only'

import { createServiceRoleClient } from '@/lib/supabase/service'

const CONFIG_CACHE_TTL_MS = 60_000
const cache = new Map<string, { value: unknown; expiresAt: number }>()

export async function getConfig<T = unknown>(key: string): Promise<T> {
  const now = Date.now()
  const cached = cache.get(key)
  if (cached && cached.expiresAt > now) return cached.value as T

  const supabase = createServiceRoleClient()
  // .single(): `key` is the table's PRIMARY KEY, so zero rows is
  // genuinely an error here (caller throws ConfigNotFound). H-01 doesn't
  // apply to PK lookups where the row's existence is precondition.
  const { data, error } = await supabase
    .from('platform_config')
    .select('value')
    .eq('key', key)
    .single()

  if (error || !data) throw new Error(`Platform config key not found: ${key}`)

  const value = data.value as T
  cache.set(key, { value, expiresAt: now + CONFIG_CACHE_TTL_MS })
  return value
}

// F-07 (round-3 audit): runtime-validated typed aliases. Each throws a
// clear, key-naming error when the stored JSONB type mismatches the
// alias's declared return type. JSONB natively distinguishes
// number / string / boolean / object / null, so a wrong-type stored
// value (e.g. `"5"` instead of `5`) is unambiguous at this layer.

export async function getConfigInt(key: string): Promise<number> {
  const v = await getConfig<unknown>(key)
  if (typeof v !== 'number' || !Number.isInteger(v)) {
    throw new Error(
      `Platform config '${key}' expected integer, got ${typeof v}: ${JSON.stringify(v)}`,
    )
  }
  return v
}

export async function getConfigNumber(key: string): Promise<number> {
  const v = await getConfig<unknown>(key)
  if (typeof v !== 'number' || Number.isNaN(v)) {
    throw new Error(
      `Platform config '${key}' expected number, got ${typeof v}: ${JSON.stringify(v)}`,
    )
  }
  return v
}

export async function getConfigString(key: string): Promise<string> {
  const v = await getConfig<unknown>(key)
  if (typeof v !== 'string') {
    throw new Error(
      `Platform config '${key}' expected string, got ${typeof v}: ${JSON.stringify(v)}`,
    )
  }
  return v
}

export async function getConfigBool(key: string): Promise<boolean> {
  const v = await getConfig<unknown>(key)
  if (typeof v !== 'boolean') {
    throw new Error(
      `Platform config '${key}' expected boolean, got ${typeof v}: ${JSON.stringify(v)}`,
    )
  }
  return v
}
