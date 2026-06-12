/**
 * Phase 9.B work package B — Stripe SDK client factory.
 *
 * One Stripe instance per process+mode+api_version (memoised). Throws
 * if the active mode's secret key or api_version is missing; callers
 * should use requireStripeConfigured() first to surface a clean 503
 * instead of a raw SDK error.
 *
 * apiVersion is read from `stripe.api_version` platform_config (M-223,
 * Phase 9.B admin payments follow-up). Roll forward at Stripe's
 * recommendation via the admin config without a deploy. The Stripe SDK
 * itself validates the version string; an unknown value will surface as
 * an SDK error at first call.
 */

import Stripe from 'stripe'

import {
  getStripeApiVersion,
  getStripeMode,
  getStripeSecretKey,
  requireStripeConfigured,
} from './config'

const clientCache = new Map<string, Stripe>()

/** Get a Stripe client for the active mode. Throws on misconfiguration. */
export async function getStripeClient(): Promise<Stripe> {
  const mode = await getStripeMode()
  const apiVersion = await getStripeApiVersion()
  const cacheKey = `${mode}:${apiVersion}`
  const cached = clientCache.get(cacheKey)
  if (cached) return cached

  const secretKey = getStripeSecretKey(mode)
  if (!secretKey) {
    // Bubble through requireStripeConfigured for a structured error.
    await requireStripeConfigured()
    // Unreachable — requireStripeConfigured threw.
    throw new Error('unreachable')
  }

  if (!apiVersion) {
    await requireStripeConfigured()
    throw new Error('unreachable')
  }

  // Stripe's typed constructor pins apiVersion to the SDK's literal
  // type; we read from platform_config (M-223), so an `as never` cast
  // is required to bypass the literal check. Mismatched values surface
  // as a Stripe SDK error at first call — caller-friendly.
  const stripe = new Stripe(secretKey, {
    apiVersion: apiVersion as never,
    typescript: true,
  })
  clientCache.set(cacheKey, stripe)
  return stripe
}

/**
 * Invalidate the in-process Stripe client cache. Called from the admin
 * write path after `stripe.mode` or `stripe.api_version` changes so the
 * next call gets a fresh client with the new config.
 */
export function _clearStripeClientCache(): void {
  clientCache.clear()
}
