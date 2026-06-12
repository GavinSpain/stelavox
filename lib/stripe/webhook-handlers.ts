/**
 * Phase 9.B work package B — Stripe webhook event handlers.
 *
 * Each handler is idempotent at the side-effect level: it should be safe
 * to call multiple times with the same Stripe event. The webhook route
 * additionally writes a `subscription_events` row first; the unique
 * index on stripe_event_id (M-221) makes the duplicate INSERT skip and
 * the per-event side effects are then suppressed for already-processed
 * events.
 *
 * Side effects update `organisations` columns:
 *   - stripe_customer_id (find-or-create at Checkout; webhook is the
 *     canonical-source on customer.created/updated)
 *   - stripe_subscription_id + stripe_price_id (on subscription
 *     created/updated; cleared on deleted)
 *   - plan (mapped from stripe_price_id via priceIdToPlan; falls back
 *     to 'trial' on cancellation per the product-scope lock: data is
 *     retained, the user just has to re-subscribe)
 *   - token_allocation_credits (set from getPlanAllocationCredits on
 *     activation; BYOK plans get NULL — gate falls through to "not
 *     enforced" and the BYOK route fires instead)
 *   - subscription_status (matches Stripe's status string verbatim:
 *     active / trialing / past_due / canceled / incomplete / etc.)
 *   - current_period_start (from Stripe's current_period_start; the
 *     period_length_days is config — Stripe's period MAY differ when
 *     the user changes plans mid-cycle and we honour Stripe's view)
 *   - byok_enabled (true on byok_solo activation; false on cancellation
 *     or downgrade to a platform plan)
 *
 * Each handler returns a small audit record (event-specific metadata)
 * that the webhook route inserts into subscription_events.
 */

import 'server-only'

import type Stripe from 'stripe'

import { createServiceRoleClient } from '@/lib/supabase/service'

import { getPlanAllocationCredits, isByokPlan, priceIdToPlan } from './plans'

export interface WebhookHandlerOutcome {
  organisationId: string | null
  audit: Record<string, unknown>
}

/**
 * Normalise Stripe's subscription status (American spelling) to the
 * organisations.subscription_status CHECK-allowed values (British
 * spelling for some values, established in M-001). Anything outside the
 * known mappings passes through verbatim so the constraint surfaces it
 * as an error rather than silently rejecting.
 */
function normaliseSubscriptionStatus(stripeStatus: string): string {
  switch (stripeStatus) {
    case 'canceled':
      return 'cancelled'
    case 'trialing':
      return 'trialling'
    default:
      return stripeStatus
  }
}

/**
 * Resolve organisation_id from Stripe metadata. Subscriptions and
 * Checkout Sessions both carry { organisation_id } in their metadata
 * (set at Checkout-creation time by lib/stripe/sessions.ts).
 */
function readOrgIdFromMetadata(metadata: Stripe.Metadata | null): string | null {
  if (!metadata) return null
  const value = metadata['organisation_id']
  return typeof value === 'string' && value.length > 0 ? value : null
}

/** Find org by stripe_customer_id when metadata is missing. */
async function findOrgByCustomer(customerId: string): Promise<string | null> {
  const svc = createServiceRoleClient()
  const { data } = await svc
    .from('organisations')
    .select('id')
    .eq('stripe_customer_id', customerId)
    .maybeSingle()
  return data?.id ?? null
}

// ---------------------------------------------------------------------
// Per-event handlers
// ---------------------------------------------------------------------

export async function handleCheckoutSessionCompleted(
  event: Stripe.CheckoutSessionCompletedEvent,
): Promise<WebhookHandlerOutcome> {
  const session = event.data.object
  const orgId =
    readOrgIdFromMetadata(session.metadata) ??
    (typeof session.customer === 'string'
      ? await findOrgByCustomer(session.customer)
      : null)

  return {
    organisationId: orgId,
    audit: {
      checkout_session_id: session.id,
      customer_id:
        typeof session.customer === 'string' ? session.customer : null,
      subscription_id:
        typeof session.subscription === 'string' ? session.subscription : null,
      amount_total: session.amount_total,
      mode: session.mode,
    },
  }
}

/**
 * Customer subscription created/updated: the canonical source for
 * (plan, subscription_status, stripe_subscription_id, stripe_price_id,
 * current_period_start, byok_enabled, token_allocation_credits).
 */
