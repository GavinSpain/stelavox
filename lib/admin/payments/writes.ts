/**
 * Phase 9.B admin payments (C.5) — write surfaces with audit + cache
 * invalidation.
 *
 * Every editable config key flows through writeAdminPaymentConfig:
 *   1. Verify caller is a platform admin (matches /admin auth gate).
 *   2. Validate the key is in the editable allowlist (defence-in-depth
 *      against accidental writes of allocations etc. via this surface).
 *   3. Validate the value against the per-key validator.
 *   4. Read the current value (for the audit_log diff).
 *   5. UPDATE platform_config in service-role.
 *   6. Insert audit_log row with old + new values + admin user id.
 *   7. _clearConfigCache() so subsequent reads see the new value.
 *   8. _clearStripeClientCache() when the change affects the Stripe
 *      client (mode, api_version).
 *
 * Webhook-secret edits use a separate two-entry validator (D1.a lock).
 */

import 'server-only'

import { _clearConfigCache } from '@/lib/config/platform-config'
import { isPlatformAdmin } from '@/lib/admin/isPlatformAdmin'
import { _clearStripeClientCache } from '@/lib/stripe/client'
import { createClient } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/supabase/service'

const STRIPE_CLIENT_AFFECTING_KEYS = new Set<string>([
  'stripe.mode',
  'stripe.api_version',
])

/**
 * Allowlist of config keys that the admin payments page may edit.
 * Other keys (allocations, pricing rates, etc.) live on different
 * admin surfaces.
 */
const EDITABLE_KEYS: Record<string, KeyValidator> = {
  'stripe.mode': enumValidator(['test', 'live']),
  'stripe.api_version': apiVersionValidator(),
  'stripe.webhook_secret_test': webhookSecretValidator(),
  'stripe.webhook_secret_live': webhookSecretValidator(),
  'stripe.checkout.automatic_tax_enabled': boolValidator(),
  'stripe.checkout.allow_promotion_codes': boolValidator(),
  'stripe.checkout.billing_address_collection': enumValidator(['auto', 'required']),
  'billing.trial_duration_days': intValidator(1, 90),
  'billing.payment_failure_grace_days': intValidator(0, 30),
}

// Price ID slots — generated rather than enumerated.
for (const mode of ['test', 'live'] as const) {
  for (const plan of ['writer', 'author', 'pro', 'byok_solo'] as const) {
    for (const cadence of ['monthly', 'yearly'] as const) {
      EDITABLE_KEYS[`stripe.${mode}.price_id.${plan}_${cadence}`] =
        priceIdValidator()
    }
  }
}

type ValidationResult =
  | { ok: true; storedValue: unknown }
  | { ok: false; reason: string }

interface KeyValidator {
  (raw: string): ValidationResult
}

function enumValidator(allowed: string[]): KeyValidator {
  return (raw) => {
    if (!allowed.includes(raw)) {
      return { ok: false, reason: `must be one of: ${allowed.join(', ')}` }
    }
    return { ok: true, storedValue: raw }
  }
}

function boolValidator(): KeyValidator {
  return (raw) => {
    if (raw === 'true' || raw === 'false') {
      return { ok: true, storedValue: raw === 'true' }
    }
    return { ok: false, reason: 'must be "true" or "false"' }
  }
}

function intValidator(min: number, max: number): KeyValidator {
  return (raw) => {
    const n = Number(raw)
    if (!Number.isInteger(n) || n < min || n > max) {
      return { ok: false, reason: `must be an integer in [${min}, ${max}]` }
    }
    return { ok: true, storedValue: n }
  }
}

function apiVersionValidator(): KeyValidator {
  return (raw) => {
    const trimmed = raw.trim()
    if (trimmed.length === 0) {
      return {
        ok: false,
        reason: 'API version must not be empty — the Stripe SDK requires a value',
      }
    }
    if (!/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
      return {
        ok: false,
        reason: 'must be a Stripe API date (YYYY-MM-DD or YYYY-MM-DD.codename)',
      }
    }
    return { ok: true, storedValue: trimmed }
  }
}

