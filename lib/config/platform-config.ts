import 'server-only'

import { createServiceRoleClient } from '@/lib/supabase/service'

const CONFIG_CACHE_TTL_MS = 60_000
const cache = new Map<string, { value: unknown; expiresAt: number }>()

export async function getConfig<T = unknown>(key: string): Promise<T> {
  const now = Date.now()
  const cached = cache.get(key)
  if (cached && cached.expiresAt > now) return cached.value as T

  const supabase = createServiceRoleClient()
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

export const getConfigInt    = (key: string) => getConfig<number>(key)
export const getConfigString = (key: string) => getConfig<string>(key)
export const getConfigBool   = (key: string) => getConfig<boolean>(key)
