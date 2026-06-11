/**
 * Phase 9.B work package B — Stripe Checkout + Customer Portal session
 * creation.
 *
 * Both flows pivot on a Stripe Customer (lib/stripe/customers.ts).
 * Checkout creates a subscription against a specific Price ID; Portal
 * lets the customer self-serve cancel / switch plan / update payment.
 *
 * URLs return the user to /settings/plan with a status hint in the
 * query string so the PlanPanel can surface the right messaging:
 *   ?stripe_status=success  — subscription created (verified by webhook)
 *   ?stripe_status=cancelled  — user backed out of Checkout
 */

import { getStripeClient } from './client'
import type { StripePlanSlug } from './config'
import { getStripeMode, getStripePriceId } from './config'

/**
 * Create a Stripe Checkout Session for a new subscription. Returns the
 * hosted Checkout URL that the client should redirect to.
 */
export async function createCheckoutSession(args: {
  customerId: string
  organisationId: string
  plan: StripePlanSlug
  returnBaseUrl: string
}): Promise<{ url: string; sessionId: string }> {
  const mode = await getStripeMode()
  const priceId = await getStripePriceId(mode, args.plan)
  if (!priceId) {
    throw new Error(`No Stripe Price ID configured for ${args.plan} in ${mode} mode`)
  }

  const stripe = await getStripeClient()
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: args.customerId,
    line_items: [
      {
        price: priceId,
        quantity: 1,
      },
    ],
    success_url: `${args.returnBaseUrl}/settings/plan?stripe_status=success`,
    cancel_url: `${args.returnBaseUrl}/settings/plan?stripe_status=cancelled`,
    metadata: {
      organisation_id: args.organisationId,
      plan: args.plan,
    },
    subscription_data: {
      metadata: {
        organisation_id: args.organisationId,
        plan: args.plan,
      },
    },
  })

  if (!session.url) {
    throw new Error('Stripe Checkout Session created without a URL')
  }

  return { url: session.url, sessionId: session.id }
}

/**
 * Create a Stripe Customer Portal session. Returns the hosted Portal
 * URL that the client should redirect to.
 */
export async function createPortalSession(args: {
  customerId: string
  returnBaseUrl: string
}): Promise<{ url: string }> {
  const stripe = await getStripeClient()
  const session = await stripe.billingPortal.sessions.create({
    customer: args.customerId,
    return_url: `${args.returnBaseUrl}/settings/plan`,
  })
  return { url: session.url }
}
