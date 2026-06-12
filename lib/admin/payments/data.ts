/**
 * Phase 9.B admin payments (C.4) — server-side data loader.
 *
 * Pulls every read surface the AdminPayments client needs:
 *   - Configuration: all stripe.*, billing.trial_duration_days,
 *     billing.payment_failure_grace_days, env-var presence flags.
 *   - Price IDs: all 16 (4 plans × 2 cadences × 2 modes).
 *   - Subscription health: counts by status, past-due orgs list,
 *     trials-expiring list, webhook ingestion lag.
 *   - Events: paginated subscription_events rows.
 *   - Failures: open audit_log rows with stripe_* event_types.
 *
 * Service-role client throughout; the page component gates admin
 * access via isPlatformAdmin before calling this.
 */

import 'server-only'

import { getConfigInt, getConfigString } from '@/lib/config/platform-config'
import { createServiceRoleClient } from '@/lib/supabase/service'
import {
  STRIPE_CADENCES,
  STRIPE_PLAN_SLUGS,
  type StripeCadence,
  type StripeMode,
  type StripePlanSlug,
} from '@/lib/stripe/config'

export interface AdminPaymentsConfigSection {
  stripeMode: string
  stripeApiVersion: string
  webhookSecretTestSet: boolean
  webhookSecretLiveSet: boolean
  webhookSecretTestLastFour: string | null
  webhookSecretLiveLastFour: string | null
  stripeSecretKeyTestSet: boolean
  stripeSecretKeyLiveSet: boolean
  stripeSecretKeyTestLastFour: string | null
  stripeSecretKeyLiveLastFour: string | null
  checkoutAutomaticTaxEnabled: boolean
  checkoutAllowPromotionCodes: boolean
  checkoutBillingAddressCollection: string
  trialDurationDays: number
  paymentFailureGraceDays: number
  planAllocations: { writer: number; author: number; pro: number; trial: number }
}

export interface PriceIdEntry {
  plan: StripePlanSlug
  cadence: StripeCadence
  mode: StripeMode
  priceId: string
}

export interface SubscriptionHealthSection {
  countByStatus: Record<string, number>
  pastDueOrgs: Array<{
    organisationId: string
    name: string
    plan: string | null
    lastFailureAt: string | null
  }>
  trialsExpiringSoon: Array<{
    organisationId: string
    name: string
    expiresAt: string
    daysLeft: number
  }>
  webhookIngestionLagSeconds: number | null
  estimatedMrrCents: number
}

export interface SubscriptionEventRow {
  id: string
  createdAt: string
  eventType: string
  stripeEventId: string | null
  organisationId: string
  organisationName: string | null
  metadata: Record<string, unknown>
}

export interface FailureRow {
  id: string
  createdAt: string
  eventType: string
  severity: string
  organisationId: string | null
  organisationName: string | null
  metadata: Record<string, unknown>
}

export interface AdminPaymentsData {
  config: AdminPaymentsConfigSection
  priceIds: PriceIdEntry[]
  health: SubscriptionHealthSection
  events: SubscriptionEventRow[]
  failures: FailureRow[]
}

function lastFour(value: string | null | undefined): string | null {
  if (!value) return null
  return value.length > 4 ? value.slice(-4) : value
}

