/**
 * Phase 9.B work package B — plan ↔ Stripe Price ID mapping.
 *
 * Webhooks arrive with a Stripe Price ID; we need to map back to one of
 * our plan slugs to update organisations.plan. Both modes are inspected
 * (a live-mode webhook to a misconfigured test-mode deploy still needs
 * to be flagged, not silently mapped).
 *
 * priceIdToPlan reads all 8 platform_config keys (4 plans × 2 modes)
 * and returns the matching slug + mode, or null when the Price ID
 * doesn't correspond to any configured plan. The platform_config cache
 * means this is a hot-path-safe read.
 *
 * The plan→allocation lookup happens via getPlanAllocationCredits using
 * the existing `plan.<slug>_token_allocation_credits` keys (V1.x-C).
 */

import 'server-only'

import { getConfigNumber, getConfigString } from '@/lib/config/platform-config'

import {
  STRIPE_CADENCES,
  STRIPE_PLAN_SLUGS,
  type StripeCadence,
  type StripeMode,
  type StripePlanSlug,
} from './config'

const PLATFORM_PLAN_SLUGS: ReadonlyArray<StripePlanSlug> = ['writer', 'author', 'pro']
const BYOK_PLAN_SLUGS: ReadonlyArray<StripePlanSlug> = ['byok_solo']

/**
 * Reverse-lookup: given a Stripe Price ID from a webhook, return the
 * { plan, mode, cadence } it maps to. Returns null if no match.
 */
export async function priceIdToPlan(
  priceId: string,
): Promise<{ plan: StripePlanSlug; mode: StripeMode; cadence: StripeCadence } | null> {
  if (!priceId) return null

  for (const mode of ['test', 'live'] as const) {
    for (const plan of STRIPE_PLAN_SLUGS) {
      for (const cadence of STRIPE_CADENCES) {
        const configured = await getConfigString(`stripe.${mode}.price_id.${plan}_${cadence}`)
        if (configured && configured === priceId) {
          return { plan, mode, cadence }
        }
      }
    }
  }
  return null
}

/**
 * Resolve the credit allocation for a plan slug from platform_config.
 * BYOK plans return null (no allocation enforced — BYOK pays Anthropic
 * directly). Throws when the platform plan's config key is missing
 * (mis-seeded platform).
 */
export async function getPlanAllocationCredits(plan: StripePlanSlug): Promise<number | null> {
  if (BYOK_PLAN_SLUGS.includes(plan)) return null
  if (!PLATFORM_PLAN_SLUGS.includes(plan)) {
    throw new Error(`getPlanAllocationCredits: unknown platform plan slug ${plan}`)
  }
  return getConfigNumber(`plan.${plan}_token_allocation_credits`)
}

/** True for plan slugs that enable BYOK routing on activation. */
export function isByokPlan(plan: StripePlanSlug): boolean {
  return BYOK_PLAN_SLUGS.includes(plan)
}
