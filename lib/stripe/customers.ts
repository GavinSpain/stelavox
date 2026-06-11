/**
 * Phase 9.B work package B — Stripe Customer lifecycle.
 *
 * One Stripe Customer per organisation. The `organisations.stripe_customer_id`
 * column persists the link. find-or-create is idempotent: if the row
 * already has a customer ID, we return it; otherwise we create a Stripe
 * Customer with the org's name + the owner's email as identity metadata
 * and persist the new ID.
 *
 * The owner email is read from the org's owner membership row +
 * auth.users. V1 = single-user orgs (per the V1 product locks) so owner
 * email = the only user's email.
 */

import { createServiceRoleClient } from '@/lib/supabase/service'

import { getStripeClient } from './client'

export interface OrgCustomerContext {
  organisationId: string
  ownerUserId: string
  ownerEmail: string
  organisationName: string
}

/**
 * Read the owner context for an organisation. Returns null if no owner
 * row exists (defensive — shouldn't happen for handle_new_user-created
 * orgs but the schema doesn't strictly enforce one owner).
 */
export async function getOrgOwnerContext(
  organisationId: string,
): Promise<OrgCustomerContext | null> {
  const svc = createServiceRoleClient()
  const { data: org } = await svc
    .from('organisations')
    .select('id, name')
    .eq('id', organisationId)
    .maybeSingle()
  if (!org) return null

  const { data: ownerMembership } = await svc
    .from('organisation_members')
    .select('user_id')
    .eq('organisation_id', organisationId)
    .eq('role', 'owner')
    .limit(1)
    .maybeSingle()
  if (!ownerMembership) return null

  // auth.users is in the auth schema — use the admin API.
  const { data: userResp } = await svc.auth.admin.getUserById(ownerMembership.user_id)
  if (!userResp?.user?.email) return null

  return {
    organisationId: org.id,
    ownerUserId: ownerMembership.user_id,
    ownerEmail: userResp.user.email,
    organisationName: org.name,
  }
}

/**
 * Find-or-create a Stripe Customer for the organisation. Returns the
 * Stripe customer ID. Persists `organisations.stripe_customer_id` on
 * create. Idempotent: subsequent calls return the same ID without a
 * Stripe API call.
 */
export async function findOrCreateCustomerForOrg(
  organisationId: string,
): Promise<string> {
  const svc = createServiceRoleClient()

  const { data: existing } = await svc
    .from('organisations')
    .select('stripe_customer_id')
    .eq('id', organisationId)
    .maybeSingle()

  if (existing?.stripe_customer_id) return existing.stripe_customer_id

  const ctx = await getOrgOwnerContext(organisationId)
  if (!ctx) {
    throw new Error(
      `findOrCreateCustomerForOrg: no owner context for org ${organisationId}`,
    )
  }

  const stripe = await getStripeClient()
  const customer = await stripe.customers.create({
    email: ctx.ownerEmail,
    name: ctx.organisationName,
    metadata: {
      organisation_id: organisationId,
      owner_user_id: ctx.ownerUserId,
    },
  })

  await svc
    .from('organisations')
    .update({ stripe_customer_id: customer.id })
    .eq('id', organisationId)

  return customer.id
}
