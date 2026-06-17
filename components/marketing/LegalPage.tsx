/**
 * LegalPage — shared chrome for the Privacy / Terms stubs under (marketing).
 *
 * Inter typography, tokens (pinned dark by the marketing layout), Wordmark
 * header, back-to-home + footer. Content is placeholder prose flagged for
 * legal review (see each page).
 */

import Link from 'next/link'
import type { ReactNode } from 'react'

import { Wordmark } from '@/components/brand/Wordmark'

export function LegalPage({
  title,
  lastUpdated,
  children,
}: {
  title: string
  lastUpdated: string
  children: ReactNode
}) {
  return (
    <div
      style={{
        background: 'var(--color-bg-base)',
        color: 'var(--color-text-primary)',
        minHeight: '100vh',
        fontFamily: 'var(--font-inter), system-ui, sans-serif',
      }}
    >
      <nav
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '18px clamp(20px, 5vw, 48px)',
          borderBottom: '1px solid var(--color-border-subtle)',
          maxWidth: 1100,
          margin: '0 auto',
        }}
      >
        <Wordmark size="compact" as="a" href="/" ariaLabel="Stelavox home" />
        <Link
          href="/"
          style={{ fontSize: 13, color: 'var(--color-text-secondary)', textDecoration: 'none' }}
        >
          ← Home
        </Link>
      </nav>

      <main
        style={{
          maxWidth: 720,
          margin: '0 auto',
          padding: 'clamp(40px, 7vw, 64px) clamp(20px, 5vw, 32px)',
        }}
      >
        <h1
          style={{
            fontFamily: 'var(--font-lora), Georgia, serif',
            fontWeight: 500,
            fontSize: 'clamp(26px, 5vw, 34px)',
            margin: 0,
          }}
        >
          {title}
        </h1>
        <p style={{ color: 'var(--color-text-muted)', fontSize: 12, margin: '10px 0 0' }}>
          Last updated {lastUpdated}
        </p>
        <div
          style={{
            marginTop: 32,
            fontSize: 14,
            lineHeight: 1.75,
            color: 'var(--color-text-secondary)',
          }}
        >
          {children}
        </div>
      </main>

      <footer
        style={{
          padding: '36px clamp(20px, 5vw, 40px)',
          borderTop: '1px solid var(--color-border-subtle)',
          display: 'flex',
          gap: 18,
          flexWrap: 'wrap',
          justifyContent: 'center',
          fontSize: 12,
          color: 'var(--color-text-muted)',
        }}
      >
        <Link href="/privacy" style={{ color: 'var(--color-text-secondary)', textDecoration: 'none' }}>
          Privacy
        </Link>
        <Link href="/terms" style={{ color: 'var(--color-text-secondary)', textDecoration: 'none' }}>
          Terms
        </Link>
        <span>© 2026 Stelavox</span>
      </footer>
    </div>
  )
}

/** Section heading used inside legal copy. */
export function LegalH2({ children }: { children: ReactNode }) {
  return (
    <h2
      style={{
        fontSize: 16,
        fontWeight: 600,
        color: 'var(--color-text-primary)',
        margin: '28px 0 8px',
      }}
    >
      {children}
    </h2>
  )
}