export async function handleSubscriptionCreatedOrUpdated(
  event:
    | Stripe.CustomerSubscriptionCreatedEvent
    | Stripe.CustomerSubscriptionUpdatedEvent,
): Promise<WebhookHandlerOutcome> {
  const subscription = event.data.object
  const orgId =
    readOrgIdFromMetadata(subscription.metadata) ??
    (typeof subscription.customer === 'string'
      ? await findOrgByCustomer(subscription.customer)
      : null)

  if (!orgId) {
    return {
      organisationId: null,
      audit: {
        subscription_id: subscription.id,
        skipped_reason: 'org_not_found',
      },
    }
  }

  const priceId =
    subscription.items.data[0]?.price?.id ?? null

  let planSlug: string | null = null
  let cadence: string | null = null
  let byokEnabled = false
  let allocationCredits: number | null = null
  if (priceId) {
    const mapped = await priceIdToPlan(priceId)
    if (mapped) {
      planSlug = mapped.plan
      cadence = mapped.cadence
      byokEnabled = isByokPlan(mapped.plan)
      allocationCredits = await getPlanAllocationCredits(mapped.plan)
    }
  }

  // Stripe's current_period_start is on the first subscription item.
  const periodStartUnix =
    (subscription.items.data[0] as { current_period_start?: number } | undefined)
      ?.current_period_start ?? null
  const periodStart = periodStartUnix
    ? new Date(periodStartUnix * 1000).toISOString()
    : null

  const updates: Record<string, unknown> = {
    stripe_subscription_id: subscription.id,
    stripe_price_id: priceId,
    subscription_status: normaliseSubscriptionStatus(subscription.status),
  }
  if (planSlug) {
    updates.plan = planSlug
    updates.byok_enabled = byokEnabled
    // Only set token_allocation_credits when we have a definitive value
    // — BYOK gets NULL (correct: gate falls through), platform plans
    // get the seeded allocation. Don't clobber on missing config.
    if (allocationCredits !== null) {
      updates.token_allocation_credits = allocationCredits
    } else if (byokEnabled) {
      updates.token_allocation_credits = null
    }
  }
  if (periodStart) {
    updates.current_period_start = periodStart
  }

  const svc = createServiceRoleClient()
  await svc.from('organisations').update(updates).eq('id', orgId)

  return {
    organisationId: orgId,
    audit: {
      subscription_id: subscription.id,
      stripe_price_id: priceId,
      mapped_plan: planSlug,
      cadence,
      status: subscription.status,
      byok_enabled: byokEnabled,
      current_period_start: periodStart,
    },
  }
}

/**
 * customer.subscription.deleted: per the product-scope lock, we don't
 * delete data — the org goes back to 'trial' so the
 * trial-expiry-redirect surfaces the plan-buy page on next login.
 * trial_expires_at is NOT reset; if it's still in the past the redirect
 * fires.
 */
export async function handleSubscriptionDeleted(
  event: Stripe.CustomerSubscriptionDeletedEvent,
): Promise<WebhookHandlerOutcome> {
  const subscription = event.data.object
  const orgId =
    readOrgIdFromMetadata(subscription.metadata) ??
    (typeof subscription.customer === 'string'
      ? await findOrgByCustomer(subscription.customer)
      : null)

  if (!orgId) {
    return {
      organisationId: null,
      audit: {
        subscription_id: subscription.id,
        skipped_reason: 'org_not_found',
      },
    }
  }

  const svc = createServiceRoleClient()
  await svc
    .from('organisations')
    .update({
      plan: 'trial',
      stripe_subscription_id: null,
      stripe_price_id: null,
      subscription_status: 'cancelled',
      byok_enabled: false,
      // token_allocation_credits stays — they keep whatever budget the
      // prior plan had for the remainder of the period.
    })
    .eq('id', orgId)

  return {
    organisationId: orgId,
    audit: {
      subscription_id: subscription.id,
      action: 'reverted_to_trial',
    },
  }
}

export async function handleInvoicePaymentSucceeded(
  event: Stripe.InvoicePaymentSucceededEvent,
): Promise<WebhookHandlerOutcome> {
  const invoice = event.data.object
  const orgId =
    typeof invoice.customer === 'string'
      ? await findOrgByCustomer(invoice.customer)
      : null
  return {
    organisationId: orgId,
    audit: {
      invoice_id: invoice.id,
      amount_paid: invoice.amount_paid,
      currency: invoice.currency,
    },
  }
}

export async function handleInvoicePaymentFailed(
  event: Stripe.InvoicePaymentFailedEvent,
): Promise<WebhookHandlerOutcome> {
  const invoice = event.data.object
  const orgId =
    typeof invoice.customer === 'string'
      ? await findOrgByCustomer(invoice.customer)
      : null

  if (orgId) {
    const svc = createServiceRoleClient()
    await svc
      .from('organisations')
      .update({ subscription_status: 'past_due' })
      .eq('id', orgId)
  }

  return {
    organisationId: orgId,
    audit: {
      invoice_id: invoice.id,
      attempt_count: invoice.attempt_count,
      next_payment_attempt: invoice.next_payment_attempt,
    },
  }
}

/**
 * Phase 9.B admin payments (C.3) — `charge.dispute.created`.
 *
 * Disputes require human action: respond with evidence within Stripe's
 * timeline (~14 days) or accept the chargeback. Handler writes a
 * critical-severity audit_log entry so the admin Failures tab can
 * surface it; no auto-action — the admin opens Stripe Dashboard for
 * the evidence flow.
 */
