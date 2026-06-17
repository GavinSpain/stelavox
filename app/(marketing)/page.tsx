/**
 * / — the public landing page (Phase 13.1).
 *
 * Logged-out visitors see the landing page; logged-in users are bounced to
 * /dashboard. The CTA mode is read server-side from marketing.signup_mode
 * (waitlist → email capture · open → "Get started" → /signup), flippable with
 * a single config UPDATE — no deploy.
 */

import type { Metadata } from 'next'
import { redirect } from 'next/navigation'

import { Landing } from '@/components/marketing/Landing'
import { getConfigString } from '@/lib/config/platform-config'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://stelavox.com'
const TITLE = 'Stelavox — Write the book you’ve been carrying'
const DESCRIPTION =
  'A structured writing workspace for novelists: plan your story as a living tree, write at any layer, and call on AI that only ever helps where you point it. Your work stays yours — no lock-in. Founding access opening soon.'

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    url: SITE_URL,
    siteName: 'Stelavox',
    title: TITLE,
    description: DESCRIPTION,
  },
  twitter: {
    card: 'summary_large_image',
    title: TITLE,
    description: DESCRIPTION,
  },
}

export default async function LandingRootPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (user) redirect('/dashboard')

  let mode: 'waitlist' | 'open' = 'waitlist'
  try {
    const configured = await getConfigString('marketing.signup_mode')
    if (configured === 'open') mode = 'open'
  } catch {
    // Config unavailable → safest pre-launch default.
    mode = 'waitlist'
  }

  return <Landing mode={mode} />
}
