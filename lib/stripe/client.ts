/**
 * Phase 9.B work package B — Stripe SDK client factory.
 *
 * One Stripe instance per process (memoised by mode). Throws if the
 * active mode's secret key is missing; callers should use
 * requireStripeConfigured() first to surface a clean 503 instead of a
 * raw SDK error.
 *
 * apiVersion is pinned to the Stripe SDK's stable release line; updates
 * are deliberate (SDK + apiVersion bumped together).
 */

import Stripe from 'stripe'

import { getStripeMode, getStripeSecretKey, requireStripeConfigured } from './config'

const STRIPE_API_VERSION = '2026-05-27.dahlia' as const

const clientCache = new Map<string, Stripe>()

/** Get a Stripe client for the active mode. Throws on misconfiguration. */
export async function getStripeClient(): Promise<Stripe> {
  const mode = await getStripeMode()
  const cached = clientCache.get(mode)
  if (cached) return cached

  const secretKey = getStripeSecretKey(mode)
  if (!secretKey) {
    // Bubble through requireStripeConfigured for a structured error.
    await requireStripeConfigured()
    // Unreachable — requireStripeConfigured threw.
    throw new Error('unreachable')
  }

  const stripe = new Stripe(secretKey, {
    apiVersion: STRIPE_API_VERSION,
    typescript: true,
  })
  clientCache.set(mode, stripe)
  return stripe
}
