import { redirect } from 'next/navigation'

import { PlanPanel, type TierRow } from '@/components/billing/PlanPanel'
import { getConfigInt } from '@/lib/config/platform-config'
import { createClient } from '@/lib/supabase/server'

/**
 * V1.x-D — /settings/plan.
 *
 * Read-only V1 plan surface. Resolves the user's primary org server-side
 * (same precedence as /settings/usage and /settings/org-api-keys), reads
 * the org's plan + period start + BYOK key status, and pulls plan-tier
 * prices + allocations from platform_config. Hands the assembled tier
 * data to the PlanPanel client component.
 */

const PLATFORM_TIERS: Array<{ slug: string; name: string; description: string }> = [
  {
    slug: 'trial',
    name: 'Trial',
    description: 'Full access for 30 days. No card required.',
  },
  {
    slug: 'writer',
    name: 'Writer',
    description: 'Regular short-form or occasional long-form work.',
  },
  {
    slug: 'author',
    name: 'Author',
    description: 'Intensive long-form work; a full novel in active writing mode.',
  },
  {
    slug: 'pro',
    name: 'Pro',
    description: 'Heavy daily use across multiple active projects.',
  },
]

const BYOK_TIERS: Array<{ slug: string; name: string; description: string }> = [
  {
    slug: 'byok_solo',
    name: 'BYOK Solo',
    description:
      "Use your own Anthropic or other provider API key. Stelavox charges only for platform access; your provider bills you for usage. No platform credit cap.",
  },
  {
    slug: 'byok_team',
    name: 'BYOK Team',
    description: 'Same BYOK model, multi-seat. Each seat counts toward the per-seat rate.',
  },
]

async function safeConfigInt(key: string, fallback: number): Promise<number> {
  try {
    return await getConfigInt(key)
  } catch {
    return fallback
  }
}