function priceIdValidator(): KeyValidator {
  return (raw) => {
    const trimmed = raw.trim()
    if (trimmed === '') {
      return { ok: true, storedValue: '' }
    }
    if (!trimmed.startsWith('price_')) {
      return {
        ok: false,
        reason: 'Stripe Price IDs start with "price_"',
      }
    }
    return { ok: true, storedValue: trimmed }
  }
}

function webhookSecretValidator(): KeyValidator {
  return (raw) => {
    const trimmed = raw.trim()
    if (trimmed === '') {
      return { ok: true, storedValue: '' }
    }
    if (!trimmed.startsWith('whsec_')) {
      return {
        ok: false,
        reason: 'Stripe webhook secrets start with "whsec_"',
      }
    }
    return { ok: true, storedValue: trimmed }
  }
}

export interface AdminPaymentsWriteResult {
  ok: boolean
  error?: string
  key?: string
  oldValue?: unknown
  newValue?: unknown
}

export interface AdminPaymentsWriteInput {
  key: string
  value: string
  /** D1.a webhook-secret double-entry — caller posts both fields. */
  valueConfirm?: string
}

export async function writeAdminPaymentConfig(
  input: AdminPaymentsWriteInput,
): Promise<AdminPaymentsWriteResult> {
  // 1. Auth.
  const supabase = await createClient()
  const isAdmin = await isPlatformAdmin(supabase)
  if (!isAdmin) {
    return { ok: false, error: 'unauthorized' }
  }
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const adminUserId = user?.id ?? null

  // 2. Allowlist.
  const validator = EDITABLE_KEYS[input.key]
  if (!validator) {
    return { ok: false, error: `key "${input.key}" is not editable from this surface` }
  }

  // 3. Double-entry for webhook secrets (D1.a).
  if (input.key.startsWith('stripe.webhook_secret_')) {
    if (input.valueConfirm === undefined) {
      return { ok: false, error: 'confirmation required (D1.a)' }
    }
    if (input.value !== input.valueConfirm) {
      return { ok: false, error: 'confirmation did not match' }
    }
  }

  // 4. Validate.
  const validation = validator(input.value)
  if (!validation.ok) {
    return { ok: false, error: validation.reason }
  }

  // 5. Read current value for diff.
  const svc = createServiceRoleClient()
  const { data: currentRow } = await svc
    .from('platform_config')
    .select('value')
    .eq('key', input.key)
    .maybeSingle()
  const oldValue = currentRow?.value ?? null

  // No-op when value is unchanged.
  if (JSON.stringify(oldValue) === JSON.stringify(validation.storedValue)) {
    return { ok: true, key: input.key, oldValue, newValue: validation.storedValue }
  }

  // 6. UPDATE.
  const { error: updateErr } = await svc
    .from('platform_config')
    .update({ value: validation.storedValue })
    .eq('key', input.key)
  if (updateErr) {
    return { ok: false, error: `update failed: ${updateErr.message}` }
  }

  // 7. Audit_log — masked storage for secrets.
  const isSecret = input.key.startsWith('stripe.webhook_secret_')
  await svc.from('audit_log').insert({
    organisation_id: null,
    event_type: 'admin_payments_config_changed',
    severity: 'medium',
    metadata: {
      key: input.key,
      old_value: isSecret ? '••• masked' : oldValue,
      new_value: isSecret ? '••• masked' : validation.storedValue,
      admin_user_id: adminUserId,
    },
  })

  // 8. Cache invalidations.
  _clearConfigCache()
  if (STRIPE_CLIENT_AFFECTING_KEYS.has(input.key)) {
    _clearStripeClientCache()
  }

  return {
    ok: true,
    key: input.key,
    oldValue: isSecret ? '••• masked' : oldValue,
    newValue: isSecret ? '••• masked' : validation.storedValue,
  }
}
