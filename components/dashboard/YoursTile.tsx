'use client'

// Phase 8.01.D T-8 — YoursTile.
//
// Third tile in the first-time philosophy strip. Spec lock per
// Component Spec v2.21 §18.6: 28×28 verdigris dot icon in a 1px
// rgba(61,120,88,0.35) border, headline + body, lock line with the
// locked copy ENCRYPTED AT REST · PRIVATE TO YOUR ACCOUNT.
//
// Open Inviolable audit item flagged in CLAUDE.md v1.46: the decorative
// verdigris dot is treated as brand-mark reinforcement (use #1 family)
// pending the next Inviolable audit. Captured here so the next audit
// has a single grep target.

export function YoursTile() {
  return (
    <div
      data-testid="yours-tile"
      style={{
        background: 'var(--color-bg-elevated)',
        border: '1px solid var(--color-border-subtle)',
        borderRadius: 8,
        padding: '18px 20px',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <div
        aria-hidden="true"
        data-testid="yours-tile-dot"
        style={{
          width: 28,
          height: 28,
          border: '1px solid rgba(61,120,88,0.35)',
          borderRadius: 6,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 4,
        }}
      >
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            // DR-057: decorative dot, not a catalogued verdigris use →
            // neutral token (keeps Inviolable #2 enumeration exact at 12).
            background: 'var(--color-text-muted)',
            display: 'inline-block',
          }}
        />
      </div>
      <h3
        style={{
          fontFamily: 'var(--font-inter), Inter, sans-serif',
          fontWeight: 500,
          fontSize: 14,
          color: 'var(--color-text-primary)',
          margin: 0,
        }}
      >
        Your work, yours alone
      </h3>
      <p
        style={{
          fontFamily: 'var(--font-inter), Inter, sans-serif',
          fontSize: 12,
          color: 'var(--color-text-secondary)',
          lineHeight: 1.55,
          margin: 0,
        }}
      >
        Every project belongs to you. Export anytime, in standard formats. No lock-in.
      </p>
      <div
        data-testid="yours-tile-lock-line"
        style={{
          marginTop: 6,
          paddingTop: 10,
          borderTop: '1px solid var(--color-border-subtle)',
          fontFamily: 'ui-monospace, "JetBrains Mono", SFMono-Regular, Menlo, monospace',
          fontSize: 10.5,
          color: 'var(--color-text-muted)',
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        <span
          aria-hidden="true"
          style={{
            width: 4,
            height: 4,
            borderRadius: '50%',
            // DR-057: decorative lock-line dot → neutral token (not verdigris).
            background: 'var(--color-text-muted)',
            display: 'inline-block',
          }}
        />
        Encrypted at rest · Private to your account
      </div>
    </div>
  )
}
