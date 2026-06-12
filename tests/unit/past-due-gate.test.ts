/**
 * Phase 9.B admin payments (C.2) — past-due gate.
 *
 * Author lock 2026-06-12: "no LLM access without a valid subscription".
 * Implementation per D4.c — defence-in-depth at both the credit gate
 * (lib/llm/token-budget.ts) AND the layout (app/(app)/layout.tsx).
 * This file pins the credit-gate behaviour.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient } from '@supabase/supabase-js'

import { checkTokenBudget } from '@/lib/llm/token-budget'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54331'
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const hasServiceKey = SERVICE_KEY !== ''
const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

describe.skipIf(!hasServiceKey)('past-due credit-gate (C.2)', () => {
  let testOrgId: string

  beforeAll(async () => {
    const stamp = Date.now()
    const { data: org, error } = await svc
      .from('organisations')
      .insert({
        name: `past-due test org ${stamp}`,
        slug: `pd-${stamp}`,
        plan: 'writer',
        token_allocation_credits: 1_000_000,
        token_usage_credits: 0,
        subscription_status: 'active',
      })
      .select('id')
      .single()
    if (error || !org) throw new Error(`seed failed: ${error?.message}`)
    testOrgId = org.id
  })

  afterAll(async () => {
    if (testOrgId) {
      await svc.from('organisations').delete().eq('id', testOrgId)
    }
  })

  it('allows dispatch when subscription_status is active', async () => {
    await svc
      .from('organisations')
      .update({ subscription_status: 'active' })
      .eq('id', testOrgId)

    const allowed = await checkTokenBudget(
      { id: testOrgId, plan: 'writer', current_period_start: null },
      1000,
      'claude-sonnet-4-6',
    )
    expect(allowed).toBe(true)
  })

  it('refuses dispatch when subscription_status is past_due (NEW C.2 rule)', async () => {
    await svc
      .from('organisations')
      .update({ subscription_status: 'past_due' })
      .eq('id', testOrgId)

    const allowed = await checkTokenBudget(
      { id: testOrgId, plan: 'writer', current_period_start: null },
      1000,
      'claude-sonnet-4-6',
    )
    expect(allowed).toBe(false)
  })

  it('refuses dispatch even with plenty of credits when past_due', async () => {
    // Set huge allocation but past_due — should still refuse.
    await svc
      .from('organisations')
      .update({
        subscription_status: 'past_due',
        token_allocation_credits: 1_000_000_000,
        token_usage_credits: 0,
      })
      .eq('id', testOrgId)

    const allowed = await checkTokenBudget(
      { id: testOrgId, plan: 'writer', current_period_start: null },
      1000,
      'claude-sonnet-4-6',
    )
    expect(allowed).toBe(false)
  })

  it('allows dispatch when status flips back to active', async () => {
    await svc
      .from('organisations')
      .update({
        subscription_status: 'active',
        token_allocation_credits: 1_000_000,
        token_usage_credits: 0,
      })
      .eq('id', testOrgId)

    const allowed = await checkTokenBudget(
      { id: testOrgId, plan: 'writer', current_period_start: null },
      1000,
      'claude-sonnet-4-6',
    )
    expect(allowed).toBe(true)
  })
})