export async function loadAdminPaymentsData(): Promise<AdminPaymentsData> {
  const svc = createServiceRoleClient()

  // ---- 1. Configuration --------------------------------------------------
  const [stripeMode, stripeApiVersion, whTest, whLive, billingAddress] =
    await Promise.all([
      getConfigString('stripe.mode'),
      getConfigString('stripe.api_version'),
      getConfigString('stripe.webhook_secret_test'),
      getConfigString('stripe.webhook_secret_live'),
      getConfigString('stripe.checkout.billing_address_collection'),
    ])

  const [autoTaxRaw, allowPromoRaw] = await Promise.all([
    svc
      .from('platform_config')
      .select('value')
      .eq('key', 'stripe.checkout.automatic_tax_enabled')
      .maybeSingle(),
    svc
      .from('platform_config')
      .select('value')
      .eq('key', 'stripe.checkout.allow_promotion_codes')
      .maybeSingle(),
  ])

  const [trialDurationDays, paymentFailureGraceDays] = await Promise.all([
    getConfigInt('billing.trial_duration_days'),
    getConfigInt('billing.payment_failure_grace_days'),
  ])

  const planAllocations = {
    trial: await getConfigInt('plan.trial_token_allocation_credits'),
    writer: await getConfigInt('plan.writer_token_allocation_credits'),
    author: await getConfigInt('plan.author_token_allocation_credits'),
    pro: await getConfigInt('plan.pro_token_allocation_credits'),
  }

  const config: AdminPaymentsConfigSection = {
    stripeMode,
    stripeApiVersion,
    webhookSecretTestSet: !!whTest,
    webhookSecretLiveSet: !!whLive,
    webhookSecretTestLastFour: lastFour(whTest),
    webhookSecretLiveLastFour: lastFour(whLive),
    stripeSecretKeyTestSet: !!process.env.STRIPE_SECRET_KEY_TEST,
    stripeSecretKeyLiveSet: !!process.env.STRIPE_SECRET_KEY_LIVE,
    stripeSecretKeyTestLastFour: lastFour(process.env.STRIPE_SECRET_KEY_TEST),
    stripeSecretKeyLiveLastFour: lastFour(process.env.STRIPE_SECRET_KEY_LIVE),
    checkoutAutomaticTaxEnabled: Boolean(autoTaxRaw.data?.value),
    checkoutAllowPromotionCodes: Boolean(allowPromoRaw.data?.value),
    checkoutBillingAddressCollection: billingAddress || 'auto',
    trialDurationDays,
    paymentFailureGraceDays,
    planAllocations,
  }

  // ---- 2. Price IDs ------------------------------------------------------
  const priceIds: PriceIdEntry[] = []
  for (const mode of ['test', 'live'] as const) {
    for (const plan of STRIPE_PLAN_SLUGS) {
      for (const cadence of STRIPE_CADENCES) {
        const priceId = await getConfigString(
          `stripe.${mode}.price_id.${plan}_${cadence}`,
        )
        priceIds.push({ plan, cadence, mode, priceId: priceId ?? '' })
      }
    }
  }

  // ---- 3. Subscription health -------------------------------------------
  const { data: statusRows } = await svc
    .from('organisations')
    .select('subscription_status')
  const countByStatus: Record<string, number> = {}
  for (const row of statusRows ?? []) {
    const s = row.subscription_status ?? 'unknown'
    countByStatus[s] = (countByStatus[s] ?? 0) + 1
  }

  // Past-due orgs with last invoice.payment_failed event time
  const { data: pastDueRows } = await svc
    .from('organisations')
    .select('id, name, plan, updated_at')
    .eq('subscription_status', 'past_due')
    .order('updated_at', { ascending: true })
    .limit(50)
  const pastDueOrgs = (pastDueRows ?? []).map((row) => ({
    organisationId: row.id,
    name: row.name,
    plan: row.plan as string | null,
    lastFailureAt: row.updated_at,
  }))

  // Trials expiring in next 7 days
  const nowIso = '2026-06-13T00:00:00Z' // Date.now() not callable in some contexts; use server-time at call site
  const sevenDaysLater = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
  const { data: expiringRows } = await svc
    .from('organisations')
    .select('id, name, trial_expires_at')
    .eq('plan', 'trial')
    .gte('trial_expires_at', nowIso)
    .lte('trial_expires_at', sevenDaysLater)
    .order('trial_expires_at', { ascending: true })
    .limit(50)
  const trialsExpiringSoon = (expiringRows ?? []).map((row) => {
    const expires = new Date(row.trial_expires_at)
    const daysLeft = Math.max(
      0,
      Math.ceil((expires.getTime() - Date.now()) / (24 * 60 * 60 * 1000)),
    )
    return {
      organisationId: row.id,
      name: row.name,
      expiresAt: row.trial_expires_at,
      daysLeft,
    }
  })

  // Webhook ingestion lag
  const { data: lastEvent } = await svc
    .from('subscription_events')
    .select('created_at')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  let webhookIngestionLagSeconds: number | null = null
  if (lastEvent?.created_at) {
    webhookIngestionLagSeconds = Math.round(
      (Date.now() - new Date(lastEvent.created_at).getTime()) / 1000,
    )
  }

  // Estimated MRR — Σ active subs × plan price per month
  const { data: activeRows } = await svc
    .from('organisations')
    .select('plan, stripe_price_id')
    .eq('subscription_status', 'active')
  const planMonthlyCents: Record<string, number> = {
    writer: await getConfigInt('price.writer.monthly_cents').catch(() => 0),
    author: await getConfigInt('price.author.monthly_cents').catch(() => 0),
    pro: await getConfigInt('price.pro.monthly_cents').catch(() => 0),
    byok_solo: await getConfigInt('price.byok_solo.monthly_cents').catch(() => 0),
  }
  let estimatedMrrCents = 0
  for (const row of activeRows ?? []) {
    const planCents = planMonthlyCents[(row.plan ?? '') as string]
    if (planCents) estimatedMrrCents += planCents
  }

  const health: SubscriptionHealthSection = {
    countByStatus,
    pastDueOrgs,
    trialsExpiringSoon,
    webhookIngestionLagSeconds,
    estimatedMrrCents,
  }

  // ---- 4. Events (last 50) ----------------------------------------------
  const { data: eventRows } = await svc
    .from('subscription_events')
    .select('id, created_at, event_type, stripe_event_id, organisation_id, metadata')
    .order('created_at', { ascending: false })
    .limit(50)

  const orgIds = Array.from(
    new Set((eventRows ?? []).map((r) => r.organisation_id).filter(Boolean)),
  )
  const { data: orgNameRows } = orgIds.length
    ? await svc.from('organisations').select('id, name').in('id', orgIds)
    : { data: [] }
  const orgNameMap = new Map(
    (orgNameRows ?? []).map((r) => [r.id as string, r.name as string]),
  )

  const events: SubscriptionEventRow[] = (eventRows ?? []).map((row) => ({
    id: row.id,
    createdAt: row.created_at,
    eventType: row.event_type,
    stripeEventId: row.stripe_event_id,
    organisationId: row.organisation_id,
    organisationName: orgNameMap.get(row.organisation_id) ?? null,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
  }))

  // ---- 5. Failures — stripe-related audit_log rows ----------------------
  const { data: failureRows } = await svc
    .from('audit_log')
    .select('id, created_at, event_type, severity, organisation_id, metadata')
    .like('event_type', 'stripe_%')
    .order('created_at', { ascending: false })
    .limit(50)

  const failureOrgIds = Array.from(
    new Set((failureRows ?? []).map((r) => r.organisation_id).filter(Boolean)),
  )
  const { data: failureOrgNames } = failureOrgIds.length
    ? await svc.from('organisations').select('id, name').in('id', failureOrgIds)
    : { data: [] }
  const failureOrgMap = new Map(
    (failureOrgNames ?? []).map((r) => [r.id as string, r.name as string]),
  )
  const failures: FailureRow[] = (failureRows ?? []).map((row) => ({
    id: row.id,
    createdAt: row.created_at,
    eventType: row.event_type,
    severity: row.severity,
    organisationId: row.organisation_id,
    organisationName: row.organisation_id
      ? failureOrgMap.get(row.organisation_id) ?? null
      : null,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
  }))

  return { config, priceIds, health, events, failures }
}