export default async function PlanSettingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: memberships } = await supabase
    .from('organisation_members')
    .select('organisation_id, role, joined_at')
    .eq('user_id', user.id)

  const sorted = (memberships ?? []).slice().sort((a, b) => {
    const rolePriority = (r: string) => (r === 'owner' ? 0 : r === 'admin' ? 1 : r === 'member' ? 2 : 3)
    const ra = rolePriority(a.role)
    const rb = rolePriority(b.role)
    if (ra !== rb) return ra - rb
    return new Date(a.joined_at).getTime() - new Date(b.joined_at).getTime()
  })
  const orgId = sorted[0]?.organisation_id ?? null

  let currentPlan = 'trial'
  let currentPeriodStart: string | null = null
  let daysRemaining: number | null = null
  let trialDaysRemaining: number | null = null
  let byokKeyPresent = false
  let byokKeyLastValidatedAt: string | null = null
  let byokKeyLastFour: string | null = null

  // This file is a Next.js Server Component — it renders once per
  // request, not on a client re-render. The react-x/no-impure-render
  // rule's idempotency-during-render concern doesn't apply: there's
  // no "subsequent render" that could produce a different result.
  // Date.now() at request-render time is the intended behaviour.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now()
  const periodLengthDays = await safeConfigInt('plan.period_length_days', 30)

  if (orgId) {
    const { data: org } = await supabase
      .from('organisations')
      .select(
        'plan, current_period_start, byok_api_key_vault_id, byok_api_key_last_four, byok_api_key_last_validated_at',
      )
      .eq('id', orgId)
      .maybeSingle()
    if (org) {
      currentPlan = org.plan ?? 'trial'
      currentPeriodStart = org.current_period_start
      if (currentPeriodStart) {
        const start = new Date(currentPeriodStart)
        const end = new Date(start.getTime() + periodLengthDays * 24 * 60 * 60 * 1000)
        const ms = end.getTime() - now
        daysRemaining = Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)))
        if (currentPlan === 'trial') {
          trialDaysRemaining = daysRemaining
        }
      }
      byokKeyPresent = !!org.byok_api_key_vault_id
      byokKeyLastFour = (org.byok_api_key_last_four as string | null) ?? null
      byokKeyLastValidatedAt = (org.byok_api_key_last_validated_at as string | null) ?? null
    }
  }

  // Pull prices + allocations from platform_config.
  const [
    writerCents,
    authorCents,
    proCents,
    byokSoloCents,
    byokTeamCents,
    annualDiscountPct,
    trialAlloc,
    writerAlloc,
    authorAlloc,
    proAlloc,
  ] = await Promise.all([
    safeConfigInt('price.writer.monthly_cents', 2000),
    safeConfigInt('price.author.monthly_cents', 5000),
    safeConfigInt('price.pro.monthly_cents', 12000),
    safeConfigInt('price.byok_solo.monthly_cents', 1500),
    safeConfigInt('price.byok_team.monthly_cents', 3500),
    safeConfigInt('price.annual_discount_percent', 20),
    safeConfigInt('plan.trial_token_allocation_credits', 1_000_000),
    safeConfigInt('plan.writer_token_allocation_credits', 1_000_000),
    safeConfigInt('plan.author_token_allocation_credits', 4_000_000),
    safeConfigInt('plan.pro_token_allocation_credits', 16_000_000),
  ])

  const yearlyCents = (monthlyCents: number): number =>
    Math.round(monthlyCents * 12 * (1 - annualDiscountPct / 100))

  const allocationLabel = (credits: number, period: string): string =>
    `${credits.toLocaleString()} credits${period ? ` · ${period}` : ''}`

  const monthlyByPlan: Record<string, number> = {
    trial: 0,
    writer: writerCents,
    author: authorCents,
    pro: proCents,
    byok_solo: byokSoloCents,
    byok_team: byokTeamCents,
  }
  const allocationByPlan: Record<string, number | null> = {
    trial: trialAlloc,
    writer: writerAlloc,
    author: authorAlloc,
    pro: proAlloc,
    byok_solo: null,
    byok_team: null,
  }
  const allocationLabelByPlan: Record<string, string> = {
    trial: allocationLabel(trialAlloc, 'full period'),
    writer: allocationLabel(writerAlloc, '/ month'),
    author: allocationLabel(authorAlloc, '/ month'),
    pro: allocationLabel(proAlloc, '/ month'),
    byok_solo: 'Single user · unlimited (provider rate limits govern)',
    byok_team: '2+ seats · per-seat pricing',
  }

  const platformTierRows: TierRow[] = PLATFORM_TIERS.map((t) => ({
    slug: t.slug,
    name: t.name,
    group: 'platform' as const,
    monthly_cents: monthlyByPlan[t.slug] ?? 0,
    yearly_cents: yearlyCents(monthlyByPlan[t.slug] ?? 0),
    allocation_credits: allocationByPlan[t.slug] ?? null,
    description: t.description,
    allocation_label: allocationLabelByPlan[t.slug],
    current: t.slug === currentPlan,
  }))
  const byokTierRows: TierRow[] = BYOK_TIERS.map((t) => ({
    slug: t.slug,
    name: t.name,
    group: 'byok' as const,
    monthly_cents: monthlyByPlan[t.slug] ?? 0,
    yearly_cents: yearlyCents(monthlyByPlan[t.slug] ?? 0),
    allocation_credits: allocationByPlan[t.slug] ?? null,
    description: t.description,
    allocation_label: allocationLabelByPlan[t.slug],
    current: t.slug === currentPlan,
  }))
  const tiers = [...platformTierRows, ...byokTierRows]

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '24px 32px' }}>
      <div style={{ marginBottom: 16 }}>
        <a
          href="/settings"
          style={{
            fontSize: 12,
            color: 'var(--color-text-secondary)',
            textDecoration: 'none',
            fontFamily: 'var(--font-inter), Inter, sans-serif',
          }}
        >
          ← Settings
        </a>
      </div>
      <h1
        style={{
          fontFamily: 'var(--font-inter), Inter, sans-serif',
          fontSize: 22,
          fontWeight: 500,
          margin: '0 0 6px',
          color: 'var(--color-text-primary)',
        }}
      >
        Plan
      </h1>
      <div
        style={{
          fontSize: 12,
          color: 'var(--color-text-muted)',
          marginBottom: 20,
          fontFamily: 'var(--font-inter), Inter, sans-serif',
        }}
      >
        Subscriptions, allocations and BYOK eligibility. Read-only in V1 — upgrades through
        Stripe arrive in V2.
      </div>
      {orgId ? (
        <PlanPanel
          currentPlan={currentPlan}
          currentPeriodStart={currentPeriodStart}
          daysRemaining={daysRemaining}
          byokKeyPresent={byokKeyPresent}
          byokKeyLastValidatedAt={byokKeyLastValidatedAt}
          byokKeyLastFour={byokKeyLastFour}
          trialDaysRemaining={trialDaysRemaining}
          tiers={tiers}
        />
      ) : (
        <div
          style={{
            padding: 16,
            fontFamily: 'var(--font-inter), Inter, sans-serif',
            fontSize: 13,
            color: 'var(--color-text-secondary)',
          }}
        >
          You don&apos;t belong to any organisation yet.
        </div>
      )}
    </div>
  )
}
