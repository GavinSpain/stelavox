/**
 * POST /api/stripe/webhook — Stripe webhook receiver.
 *
 * Phase 9.B work package B Session 2.
 *
 * Verifies the Stripe signature against `stripe.webhook_secret_<mode>`,
 * dedupes by stripe_event_id (M-221 UNIQUE index), routes to a
 * per-event handler, persists a subscription_events audit row.
 *
 * Critical: the raw request body must be passed to Stripe's signature
 * verification — calling req.json() would re-serialise and break the
 * signature. We use req.text() and let Stripe's SDK parse.
 *
 * Returns:
 *   200 OK on successful processing OR on a duplicate event (idempotent)
 *   400 invalid_signature when signature verification fails
 *   503 stripe_not_configured when no webhook secret is set
 *   500 on handler errors (Stripe will retry)
 */

import 'server-only'

import { NextResponse, type NextRequest } from 'next/server'
import type Stripe from 'stripe'

import { getStripeClient } from '@/lib/stripe/client'
import {
  getStripeMode,
  getStripeWebhookSecret,
} from '@/lib/stripe/config'
import {
  handleCheckoutSessionCompleted,
  handleInvoicePaymentFailed,
  handleInvoicePaymentSucceeded,
  handleObservationalEvent,
  handleSubscriptionCreatedOrUpdated,
  handleSubscriptionDeleted,
  type WebhookHandlerOutcome,
} from '@/lib/stripe/webhook-handlers'
import { createServiceRoleClient } from '@/lib/supabase/service'

/**
 * The events we subscribe to per the V1 product-scope lock
 * ("Comprehensive set"). Unrecognised events return 200 OK without
 * persisting anything (Stripe sometimes sends events for endpoint
 * configuration changes, etc.).
 */
const HANDLED_EVENT_TYPES = new Set<string>([
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'customer.subscription.trial_will_end',
  'customer.created',
  'customer.updated',
  'invoice.payment_succeeded',
  'invoice.payment_failed',
  'invoice.upcoming',
  'payment_method.attached',
])

export async function POST(req: NextRequest): Promise<Response> {
  const signature = req.headers.get('stripe-signature')
  if (!signature) {
    return NextResponse.json(
      { error: 'invalid_signature', message: 'stripe-signature header missing' },
      { status: 400 },
    )
  }

  const rawBody = await req.text()

  const mode = await getStripeMode()
  const webhookSecret = await getStripeWebhookSecret(mode)
  if (!webhookSecret) {
    return NextResponse.json(
      { error: 'stripe_not_configured', message: `stripe.webhook_secret_${mode} is empty` },
      { status: 503 },
    )
  }

  const stripe = await getStripeClient()
  let event: Stripe.Event
  try {
    event = await stripe.webhooks.constructEventAsync(
      rawBody,
      signature,
      webhookSecret,
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : 'verification failed'
    return NextResponse.json(
      { error: 'invalid_signature', message },
      { status: 400 },
    )
  }

  // Unhandled events: return 200 so Stripe doesn't retry — we've
  // received but won't act.
  if (!HANDLED_EVENT_TYPES.has(event.type)) {
    return NextResponse.json({ received: true, handled: false })
  }

  // Route to handler.
  let outcome: WebhookHandlerOutcome
  switch (event.type) {
    case 'checkout.session.completed':
      outcome = await handleCheckoutSessionCompleted(
        event as Stripe.CheckoutSessionCompletedEvent,
      )
      break
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
      outcome = await handleSubscriptionCreatedOrUpdated(
        event as
          | Stripe.CustomerSubscriptionCreatedEvent
          | Stripe.CustomerSubscriptionUpdatedEvent,
      )
      break
    case 'customer.subscription.deleted':
      outcome = await handleSubscriptionDeleted(
        event as Stripe.CustomerSubscriptionDeletedEvent,
      )
      break
    case 'invoice.payment_succeeded':
      outcome = await handleInvoicePaymentSucceeded(
        event as Stripe.InvoicePaymentSucceededEvent,
      )
      break
    case 'invoice.payment_failed':
      outcome = await handleInvoicePaymentFailed(
        event as Stripe.InvoicePaymentFailedEvent,
      )
      break
    default:
      outcome = await handleObservationalEvent(event)
  }

  // Persist the subscription_events row. The UNIQUE index on
  // stripe_event_id (M-221) makes duplicate deliveries a no-op:
  // the INSERT returns a duplicate-key error which we swallow — the
  // event has already been processed at least once.
  if (outcome.organisationId) {
    const svc = createServiceRoleClient()
    const { error: insertErr } = await svc
      .from('subscription_events')
      .insert({
        organisation_id: outcome.organisationId,
        event_type: event.type,
        stripe_event_id: event.id,
        metadata: outcome.audit,
      })
    // 23505 unique_violation = duplicate stripe_event_id — Stripe retry,
    // not a failure. Anything else surfaces as a 500 so Stripe retries.
    if (insertErr && insertErr.code !== '23505') {
      return NextResponse.json(
        { error: 'audit_write_failed', message: insertErr.message },
        { status: 500 },
      )
    }
  }

  return NextResponse.json({ received: true, handled: true, event_type: event.type })
}
