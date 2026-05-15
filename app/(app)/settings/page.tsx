import Link from 'next/link'

/**
 * V1.x-B.1.2 — /settings index.
 *
 * Settings hub. V1.x-B.1.2 ships the API keys row only; future settings
 * (notifications, profile, billing, etc.) grow here.
 */
export default function SettingsIndexPage() {
  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '24px 32px' }}>
      <h1
        style={{
          fontFamily: 'var(--font-inter), Inter, sans-serif',
          fontSize: 22,
          fontWeight: 500,
          margin: '0 0 16px',
          color: 'var(--color-text-primary)',
        }}
      >
        Settings
      </h1>
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
        <li>
          <Link
            href="/settings/org-api-keys"
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
      </ul>
    </div>
  )
}
