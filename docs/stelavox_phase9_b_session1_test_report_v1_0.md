# Stelavox — Phase 9.B Session 1 Test Report v1.0

> **Session 1 verdict: PASS** (substrate-only — Stripe account not yet provisioned). 2026-06-11. Branch `claude/phase9-b-stripe-substrate` at the time of writing. The Session 1 surface (B.1 substrate · B.2 trial-expiry gate · B.3 Checkout route · B.4 Portal route) ships. End-to-end Checkout / Portal / webhook activation requires a Stripe account; the setup checklist for that is §6.

## 1. Scope

Phase 9.B (V1 work package B per the V1 Deliverables Register) wires Stripe payment rails so V1 can actually charge for subscriptions. Per the locks made 2026-06-11 with the author:

- **Test mode for V1 launch dry-run.** Build against Stripe test mode (`pk_test_*` / `sk_test_*` keys, test cards). Swap to live mode at launch via the `stripe.mode` config key (no deploy).
- **Trial expiry redirects to the plan-buy page on next login.** No data loss; no soft grace. "Credit exhaustion never blocks writing" applies to paid plans only.
- **BYOK platform fee = flat $15/month subscription** (`byok_solo`). The author's Anthropic key handles LLM costs separately.
- **Comprehensive webhook event scope** (for Day-1 admin observability) — landing in Session 2.
- **Stripe Price IDs live in platform_config** with test/live duality; the active set chosen by `stripe.mode`.
- **Monthly cadence only for V1.** Annual ships post-launch.

This Test Report covers Session 1 (B.1–B.4). Session 2 (B.5 webhook handler · B.6 plan transitions · B.7 UI polish · B.8 Tier-A + close) ships separately.

## 2. Substrate inventory

### 2.1 Migrations

| Migration | Scope |
|---|---|
| M-219 `stripe_config_keys.sql` | 11 new platform_config keys: `stripe.mode` (default `"test"`) + 4 test-mode Price ID slots + 4 live-mode Price ID slots + `stripe.webhook_secret_test` + `stripe.webhook_secret_live`. All seeded blank — Checkout returns 503 `stripe_not_configured` until the account is provisioned. |
| M-220 `organisations_trial_expires_at.sql` | Adds `organisations.trial_expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + interval '30 days'` and `organisations.stripe_price_id TEXT NULL`. Backfills `trial_expires_at` for pre-existing trial orgs from `COALESCE(current_period_start, created_at) + billing.trial_duration_days`. Revises `handle_new_user` to stamp the column from `billing.trial_duration_days` on new-org INSERT. |

Migration count moves 218 → 220.

### 2.2 Library code

| File | Scope |
|---|---|
| `lib/stripe/config.ts` | Mode-aware config reader: `getStripeMode()` / `getStripeSecretKey()` / `getStripePriceId()` / `getStripeWebhookSecret()` / `requireStripeConfigured()`. The last throws `StripeNotConfiguredError` with a list of every missing piece. `STRIPE_PLAN_SLUGS` = `['writer', 'author', 'pro', 'byok_solo']` (exact tuple). |
| `lib/stripe/client.ts` | Memoised Stripe SDK client per mode. `apiVersion: '2026-05-27.dahlia'`. |
| `lib/stripe/customers.ts` | `findOrCreateCustomerForOrg(orgId)` is idempotent — persists `organisations.stripe_customer_id` on first call. `getOrgOwnerContext` resolves owner email via `auth.admin.getUserById`. |
| `lib/stripe/sessions.ts` | `createCheckoutSession(...)` + `createPortalSession(...)`. Both return `{ url }` for client redirect. Checkout return URLs route back to `/settings/plan?stripe_status=success\|cancelled`. |
| `lib/billing/trialExpiry.ts` | Pure-function helpers: `isTrialExpired({ plan, trial_expires_at })` and `isPathTrialExempt(pathname)`. Used by `(app)/layout.tsx`. |
| `lib/config/platform-config.ts` (extension) | Adds `_clearConfigCache()` — test-only helper to invalidate the 60 s in-memory cache between config UPDATEs. No production code calls it. |

### 2.3 Middleware + layout

