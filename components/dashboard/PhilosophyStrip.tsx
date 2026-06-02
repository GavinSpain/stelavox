// Phase 8.01.D T-8 — 3-tile philosophy strip for the first-time dashboard.
//
// Spec: Component Spec v2.21 §18.4 (first-time shape).
// Three tiles: Structure-first writing · A Director, not an author · YoursTile.

import { YoursTile } from './YoursTile'

interface TileProps {
  icon: string
  headline: string
  body: string
  testid: string
}

function Tile({ icon, headline, body, testid }: TileProps) {
  return (
    <div
      data-testid={testid}
      style={{
        background: 'var(--color-bg-elevated)',
        border: '1px solid var(--color-border-subtle)',
        borderRadius: 8,
        padding: '18px 20px',
      }}
    >
      <div
        aria-hidden="true"
        style={{
          width: 28,
          height: 28,
          borderRadius: 6,
          background: 'var(--color-bg-base)',
          border: '1px solid var(--color-border-default)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 12,
          fontFamily: 'ui-monospace, "JetBrains Mono", SFMono-Regular, Menlo, monospace',
          fontSize: 13,
          color: 'var(--color-text-primary)',
        }}
      >
        {icon}
      </div>
      <h3
        style={{
          fontFamily: 'var(--font-inter), Inter, sans-serif',
          fontWeight: 500,
          fontSize: 14,
          color: 'var(--color-text-primary)',
          margin: '0 0 6px',
        }}
      >
        {headline}
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
        {body}
      </p>
    </div>
  )
}

export function PhilosophyStrip() {
  return (
    <div
      data-testid="philosophy-strip"
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
        gap: 16,
        maxWidth: 900,
        width: '100%',
        marginTop: 36,
      }}
    >
      <Tile
        testid="philosophy-tile-structure"
        icon="⟁"
        headline="Structure-first writing"
        body="Build a tree of Books, Acts, Chapters, Scenes and Beats. Write at any level, from outline to prose."
      />
      <Tile
        testid="philosophy-tile-director"
        icon="◇"
        headline="A Director, not an author"
        body="The AI helps you plan, expand, and refine — but it always proposes. You approve every change."
      />
      <YoursTile />
    </div>
  )
}
