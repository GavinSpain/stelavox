import Link from 'next/link'
import { BackLink } from '@/components/nav/BackLink'

/**
 * V1.x-B.1.2 — /settings index. (Phase 8 nav cleanup: surface is named
 * "Account" to disambiguate from the project page's Settings tab. URL
 * stays /settings for backward compat.)
 *
 * Account hub. V1.x-B.1.2 ships the API keys row only; future account
 * sub-pages (notifications, profile, billing, etc.) grow here.
 */
export default function SettingsIndexPage() {
  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '24px 32px' }}>
      {/* Phase 8 nav back-affordance.
         Sub-pages of /settings still use a hierarchical "← Account"
         pattern (they have a clear parent). The landing page's back
         link is contextual — it returns the user to whichever surface
         they entered from (project page, document, scheduler, dashboard).
         Falls back to /dashboard when there is no prior in-app history
         (bookmark, refresh, new tab). See components/nav/BackLink.tsx
         for the rationale. Updated 2026-06-09 from a fixed "← Dashboard"
         link. */}
      <div style={{ marginBottom: 16 }}>
        <BackLink fallbackHref="/dashboard" />
      </div>
      <h1
        style={{
          fontFamily: 'var(--font-inter), Inter, sans-serif',
          fontSize: 22,
          fontWeight: 500,
          margin: '0 0 16px',
          color: 'var(--color-text-primary)',
        }}
      >
        Account
      </h1>
      {/* Phase 8 nav cleanup follow-up (2026-06-09): every Link below
         uses `replace` so navigating within the Account hub doesn't
         grow browser history. Pairs with the `replace` on each sub-
         page's ← Account link. Effect: history stays at depth 1
         throughout the hub, BackLink's router.back() always lands on
         the real origin (project page, document, etc.), and the
         previous Account ↔ sub-page loop is broken. */}
      <ul
        data-testid="settings-index-list"
        style={{
          listStyle: 'none',
          margin: 0,
          padding: 0,
          border: '1px solid var(--color-border-subtle)',
          borderRadius: 8,
          background: 'var(--color-bg-base)',
        }}
      >
        <li style={{ borderBottom: '1px solid var(--color-border-subtle)' }}>
          <Link
            href="/settings/api-keys"
            replace
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '12px 16px',
              textDecoration: 'none',
              color: 'var(--color-text-primary)',
              fontFamily: 'var(--font-inter), Inter, sans-serif',
              fontSize: 13,
            }}
          >
            <div>
              <div style={{ fontWeight: 500 }}>API keys (personal)</div>
              <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>
                Per-user BYOK Anthropic key (V1.x-C transition window — migrating to per-org)
              </div>
            </div>
            <span style={{ color: 'var(--color-text-muted)', fontSize: 14 }}>›</span>
          </Link>
        </li>
        <li style={{ borderBottom: '1px solid var(--color-border-subtle)' }}>
          <Link
            href="/settings/org-api-keys"
            replace
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '12px 16px',
              textDecoration: 'none',
              color: 'var(--color-text-primary)',
              fontFamily: 'var(--font-inter), Inter, sans-serif',
              fontSize: 13,
            }}
          >
            <div>
              <div style={{ fontWeight: 500 }}>Organisation API keys</div>
              <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>
                Per-org BYOK Anthropic key (BYOK Solo / BYOK Team plans only)
              </div>
            </div>
            <span style={{ color: 'var(--color-text-muted)', fontSize: 14 }}>›</span>
          </Link>
        </li>
        <li style={{ borderBottom: '1px solid var(--color-border-subtle)' }}>
          <Link
            href="/settings/usage"
            replace
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '12px 16px',
              textDecoration: 'none',
              color: 'var(--color-text-primary)',
              fontFamily: 'var(--font-inter), Inter, sans-serif',
              fontSize: 13,
            }}
          >
            <div>
              <div style={{ fontWeight: 500 }}>Usage &amp; Billing</div>
              <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>
                Period usage, allocation, days remaining (tokens for BYOK plans)
              </div>
            </div>
            <span style={{ color: 'var(--color-text-muted)', fontSize: 14 }}>›</span>
          </Link>
        </li>
        <li>
          <Link
            href="/settings/plan"
            replace
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '12px 16px',
              textDecoration: 'none',
              color: 'var(--color-text-primary)',
              fontFamily: 'var(--font-inter), Inter, sans-serif',
              fontSize: 13,
            }}
          >
            <div>
              <div style={{ fontWeight: 500 }}>Plan</div>
              <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>
                Current subscription, plan tiers, BYOK eligibility (read-only in V1)
              </div>
            </div>
            <span style={{ color: 'var(--color-text-muted)', fontSize: 14 }}>›</span>
          </Link>
        </li>
      </ul>
    </div>
  )
}
