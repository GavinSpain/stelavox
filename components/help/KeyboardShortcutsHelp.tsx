'use client'

/**
 * Phase 8.4 — Keyboard shortcuts help overlay.
 *
 * Opened by pressing `?` anywhere outside a text input. Renders the
 * canonical shortcut list from lib/keyboard/shortcuts.ts grouped by
 * scope. Closes on Esc, outside-click, or the explicit close button.
 *
 * Inviolable audit:
 *   #1 prose surface — overlay is chrome, never overlaps prose canvas
 *   #2 verdigris — none here; close button uses neutral text tokens
 *   #3 / #6 — Inter only
 *   #4 — chrome surface, Inter
 *   #5 — N/A (not the prose editor)
 */

import { useEffect, useRef } from 'react'
import {
  SCOPE_TITLES,
  keyDisplayForPlatform,
  shortcutsByScope,
} from '@/lib/keyboard/shortcuts'

export interface KeyboardShortcutsHelpProps {
  open: boolean
  onClose: () => void
}

export function KeyboardShortcutsHelp({ open, onClose }: KeyboardShortcutsHelpProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const closeBtnRef = useRef<HTMLButtonElement | null>(null)

  // Move focus to the close button when the overlay opens so keyboard
  // users can hit Enter / Space to dismiss without reaching for the mouse.
  useEffect(() => {
    if (!open) return
    closeBtnRef.current?.focus()
  }, [open])

  // Close on Escape. Outside-click is handled by the backdrop's onClick.
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const groups = shortcutsByScope()

  return (
    <div
      data-testid="keyboard-shortcuts-help"
      role="dialog"
      aria-modal="true"
      aria-labelledby="kshelp-title"
      onClick={(e) => {
        // Outside click — only when the user clicks the backdrop, not
        // the inner card.
        if (e.target === e.currentTarget) onClose()
      }}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingTop: '10vh',
        zIndex: 200,
      }}
    >
      <div
        ref={containerRef}
        data-testid="keyboard-shortcuts-card"
        style={{
          width: 'min(640px, 92vw)',
          maxHeight: '80vh',
          overflowY: 'auto',
          background: 'var(--color-bg-elevated)',
          border: '1px solid var(--color-border-default)',
          borderRadius: 6,
          boxShadow: '0 12px 48px rgba(0,0,0,0.55)',
          padding: '20px 24px 22px',
          fontFamily: 'var(--font-inter), Inter, sans-serif',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingBottom: 12,
            borderBottom: '1px solid var(--color-border-subtle)',
            marginBottom: 12,
          }}
        >
          <h2
            id="kshelp-title"
            style={{
              margin: 0,
              fontSize: 14,
              fontWeight: 500,
              color: 'var(--color-text-primary)',
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
            }}
          >
            Keyboard shortcuts
          </h2>
          <button
            ref={closeBtnRef}
            type="button"
            data-testid="keyboard-shortcuts-close"
            onClick={onClose}
            aria-label="Close keyboard shortcuts"
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--color-text-muted)',
              cursor: 'pointer',
              fontSize: 18,
              lineHeight: 1,
              padding: 4,
              borderRadius: 3,
            }}
          >
            ×
          </button>
        </div>

        {/* Groups */}
        {groups.map(({ scope, entries }) => (
          <section
            key={scope}
            data-testid={`kshelp-group-${scope}`}
            style={{ marginBottom: 18 }}
          >
            <h3
              style={{
                margin: '0 0 8px',
                fontSize: 10,
                fontWeight: 500,
                color: 'var(--color-text-muted)',
                letterSpacing: '0.18em',
                textTransform: 'uppercase',
              }}
            >
              {SCOPE_TITLES[scope]}
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {entries.map((entry) => (
                <div
                  key={entry.id}
                  data-testid={`kshelp-row-${entry.id}`}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '100px 1fr',
                    alignItems: 'center',
                    gap: 14,
                    padding: '4px 0',
                    fontSize: 12.5,
                  }}
                >
                  <kbd
                    style={{
                      fontFamily: 'ui-monospace, "JetBrains Mono", SFMono-Regular, Menlo, monospace',
                      fontSize: 11,
                      color: 'var(--color-text-primary)',
                      background: 'var(--color-bg-surface)',
                      border: '1px solid var(--color-border-default)',
                      borderRadius: 3,
                      padding: '3px 8px',
                      textAlign: 'center',
                      width: 'fit-content',
                    }}
                  >
                    {keyDisplayForPlatform(entry.keyDisplay)}
                  </kbd>
                  <span style={{ color: 'var(--color-text-secondary)' }}>{entry.label}</span>
                </div>
              ))}
            </div>
          </section>
        ))}

        {/* Footer hint */}
        <div
          style={{
            fontSize: 10.5,
            color: 'var(--color-text-muted)',
            fontStyle: 'italic',
            paddingTop: 8,
            borderTop: '1px solid var(--color-border-subtle)',
          }}
        >
          Press <kbd style={kbdInline}>?</kbd> anywhere outside a text field to open this list. Press <kbd style={kbdInline}>Esc</kbd> to close.
        </div>
      </div>
    </div>
  )
}

const kbdInline: React.CSSProperties = {
  fontFamily: 'ui-monospace, "JetBrains Mono", SFMono-Regular, Menlo, monospace',
  fontSize: 10,
  color: 'var(--color-text-secondary)',
  background: 'var(--color-bg-surface)',
  border: '1px solid var(--color-border-subtle)',
  borderRadius: 2,
  padding: '1px 5px',
  margin: '0 2px',
}
