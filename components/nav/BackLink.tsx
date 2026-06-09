'use client'

/**
 * BackLink — small "← Back" affordance for destination pages reached
 * from multiple entry contexts (Settings, Admin, etc.).
 *
 * Phase 8 nav cleanup (2026-06-09): the /settings landing page used to
 * hard-link "← Dashboard" regardless of entry path, which overrode the
 * user's mental model when they reached Settings from a project page
 * or document. The contextual-back pattern returns the user to wherever
 * they actually came from — what every other modern app does for Settings
 * (Gmail / Notion / Linear close their settings overlays back to context;
 * GitHub / Stripe don't have explicit in-page back links at all).
 *
 * Implementation: a real <Link> with the fallback href is rendered. The
 * onClick handler prefers router.back() when this tab has prior in-app
 * history (history.length > 1). When the user hit /settings via a
 * bookmark, refresh, or new tab there is no prior history; the Link's
 * normal navigation fires and they land on the fallback (typically
 * /dashboard).
 *
 * Using a real Link instead of a button gives:
 *   - Right-click → open in new tab works with the fallback target
 *   - The browser's link-preview hover shows the fallback URL
 *   - Keyboard navigation + screen reader semantics are correct
 *   - SSR renders a sensible href even before hydration
 *
 * Inviolable #2: no verdigris (`--color-text-secondary` muted-Inter only).
 */

import Link from 'next/link'
import { useRouter } from 'next/navigation'

interface BackLinkProps {
  /** Where to navigate when there is no prior in-app history (direct URL
   *  entry, refresh, new tab). Required so we always have a sensible
   *  destination — never leaves the user stranded. */
  fallbackHref: string
  /** Display label. Defaults to "← Back" — generic on purpose. */
  label?: string
  /** Optional override for inline styles (visual polish per surface). */
  style?: React.CSSProperties
  /** Optional test-id (per-surface identification in Playwright). */
  testid?: string
}

const DEFAULT_STYLE: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--color-text-secondary)',
  textDecoration: 'none',
  fontFamily: 'var(--font-inter), Inter, sans-serif',
}

export function BackLink({ fallbackHref, label = '← Back', style, testid }: BackLinkProps) {
  const router = useRouter()
  return (
    <Link
      href={fallbackHref}
      data-testid={testid}
      onClick={(e) => {
        // Prefer browser-back when this tab has prior in-app history.
        // Falls through to the Link's normal navigation otherwise.
        if (typeof window !== 'undefined' && window.history.length > 1) {
          e.preventDefault()
          router.back()
        }
      }}
      style={{ ...DEFAULT_STYLE, ...style }}
    >
      {label}
    </Link>
  )
}
