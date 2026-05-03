import { readFileSync, existsSync } from 'fs'
import { resolve, dirname } from 'path'

function parseAndLoad(raw: string) {
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx < 1) continue
    const key = trimmed.slice(0, eqIdx).trim()
    const val = trimmed.slice(eqIdx + 1).trim()
    if (!process.env[key]) process.env[key] = val
  }
}

export function loadEnv() {
  let dir = process.cwd()
  for (let i = 0; i < 8; i++) {
    const candidate = resolve(dir, '.env.local')
    if (existsSync(candidate)) {
      try { parseAndLoad(readFileSync(candidate, 'utf-8')) } catch { /* ignore */ }
      return
    }
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
}
