/**
 * POST /api/billing/portal — Stripe Customer Portal Session creation.
 *
 * Phase 9.B work package B. The "Manage subscription" link on
 * /settings/plan POSTs here and gets back { url }. The client redirects
 * window.location to that URL; the user can cancel, switch plan, update
 * payment method, view invoices on Stripe-hosted pages; the Portal
 * sends webhook events back to /api/stripe/webhook (B.5) that sync the
 * subscription state on our side.
 *
 * The Portal requires an existing Stripe Customer — the org must have
 * gone through Checkout at least once (which creates the Customer +
 * persists stripe_customer_id). Returns 409 no_customer if not.
 *
 * If Stripe is not configured, returns 503 stripe_not_configured.
 */

import 'server-only'

import { NextResponse, type NextRequest } from 'next/server'

import { apiError } from '@/lib/director/route-helpers'
import {
  StripeNotConfiguredError,
  requireStripeConfigured,
} from '@/lib/stripe/config'
import { createPortalSession } from '@/lib/stripe/sessions'
import { createClient } from '@/lib/supabase/server'

export async function POST(req: NextRequest): Promise<Response> {
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

  const { data: org } = await supabase
    .from('organisations')
    .select('stripe_customer_id')
    .eq('id', membership.organisation_id)
    .maybeSingle()
  if (!org?.stripe_customer_id) {
    return apiError(
      409,
      'no_customer',
      'No Stripe Customer is associated with this organisation. Subscribe to a plan first.',
    )
  }

  try {
    await requireStripeConfigured()
  } catch (err) {
    if (err instanceof StripeNotConfiguredError) {
      return apiError(503, 'stripe_not_configured', err.message, { missing: err.missing })
    }
    throw err
  }

  const origin =
    process.env.NEXT_PUBLIC_APP_URL ??
    req.headers.get('origin') ??
    `${req.nextUrl.protocol}//${req.nextUrl.host}`

  const { url } = await createPortalSession({
    customerId: org.stripe_customer_id,
    returnBaseUrl: origin,
  })

  return NextResponse.json({ url })
}
