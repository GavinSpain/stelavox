/**
 * POST /api/waitlist — Phase 13.1 landing-page pre-launch email capture.
 *
 * Public, no auth. The actual write goes through the SECURITY DEFINER
 * join_waitlist() RPC (M-229) so the table is never directly writable or
 * readable via PostgREST; the RPC validates + flood-guards + dedupes
 * (case-insensitive) atomically and returns whether THIS call added a new
 * row, so we can show "you're on the list" vs "you're already on it".
 *
 * The real abuse limiter is the platform edge (Vercel / Cloudflare); the
 * RPC's 10s flood guard is just a runaway-burst backstop. We collect only
 * the email (Privacy Policy covers waitlist use) — no IP / PII storage.
 *
 * Source: docs/stelavox_landing_page_spec_v1_0.md §3 + §6.
 */

import { NextResponse, type NextRequest } from 'next/server'

import { createServiceRoleClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

export async function POST(req: NextRequest): Promise<Response> {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  }

  const raw = (body ?? {}) as { email?: unknown; source?: unknown }
  const email = typeof raw.email === 'string' ? raw.email.trim() : ''
  const source =
    typeof raw.source === 'string' && raw.source.trim() ? raw.source.trim().slice(0, 64) : 'landing'

  if (!email || email.length > 320 || !EMAIL_RE.test(email)) {
    return NextResponse.json({ error: 'invalid_email' }, { status: 422 })
  }

  const svc = createServiceRoleClient()
  const { data, error } = await svc.rpc('join_waitlist', { p_email: email, p_source: source })

  if (error) {
    // The RPC raises 'invalid_email' / 'rate_limited' as exceptions.
    const msg = error.message || ''
    if (msg.includes('invalid_email')) {
      return NextResponse.json({ error: 'invalid_email' }, { status: 422 })
    }
    if (msg.includes('rate_limited')) {
      return NextResponse.json({ error: 'rate_limited' }, { status: 429 })
    }
    return NextResponse.json({ error: 'waitlist_failed' }, { status: 500 })
  }

  // join_waitlist RETURNS TABLE (inserted boolean) → array of one row.
  const row = Array.isArray(data) ? (data[0] as { inserted?: boolean } | undefined) : undefined
  const inserted = row?.inserted ?? true

  return NextResponse.json({ ok: true, alreadyOnList: !inserted })
}
