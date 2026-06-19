/**
 * (marketing) route group layout — the public, logged-out surface.
 *
 * Detached from the (app) AppShell and the (admin) shell: no app nav, no
 * auth gate (the landing page itself bounces logged-in users to /dashboard).
 *
 * The marketing surface is fixed confident-dark (tone D4·B). We pin the core
 * design tokens to their dark values on this wrapper so the page stays dark
 * even for a returning visitor whose theme preference is light — inline
 * custom properties override the inherited [data-theme="light"] values for
 * this subtree only.
 */

import { Analytics } from '@vercel/analytics/next'
import type { CSSProperties } from 'react'

// "Warm dusk library" — the marketing front door uses a warmer, more
// inviting palette than the app's cool dark (walnut-dark + ivory pages +
// verdigris as the green reading-lamp). The marketing surface is a separate
// brand surface (landing-page spec §5) and isn't bound by the app's tokens;
// verdigris stays the brand accent, everything else warms toward candlelight.
const DARK_SURFACE = {
  '--color-bg-base': '#12100c',
  '--color-bg-surface': '#1a160f',
  '--color-bg-elevated': '#221d14',
  '--color-border-subtle': '#272016',
  '--color-border-default': '#332a1d',
  '--color-border-strong': '#4a3f2c',
  '--color-text-primary': '#f1ead9',
  '--color-text-secondary': '#b0a48d',
  '--color-text-muted': '#7c7159',
  '--color-accent': '#3d7858',
  '--color-accent-hover': '#62b583',
  '--color-accent-muted': '#1d2a1c',
  '--color-error': '#c25a4a',
} as CSSProperties

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={DARK_SURFACE} data-surface="marketing">
      {children}
      {/* D3 — Vercel Analytics on the public surface (privacy-friendly, zero-config). */}
      <Analytics />
    </div>
  )
}