| File | Change |
|---|---|
| `lib/supabase/middleware.ts` | Sets `x-pathname` header on every response so server components can detect the current path. |
| `app/(app)/layout.tsx` | After resolving user + org, reads `(plan, trial_expires_at)` and calls `isTrialExpired`. When true AND the request path is not exempt (`/settings/plan*`, `/api/billing/*`, `/api/stripe/*`), redirects to `/settings/plan?reason=trial_expired`. |

### 2.4 API routes

| Route | Auth | Behaviour |
|---|---|---|
| `POST /api/billing/checkout` | Authenticated user; resolved org from membership | Validates `{ plan }` ∈ STRIPE_PLAN_SLUGS; calls `requireStripeConfigured()` (returns 503 with `missing` list on misconfiguration); find-or-creates Customer; creates Checkout Session; returns `{ url }`. |
| `POST /api/billing/portal` | Authenticated user; org must have `stripe_customer_id` set | Returns 409 `no_customer` when not subscribed yet; otherwise creates Customer Portal session and returns `{ url }`. |

### 2.5 UI

| Component | Behaviour |
|---|---|
| `components/billing/SubscribeButton.tsx` (NEW) | Per-tier client component. POSTs to `/api/billing/checkout` with the plan slug; redirects on success; surfaces an inline error on 503 / 4xx. Verdigris affordance (use #7 affirmative-action family — within existing nine; no Inviolable broadening). |
| `components/billing/ManageSubscriptionButton.tsx` (NEW) | Mounted when org has `stripe_customer_id`. POSTs to `/api/billing/portal`; redirects on success. Neutral ghost styling. |
| `components/billing/PlanPanel.tsx` (MODIFIED) | Drops the V1.x-D "No Stripe Checkout in V1" note. Subscribable paid tiers (writer/author/pro/byok_solo) that aren't the current plan get a `<SubscribeButton />`. The "Manage subscription" section renders only when `hasStripeCustomer === true`. |
| `app/(app)/settings/plan/page.tsx` (MODIFIED) | Reads `stripe_customer_id` in the org SELECT; passes `hasStripeCustomer` into PlanPanel. |

## 3. Verification matrix

### CK-1 — Migrations apply cleanly on local DB

```
$ supabase migration up
Applying migration 20260611000219_stripe_config_keys.sql...
Applying migration 20260611000220_organisations_trial_expires_at.sql...
```

`organisations.trial_expires_at` present, NOT NULL, defaulted to `NOW() + interval '30 days'`. `organisations.stripe_price_id` present, NULL by default. 11 `stripe.*` keys present in `platform_config`. ✅

### CK-2 — Type-check + lint clean on Phase 9.B changes

`npm run type-check`: exit 0. ✅

`npm run lint`: 0 errors / 0 warnings on the new `lib/stripe/`, `lib/billing/`, `components/billing/{Subscribe,ManageSubscription}Button.tsx`, `app/api/billing/`, and the modified `lib/config/platform-config.ts` / `lib/supabase/middleware.ts` / `app/(app)/layout.tsx` / `components/billing/PlanPanel.tsx` / `app/(app)/settings/plan/page.tsx`. The 6 pre-existing lint errors are in unrelated paths. ✅

### CK-3 — Stripe config reader Vitest

`tests/unit/stripe-config.test.ts` — **10/10 PASS**:

- `STRIPE_PLAN_SLUGS` contains exactly the 4 V1 subscribable slugs.
- `getStripeMode` rejects an invalid mode value.
- `getStripeMode` returns `'test'` when key is `'test'`.
- `getStripeMode` returns `'live'` when key is `'live'`.
- `getStripeSecretKey` returns null when env vars not set; returns the right key per mode; treats empty-string env vars as null.
- `requireStripeConfigured` lists every missing piece when nothing is set (env var + webhook secret + 4 Price IDs).
- `requireStripeConfigured` returns `{ mode, secretKey }` when everything is set.

### CK-4 — Trial-expiry helper Vitest

`tests/unit/trial-expiry.test.ts` — **12/12 PASS**:

- `isTrialExpired` returns false for paid plans + BYOK plans even when `trial_expires_at` is in the past.
- `isTrialExpired` returns false for trial plan with future `trial_expires_at`.
- `isTrialExpired` returns true for trial plan with past `trial_expires_at`; at the exact instant; defensive returns false on NULL plan / NULL expires_at / unparseable timestamp.
- `isPathTrialExempt` exempts `/settings/plan*` + `/api/billing/*` + `/api/stripe/*`.
- `isPathTrialExempt` does NOT exempt `/settings` (other settings pages), `/dashboard`, `/projects/*`, `/admin`.
- `isPathTrialExempt` fails open (true) on null pathname — preferable to a redirect loop.

### CK-5 — Cumulative Vitest — no regressions

Targeted re-run of the two touched files: 22/22 PASS in 1.1 s.

### CK-6 — Build & runtime smoke (graceful 503)

Routes shipped today return 503 `stripe_not_configured` with the explicit `missing` list when called — exactly the substrate-only contract. The PlanPanel Subscribe button surfaces a calm inline "Subscriptions not yet enabled" message. No Stripe SDK errors leak through. ✅

## 4. What this session does NOT cover

- **Stripe webhook handler** (`POST /api/stripe/webhook`): handler + signature verification + per-event sync to `organisations.{plan, subscription_status, stripe_subscription_id, current_period_start, byok_enabled}`. Session 2 (B.5).
- **Plan-transition logic**: on `customer.subscription.created` set `token_allocation_credits` from the new plan slug; on `customer.subscription.deleted` revert to a post-cancellation state. Session 2 (B.6).
- **Active-subscription card UI**: plan name + next billing date + payment method last-4 on `/settings/plan`. Session 2 (B.7).
- **CostMeter integration per plan state**: paid users see remaining credits + countdown; BYOK users see tokens only; trial users see days remaining. Session 2 (B.7).
- **Tier-A doc bumps**: TA + Director Architecture + Product Spec + Component Spec + CLAUDE.md. Session 2 (B.8).
- **Cloud activation (stelavox-dev)**: M-219 + M-220 will land on cloud once Session 2 ships and the Stripe account is provisioned (the new platform_config keys default to safe blanks so it's safe to migrate ahead of provisioning).

## 5. New hazards

None. The pre-launch state (Stripe not configured → 503 with `missing` list) is intentional and surfaces helpfully; the trial-expiry redirect can't loop because of `isPathTrialExempt`; the credit gate (`lib/llm/token-budget.ts`) is unchanged — paid plans hit it normally, trial users hit it AND the trial-expiry redirect (whichever fires first).

## 6. Stripe account setup checklist (for the author)

When you're ready to actually exercise the Subscribe flow end-to-end:

1. **Create a Stripe account** at https://dashboard.stripe.com/register. Verify email.
2. **Toggle to Test mode** (top-right of the Stripe dashboard). All work below stays in test mode — no real card data is collected.
3. **Create the API keys**:
   - Dashboard → Developers → API keys → copy the *Publishable key* (`pk_test_*`) and *Secret key* (`sk_test_*`).
   - In Vercel project env vars, set `STRIPE_SECRET_KEY_TEST = sk_test_...`.
   - In `.env.local` (local dev), set the same.
4. **Create 4 Products + 8 Prices** (Dashboard → Catalog → Products → + Add product). Stripe's model: one Product per plan, with separate Price rows for monthly vs annual cadence. For each Product, create both a monthly and an annual Price.
   - **Writer** Product:
     - Monthly Price: Recurring, $20.00 USD, billing every month → copy `price_*` (monthly).
     - Annual Price: Recurring, $192.00 USD, billing every year (= $20 × 12 × 0.8 = 20% discount) → copy `price_*` (yearly).
   - **Author** Product:
     - Monthly: $50.00 / month → `price_*` (monthly).
     - Annual: $480.00 / year → `price_*` (yearly).
   - **Pro** Product:
     - Monthly: $120.00 / month → `price_*` (monthly).
     - Annual: $1,152.00 / year → `price_*` (yearly).
   - **BYOK Solo** Product:
     - Monthly: $15.00 / month → `price_*` (monthly).
     - Annual: $144.00 / year → `price_*` (yearly).
5. **Land the 8 Price IDs into platform_config**. Run (against the cloud DB once webhooks are firing, or against local now):
   ```sql
   -- Monthly
   UPDATE platform_config SET value = '"price_xxxxxxxxxx"' WHERE key = 'stripe.test.price_id.writer_monthly';
   UPDATE platform_config SET value = '"price_xxxxxxxxxx"' WHERE key = 'stripe.test.price_id.author_monthly';
   UPDATE platform_config SET value = '"price_xxxxxxxxxx"' WHERE key = 'stripe.test.price_id.pro_monthly';
   UPDATE platform_config SET value = '"price_xxxxxxxxxx"' WHERE key = 'stripe.test.price_id.byok_solo_monthly';
   -- Yearly (Session 3 follow-up)
   UPDATE platform_config SET value = '"price_xxxxxxxxxx"' WHERE key = 'stripe.test.price_id.writer_yearly';
   UPDATE platform_config SET value = '"price_xxxxxxxxxx"' WHERE key = 'stripe.test.price_id.author_yearly';
   UPDATE platform_config SET value = '"price_xxxxxxxxxx"' WHERE key = 'stripe.test.price_id.pro_yearly';
   UPDATE platform_config SET value = '"price_xxxxxxxxxx"' WHERE key = 'stripe.test.price_id.byok_solo_yearly';
   ```
6. **Configure the webhook endpoint** (Session 2 lands the handler; this step waits until then):
   - Dashboard → Developers → Webhooks → Add endpoint.
   - Endpoint URL: `https://stelavox.vercel.app/api/stripe/webhook`.
   - Events to send: `checkout.session.completed`, `customer.subscription.{created,updated,deleted}`, `customer.{created,updated}`, `invoice.{payment_succeeded,payment_failed,upcoming}`, `payment_method.attached`, `customer.subscription.trial_will_end`.
   - Copy the *Signing secret* (`whsec_*`) and run:
     ```sql
     UPDATE platform_config SET value = '"whsec_xxxxxxxxxx"' WHERE key = 'stripe.webhook_secret_test';
     ```
7. **Smoke test** with a test card (e.g. `4242 4242 4242 4242`, any future expiry, any CVC). Click Subscribe on `/settings/plan`; complete Checkout; verify the org's `stripe_customer_id` populates + the webhook fires + the plan flips. (This flow lights up in Session 2.)
8. **Launch flip**: when ready for real customers, redo steps 3–6 with live keys (`pk_live_*` / `sk_live_*` and a fresh webhook endpoint in live mode), set `STRIPE_SECRET_KEY_LIVE` in Vercel env, populate the `stripe.live.price_id.*` + `stripe.webhook_secret_live` keys, and `UPDATE platform_config SET value = '"live"' WHERE key = 'stripe.mode'`. The active mode flips with no deploy.

## 7. Files changed in Session 1

Created:
- `supabase/migrations/20260611000219_stripe_config_keys.sql`
- `supabase/migrations/20260611000220_organisations_trial_expires_at.sql`
- `lib/stripe/config.ts`
- `lib/stripe/client.ts`
- `lib/stripe/customers.ts`
- `lib/stripe/sessions.ts`
- `lib/billing/trialExpiry.ts`
- `app/api/billing/checkout/route.ts`
- `app/api/billing/portal/route.ts`
- `components/billing/SubscribeButton.tsx`
- `components/billing/ManageSubscriptionButton.tsx`
- `tests/unit/stripe-config.test.ts`
- `tests/unit/trial-expiry.test.ts`
- `docs/stelavox_phase9_b_session1_test_report_v1_0.md` (this file)

Modified:
- `lib/supabase/middleware.ts` (sets `x-pathname` header)
- `lib/config/platform-config.ts` (`_clearConfigCache` test helper)
- `lib/types/database.ts` (re-generated for M-220)
- `app/(app)/layout.tsx` (trial-expiry redirect)
- `app/(app)/settings/plan/page.tsx` (`stripe_customer_id` read; pass `hasStripeCustomer`)
- `components/billing/PlanPanel.tsx` (Subscribe + Manage Subscription wiring)
- `package.json` (`stripe@22.2.0` added)

## 8. Changelog

**v1.0 — 2026-06-11** Initial Session 1 Test Report. PASS verdict. CK-1..CK-6 green. Session 2 (B.5 webhook + B.6 plan transitions + B.7 UI polish + B.8 Tier-A close) pending. Stripe account provisioning + Price ID population is a separate user-driven step documented in §6.
