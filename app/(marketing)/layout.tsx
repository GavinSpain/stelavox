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

const DARK_SURFACE = {
  '--color-bg-base': '#0d1014',
  '--color-bg-surface': '#131820',
  '--color-bg-elevated': '#1a2030',
  '--color-border-subtle': '#1e2535',
  '--color-border-default': '#253045',
  '--color-border-strong': '#3a4a62',
  '--color-text-primary': '#ecf0f5',
  '--color-text-secondary': '#8aa0b8',
  '--color-text-muted': '#6884a4',
  '--color-accent': '#3d7858',
  '--color-accent-hover': '#5aa87a',
  '--color-accent-muted': '#1a3028',
  '--color-error': '#b03c3c',
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
