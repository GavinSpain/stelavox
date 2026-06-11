/**
 * POST /api/billing/checkout — Stripe Checkout Session creation.
 *
 * Phase 9.B work package B. The PlanPanel's "Subscribe" button POSTs
 * here with { plan: 'writer'|'author'|'pro'|'byok_solo' } and gets back
 * { url }. The client redirects window.location to that URL; the user
 * completes Checkout on Stripe-hosted pages; Stripe sends a webhook to
 * /api/stripe/webhook (B.5) that activates the subscription on our side.
 *
 * If Stripe is not yet configured (no account, no Price IDs in
 * platform_config, no STRIPE_SECRET_KEY_TEST env var), the route
 * returns 503 stripe_not_configured with a list of missing pieces. This
 * is the "Stripe account exists but not yet hooked up" deployment state.
 *
 * Auth: authenticated user. Org: must be a member of the org the
 * Checkout is being created for. V1 = single-user orgs so the org is
 * resolved from the user's primary membership.
 */

import 'server-only'

import { NextResponse, type NextRequest } from 'next/server'

import { apiError } from '@/lib/director/route-helpers'
import { findOrCreateCustomerForOrg } from '@/lib/stripe/customers'
import {
  STRIPE_PLAN_SLUGS,
  StripeNotConfiguredError,
  requireStripeConfigured,
  type StripePlanSlug,
} from '@/lib/stripe/config'
import { createCheckoutSession } from '@/lib/stripe/sessions'
import { createClient } from '@/lib/supabase/server'

const PLAN_SLUG_SET: ReadonlySet<string> = new Set(STRIPE_PLAN_SLUGS)

export async function POST(req: NextRequest): Promise<Response> {
  // Parse body.
  let plan: StripePlanSlug
  try {
    const body = (await req.json()) as { plan?: unknown }
    if (typeof body.plan !== 'string' || !PLAN_SLUG_SET.has(body.plan)) {
      return apiError(
        400,
        'invalid_body',
        `plan: must be one of ${STRIPE_PLAN_SLUGS.join(', ')}`,
      )
    }
    plan = body.plan as StripePlanSlug
  } catch {
    return apiError(400, 'invalid_body', 'request body must be JSON with a `plan` field')
  }

  // Verify auth + resolve org.
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return apiError(401, 'unauthenticated')

  const { data: membership } = await supabase
    .from('organisation_members')
    .select('organisation_id')
    .eq('user_id', user.id)
    .limit(1)
    .maybeSingle()
  if (!membership?.organisation_id) {
    return apiError(403, 'no_organisation')
  }

  // Pre-check Stripe configuration — returns 503 with explicit missing
  // list if anything is blank.
  try {
    await requireStripeConfigured()
  } catch (err) {
    if (err instanceof StripeNotConfiguredError) {
      return apiError(503, 'stripe_not_configured', err.message, { missing: err.missing })
    }
    throw err
  }

  // Find-or-create the Stripe Customer for this org (persists
  // organisations.stripe_customer_id on the first call).
  const customerId = await findOrCreateCustomerForOrg(membership.organisation_id)

  // Resolve the public origin for return URLs. Falls back to the request
  // origin so local dev works without env config.
  const origin =
    process.env.NEXT_PUBLIC_APP_URL ??
    req.headers.get('origin') ??
    `${req.nextUrl.protocol}//${req.nextUrl.host}`

  const { url } = await createCheckoutSession({
    customerId,
    organisationId: membership.organisation_id,
    plan,
    returnBaseUrl: origin,
  })

  return NextResponse.json({ url })
}
