import Link from 'next/link'
import { AnthropicKeyPanel } from '@/components/settings/AnthropicKeyPanel'

/**
 * V1.x-B.1.2 — /settings/api-keys.
 *
 * Per-user BYOK key management. Server-rendered shell + client panel
 * for the actual save / delete / status logic.
 */
export default function ApiKeysSettingsPage() {
  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '24px 32px' }}>
      <div style={{ marginBottom: 16 }}>
        {/* `replace` prevents history growth inside the Account hub —
           see app/(app)/settings/page.tsx for the hub-and-spoke
           rationale. */}
        <Link
          href="/settings"
          replace
          style={{ fontSize: 12, color: 'var(--color-text-secondary)', textDecoration: 'none', fontFamily: 'var(--font-inter), Inter, sans-serif' }}
        >
          ← Account
        </Link>
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
        API keys
      </h1>
      <AnthropicKeyPanel />
    </div>
  )
}