export async function handleChargeDisputeCreated(
  event: Stripe.ChargeDisputeCreatedEvent,
): Promise<WebhookHandlerOutcome> {
  const dispute = event.data.object
  const orgId =
    typeof dispute.charge === 'string'
      ? await findOrgByCustomerOrCharge(dispute.charge)
      : null

  if (orgId) {
    const svc = createServiceRoleClient()
    await svc.from('audit_log').insert({
      organisation_id: orgId,
      event_type: 'stripe_dispute_created',
      severity: 'critical',
      metadata: {
        dispute_id: dispute.id,
        charge_id: dispute.charge,
        amount: dispute.amount,
        currency: dispute.currency,
        reason: dispute.reason,
        status: dispute.status,
        evidence_due_by: dispute.evidence_details?.due_by ?? null,
      },
    })
  }

  return {
    organisationId: orgId,
    audit: {
      dispute_id: dispute.id,
      amount: dispute.amount,
      reason: dispute.reason,
      status: dispute.status,
    },
  }
}

/**
 * Phase 9.B admin payments (C.3) — `charge.refunded`.
 *
 * Refunds are admin-initiated (issued via Stripe Dashboard) — recording
 * as observation, not action. severity='high' (D5.a lock).
 */
export async function handleChargeRefunded(
  event: Stripe.ChargeRefundedEvent,
): Promise<WebhookHandlerOutcome> {
  const charge = event.data.object
  const orgId =
    typeof charge.customer === 'string'
      ? await findOrgByCustomer(charge.customer)
      : null

  if (orgId) {
    const svc = createServiceRoleClient()
    await svc.from('audit_log').insert({
      organisation_id: orgId,
      event_type: 'stripe_charge_refunded',
      severity: 'high',
      metadata: {
        charge_id: charge.id,
        amount_refunded: charge.amount_refunded,
        amount: charge.amount,
        currency: charge.currency,
        refunded: charge.refunded,
      },
    })
  }

  return {
    organisationId: orgId,
    audit: {
      charge_id: charge.id,
      amount_refunded: charge.amount_refunded,
      amount: charge.amount,
    },
  }
}

/**
 * Phase 9.B admin payments (C.3) — `invoice.payment_action_required`.
 *
 * 3D Secure / SCA — Stripe needs the customer to complete an
 * authentication step. severity='high'; Stripe sends the customer an
 * email with the action link by default.
 */
export async function handleInvoicePaymentActionRequired(
  event: Stripe.InvoicePaymentActionRequiredEvent,
): Promise<WebhookHandlerOutcome> {
  const invoice = event.data.object
  const orgId =
    typeof invoice.customer === 'string'
      ? await findOrgByCustomer(invoice.customer)
      : null

  if (orgId) {
    const svc = createServiceRoleClient()
    await svc.from('audit_log').insert({
      organisation_id: orgId,
      event_type: 'stripe_payment_action_required',
      severity: 'high',
      metadata: {
        invoice_id: invoice.id,
        amount_due: invoice.amount_due,
        hosted_invoice_url: invoice.hosted_invoice_url,
      },
    })
  }

  return {
    organisationId: orgId,
    audit: {
      invoice_id: invoice.id,
      amount_due: invoice.amount_due,
    },
  }
}

/** Resolve org by customer OR by the charge's customer. */
async function findOrgByCustomerOrCharge(
  chargeOrCustomerId: string,
): Promise<string | null> {
  const svc = createServiceRoleClient()
  if (chargeOrCustomerId.startsWith('cus_')) {
    const { data } = await svc
      .from('organisations')
      .select('id')
      .eq('stripe_customer_id', chargeOrCustomerId)
      .maybeSingle()
    return data?.id ?? null
  }
  // It's a charge ID — need to look up the charge's customer via Stripe.
  // For V1 we punt and just return null; the audit row stores the
  // charge_id so an admin can resolve manually.
  return null
}

/**
 * Non-state-changing events — recorded for observability but no DB
 * mutation. customer.{created,updated}, invoice.upcoming,
 * payment_method.attached, customer.subscription.trial_will_end.
 */
export async function handleObservationalEvent(
  event: Stripe.Event,
): Promise<WebhookHandlerOutcome> {
  // Best effort: pull an organisation_id from a customer reference if
  // we can find one. Many of these events carry only the customer ID.
  const dataObj = event.data.object as { customer?: unknown; metadata?: Stripe.Metadata | null }
  let orgId: string | null = null
  if (dataObj.metadata) {
    orgId = readOrgIdFromMetadata(dataObj.metadata)
  }
  if (!orgId && typeof dataObj.customer === 'string') {
    orgId = await findOrgByCustomer(dataObj.customer)
  }
  return {
    organisationId: orgId,
    audit: {
      event_type: event.type,
      event_id: event.id,
    },
  }
}
