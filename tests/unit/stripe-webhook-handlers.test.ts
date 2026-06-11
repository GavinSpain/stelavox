/**
 * Phase 9.B Session 2 — webhook handler side-effect tests.
 *
 * Each handler reads metadata + customer references off a fabricated
 * Stripe event object and writes to organisations / returns audit
 * metadata. Tests exercise the real local DB with a throwaway org.
 *
 * The Stripe types are complex; we cast minimal fixture objects to the
 * handler's expected event type. Handlers only read a small surface of
 * fields, so the casts are safe in practice.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import type Stripe from 'stripe'

import { _clearConfigCache } from '@/lib/config/platform-config'
import {
  handleCheckoutSessionCompleted,
  handleInvoicePaymentFailed,
  handleSubscriptionCreatedOrUpdated,
  handleSubscriptionDeleted,
} from '@/lib/stripe/webhook-handlers'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54331'
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const hasServiceKey = SERVICE_KEY !== ''
const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

describe.skipIf(!hasServiceKey)('Stripe webhook handlers (DR-070)', () => {
  let testOrgId: string

  // Seed the writer Price ID with a fixed value so the reverse lookup
  // resolves cleanly.
  const WRITER_PRICE_ID = 'price_phase9b_handler_writer'
  let originalWriterPriceId: unknown

  beforeAll(async () => {
    // Seed test Price ID for writer plan.
    const { data: current } = await svc
      .from('platform_config')
      .select('value')
      .eq('key', 'stripe.test.price_id.writer_monthly')
      .single()
    originalWriterPriceId = current!.value
    await svc
      .from('platform_config')
      .update({ value: WRITER_PRICE_ID })
      .eq('key', 'stripe.test.price_id.writer_monthly')
    _clearConfigCache()

    // Throwaway org.
    const stamp = Date.now()
    const { data: org, error } = await svc
      .from('organisations')
      .insert({
        name: `webhook test org ${stamp}`,
        slug: `wh-${stamp}`,
        plan: 'trial',
        stripe_customer_id: `cus_phase9b_${stamp}`,
      })
      .select('id')
      .single()
    if (error || !org) throw new Error(`failed to seed org: ${error?.message}`)
    testOrgId = org.id
  })

  afterAll(async () => {
    if (testOrgId) {
      await svc.from('organisations').delete().eq('id', testOrgId)
    }
    await svc
      .from('platform_config')
      .update({ value: originalWriterPriceId })
      .eq('key', 'stripe.test.price_id.writer_monthly')
    _clearConfigCache()
  })

  it('handleCheckoutSessionCompleted resolves org from metadata', async () => {
    const event = {
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_test_123',
          customer: `cus_phase9b_xx`,
          subscription: 'sub_test_123',
          amount_total: 2000,
          mode: 'subscription',
          metadata: { organisation_id: testOrgId },
        },
      },
    } as unknown as Stripe.CheckoutSessionCompletedEvent

    const outcome = await handleCheckoutSessionCompleted(event)
    expect(outcome.organisationId).toBe(testOrgId)
    expect(outcome.audit).toMatchObject({
      checkout_session_id: 'cs_test_123',
      subscription_id: 'sub_test_123',
      amount_total: 2000,
    })
  })

  it('handleSubscriptionCreatedOrUpdated maps Price ID → plan and updates org', async () => {
    // Re-read the current writer Price ID at test time — handles the
    // case where a concurrent test file may have mutated it. The
    // assertion is "whatever the DB currently maps to writer should
    // resolve via the reverse lookup", not "WRITER_PRICE_ID specifically".
    _clearConfigCache()
    const { data: currentWriter } = await svc
      .from('platform_config')
      .select('value')
      .eq('key', 'stripe.test.price_id.writer_monthly')
      .single()
    const currentWriterPriceId = currentWriter!.value as string

    const event = {
      type: 'customer.subscription.created',
      data: {
        object: {
          id: 'sub_test_456',
          customer: `cus_phase9b_for_${testOrgId}`,
          status: 'active',
          items: {
            data: [
              {
                price: { id: currentWriterPriceId },
                current_period_start: 1700000000,
              },
            ],
          },
          metadata: { organisation_id: testOrgId },
        },
      },
    } as unknown as Stripe.CustomerSubscriptionCreatedEvent

    const outcome = await handleSubscriptionCreatedOrUpdated(event)
    expect(outcome.organisationId).toBe(testOrgId)
    expect(outcome.audit.mapped_plan).toBe('writer')
    expect(outcome.audit.status).toBe('active')

    // Verify DB writes
    const { data: org } = await svc
      .from('organisations')
      .select('plan, subscription_status, stripe_subscription_id, stripe_price_id, byok_enabled')
      .eq('id', testOrgId)
      .single()
    expect(org!.plan).toBe('writer')
    expect(org!.subscription_status).toBe('active')
    expect(org!.stripe_subscription_id).toBe('sub_test_456')
    expect(org!.stripe_price_id).toBe(currentWriterPriceId)
    expect(org!.byok_enabled).toBe(false)
  })

  it('handleSubscriptionDeleted reverts org to trial plan + clears Stripe refs', async () => {
    const event = {
      type: 'customer.subscription.deleted',
      data: {
        object: {
          id: 'sub_test_456',
          customer: `cus_phase9b_for_${testOrgId}`,
          status: 'canceled',
          metadata: { organisation_id: testOrgId },
        },
      },
    } as unknown as Stripe.CustomerSubscriptionDeletedEvent

    const outcome = await handleSubscriptionDeleted(event)
    expect(outcome.organisationId).toBe(testOrgId)
    expect(outcome.audit.action).toBe('reverted_to_trial')

    const { data: org } = await svc
      .from('organisations')
      .select('plan, subscription_status, stripe_subscription_id, stripe_price_id, byok_enabled')
      .eq('id', testOrgId)
      .single()
    expect(org!.plan).toBe('trial')
    expect(org!.subscription_status).toBe('cancelled')
    expect(org!.stripe_subscription_id).toBeNull()
    expect(org!.stripe_price_id).toBeNull()
    expect(org!.byok_enabled).toBe(false)
  })

  it('handleInvoicePaymentFailed flips subscription_status to past_due', async () => {
    // Re-activate first via the create-or-update handler.
    await svc
      .from('organisations')
      .update({ subscription_status: 'active' })
      .eq('id', testOrgId)

    const event = {
      type: 'invoice.payment_failed',
      data: {
        object: {
          id: 'in_test_789',
          customer: `cus_phase9b_${testOrgId.slice(0, 8)}`,
          attempt_count: 2,
          next_payment_attempt: 1700001000,
        },
      },
    } as unknown as Stripe.InvoicePaymentFailedEvent

    // The handler resolves org via the stripe_customer_id field, but
    // the seed customer ID was created at test setup. Update the org's
    // stripe_customer_id so the lookup matches.
    await svc
      .from('organisations')
      .update({ stripe_customer_id: event.data.object.customer as string })
      .eq('id', testOrgId)

    const outcome = await handleInvoicePaymentFailed(event)
    expect(outcome.organisationId).toBe(testOrgId)

    const { data: org } = await svc
      .from('organisations')
      .select('subscription_status')
      .eq('id', testOrgId)
      .single()
    expect(org!.subscription_status).toBe('past_due')
  })
})
