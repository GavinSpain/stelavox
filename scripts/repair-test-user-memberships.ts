/**
 * Phase 8.5c — Local test-DB repair: backfill `organisation_members`
 * for seeded test users that were created before the
 * `on_auth_user_created` trigger or whose trigger insert failed for
 * some other reason.
 *
 * Symptom this fixes: tests like `tests/integration/canonical-order.test.ts`
 * fail at `beforeAll` with "seeded user has no organisation_members row"
 * — they look up a known fixture user, then immediately read their
 * org membership; if the membership row is missing the test setup
 * throws and every case in the file skips.
 *
 * Behaviour:
 *   - For each known fixture-user email, looks up the user.
 *   - If the user has no organisation_members row, creates a
 *     dedicated org named after them and inserts a membership row as
 *     'owner'.
 *   - Idempotent — re-running is a no-op when memberships exist.
 *
 * Usage:  `npm run script scripts/repair-test-user-memberships.ts`
 *
 * Run after `supabase db reset` or whenever a CI / local DB is found
 * with seeded auth.users rows but missing organisation_members rows.
 *
 * The script writes via service-role client so it bypasses RLS. It
 * does not touch the production / cloud DB — the SUPABASE_URL it reads
 * is the local one from `.env.local`.
 */

import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/types/database'

const FIXTURE_USER_EMAILS = [
  'j5-walk@example.com',
  '_stelavox_probes@stelavox.local',
  'test-a@example.com',
]

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env.')
    process.exit(1)
  }
  if (url.includes('supabase.co')) {
    console.error('Refusing to run against a cloud Supabase URL.')
    process.exit(1)
  }

  const admin = createClient<Database>(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  let created = 0
  let alreadyOk = 0
  let notFound = 0

  for (const email of FIXTURE_USER_EMAILS) {
    const { data: users } = await admin.auth.admin.listUsers({ perPage: 500 })
    const user = users?.users?.find((u) => u.email === email)
    if (!user) {
      console.log(`[skip] user not found: ${email}`)
      notFound++
      continue
    }
    const { data: existing } = await admin
      .from('organisation_members')
      .select('organisation_id')
      .eq('user_id', user.id)
      .maybeSingle()
    if (existing) {
      console.log(`[ok]   ${email} already has membership in org ${existing.organisation_id}`)
      alreadyOk++
      continue
    }
    const username = email.split('@')[0]!
    const slug = username.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'user'
    const slugWithSuffix = `${slug}-${user.id.slice(0, 8)}`

    const { data: org, error: orgErr } = await admin
      .from('organisations')
      .insert({ name: username, slug: slugWithSuffix })
      .select('id')
      .single()
    if (orgErr || !org) {
      console.error(`[err]  failed to create org for ${email}: ${orgErr?.message}`)
      continue
    }
    const { error: memErr } = await admin
      .from('organisation_members')
      .insert({ organisation_id: org.id, user_id: user.id, role: 'owner' })
    if (memErr) {
      console.error(`[err]  failed to insert membership for ${email}: ${memErr.message}`)
      continue
    }
    console.log(`[new]  created org+membership for ${email} → ${org.id}`)
    created++
  }

  console.log('')
  console.log(`Repair complete: ${created} created, ${alreadyOk} already ok, ${notFound} not found.`)
}

void main()
