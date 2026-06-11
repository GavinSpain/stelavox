/**
 * Phase 9.B work package B — Stripe config reader.
 *
 * The active Stripe mode (test|live) is stored in `platform_config`
 * under `stripe.mode`. Once that's known, the correct Price IDs and
 * webhook secret are read from `stripe.<mode>.price_id.<plan>_monthly`
 * and `stripe.webhook_secret_<mode>`.
 *
 * Storing the mode + price IDs + webhook secret in the DB (instead of
 * env vars) lets us swap test → live at launch with one config UPDATE
 * and no deploy. The API key (sk_test_* / sk_live_*) stays in env vars
 * because it's an auth credential and needs standard env-var hygiene.
 *
 * Callers that need to actually fire a Stripe call should use
 * `requireStripeConfigured()` which throws StripeNotConfiguredError if
 * any piece of the active mode's substrate is missing — the route
 * handler catches and returns 503 stripe_not_configured. This is the
 * pre-launch "no Stripe account yet" deployment state: substrate ships,
 * routes return a clean 503, the user provisions the account, fills the
 * config keys + env var, and the routes start working without code
 * changes.
 */

import { getConfigString } from '@/lib/config/platform-config'

export type StripeMode = 'test' | 'live'

export const STRIPE_PLAN_SLUGS = ['writer', 'author', 'pro', 'byok_solo'] as const
export type StripePlanSlug = (typeof STRIPE_PLAN_SLUGS)[number]

export class StripeNotConfiguredError extends Error {
  constructor(public readonly missing: string[]) {
    super(`Stripe not configured: missing ${missing.join(', ')}`)
    this.name = 'StripeNotConfiguredError'
  }
}

/** Read the active Stripe mode from platform_config. */
export async function getStripeMode(): Promise<StripeMode> {
  const raw = await getConfigString('stripe.mode')
  if (raw !== 'test' && raw !== 'live') {
    throw new Error(`Invalid stripe.mode value "${raw}" — must be 'test' or 'live'`)
  }
  return raw
}

/**
 * Read the API secret key for the active mode from env vars.
 * STRIPE_SECRET_KEY_TEST and STRIPE_SECRET_KEY_LIVE are the canonical
 * env var names — distinct keys so a misconfigured deploy can't
 * accidentally use the wrong mode.
 */
export function getStripeSecretKey(mode: StripeMode): string | null {
  const key = mode === 'test' ? process.env.STRIPE_SECRET_KEY_TEST : process.env.STRIPE_SECRET_KEY_LIVE
  return key && key.length > 0 ? key : null
}

/** Read the Price ID for a plan in the active mode. */
export async function getStripePriceId(
  mode: StripeMode,
  plan: StripePlanSlug,
): Promise<string> {
  return getConfigString(`stripe.${mode}.price_id.${plan}_monthly`)
}

/** Read the webhook signing secret for the active mode. */
export async function getStripeWebhookSecret(mode: StripeMode): Promise<string> {
  return getConfigString(`stripe.webhook_secret_${mode}`)
}

/**
 * Validate that every piece of substrate the active mode needs is set.
 * Throws StripeNotConfiguredError if anything is missing, listing the
 * specific config keys / env vars that are blank.
 *
 * Call this in API routes BEFORE any Stripe API call so the user gets a
 * clean 503 with a list of what's missing rather than a Stripe SDK
 * error message.
 */
export async function requireStripeConfigured(): Promise<{
  mode: StripeMode
  secretKey: string
}> {
  const mode = await getStripeMode()
  const missing: string[] = []

  const secretKey = getStripeSecretKey(mode)
  if (!secretKey) {
    missing.push(
      mode === 'test' ? 'STRIPE_SECRET_KEY_TEST (env)' : 'STRIPE_SECRET_KEY_LIVE (env)',
    )
  }

  const webhookSecret = await getStripeWebhookSecret(mode)
  if (!webhookSecret) {
    missing.push(`stripe.webhook_secret_${mode}`)
  }

  for (const plan of STRIPE_PLAN_SLUGS) {
    const priceId = await getStripePriceId(mode, plan)
    if (!priceId) {
      missing.push(`stripe.${mode}.price_id.${plan}_monthly`)
    }
  }

  if (missing.length > 0) {
    throw new StripeNotConfiguredError(missing)
  }

  return { mode, secretKey: secretKey! }
}
