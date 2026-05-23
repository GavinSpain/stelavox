/**
 * M-179 — node_rename (was: create_rename_step write tool).
 *
 * History: M-179 originally introduced a `create_rename_step` tool as
 * part of the per-step write-tool pattern. Phase 3 of the create_*_step
 * deprecation refactor (2026-05-19) removed that tool — node_rename
 * now lives only as a step shape embedded inside propose_brief.
 *
 * Most of the original M-179 tests exercised execCreateRenameStep
 * directly (happy path, locked-node rejection, defensive validation,
 * etc.) — those checks are now part of propose_brief's per-step
 * validation, covered by tests/unit/m181-phase1-per-step-validation
 * (and by the v1.22 prompt + tool-suite registration tests).
 *
 * What survives in this file is the layer-3 DB invariant — renaming
 * a node is metadata-only and does NOT bump the content version
 * (matches TC-A-47 and the M-023 trigger exclusion). This is independent
 * of any specific write tool, so it's still useful as a regression
 * guard against the trigger drifting.
 */

import { describe, expect, it } from 'vitest'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54331'
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })
const hasServiceKey = SERVICE_KEY !== ''

describe.skipIf(!hasServiceKey)('node_rename DB invariant — rename does not bump version', () => {
  it('UPDATE nodes SET name does NOT bump version (matches TC-A-47 / M-023 exclusion)', async () => {
    // Pick any beat with prose so version > 1; rename it; assert
    // version is unchanged. Clean up by restoring original name.
    const { data: beat } = await svc
      .from('nodes')
      .select('id, name, version')
      .eq('document_id', '637acf44-38ab-42ad-b179-1d57844014b5')
      .eq('node_type', 'beat')
      .not('name', 'is', null)
      .limit(1)
      .maybeSingle()
    if (!beat) return

    const originalName = beat.name as string
    const originalVersion = beat.version as number
    const testName = `__M179_RENAME_${Date.now()}__`

    try {
      const { error } = await svc
        .from('nodes')
        .update({ name: testName })
        .eq('id', beat.id)
      expect(error).toBeNull()

      const { data: after } = await svc
        .from('nodes')
        .select('name, version')
        .eq('id', beat.id)
        .single()
      expect(after?.name).toBe(testName)
      expect(after?.version).toBe(originalVersion) // KEY INVARIANT
    } finally {
      await svc.from('nodes').update({ name: originalName }).eq('id', beat.id)
    }
  })
})
