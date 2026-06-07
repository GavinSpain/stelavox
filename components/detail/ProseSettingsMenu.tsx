'use client'

/**
 * Phase 8.8 — Prose Settings dropdown menu.
 *
 * Source: docs/wireframes/wireframe_phase8_8_prose_settings_menu_v1.html
 *
 * A small "⋯" button that opens a dropdown with two toggles:
 *   - Sentence Focus
 *   - Typewriter
 *
 * Both persist via the shared `useProseSettings` hook (localStorage +
 * cross-tab sync). The menu is mounted in two places — the Edit Mode
 * detail panel (next to FocusModeButton) and the Focus Mode overlay
 * (top-right corner) — and both mounts read/write the same storage.
 *
 * Inviolable audit (wireframe §"Inviolable Audit"):
 *   #1 prose surface noise — menu sits in chrome row, not the prose canvas
 *   #2 verdigris — toggle "on" uses --color-info, NOT verdigris (these are
 *      personal preferences, not affirmative-action triggers)
 *   #3 / #6 — brand-only typefaces are not referenced here (Inter only)
 *   #4 — Inter only inside the menu
 *   #5 — not a formatting toolbar; no text-style buttons
 *
 * Accessibility:
 *   - Trigger button: aria-haspopup="menu", aria-expanded reflects state,
 *     aria-label "Prose settings"
 *   - Menu container: role="menu" with labelled-by tied to a hidden caption
 *   - Each toggle row: role="menuitemcheckbox" with aria-checked
 *   - Keyboard: Escape closes, focus returns to the trigger
 *   - Outside-click closes
 */

import { useEffect, useId, useRef, useState } from 'react'
import { useProseSettings, type ProseSettingsOptions } from '@/lib/hooks/useProseSettings'

export interface ProseSettingsMenuProps {
  /** Visual variant. `edit` = standard chrome (next to FocusModeButton).
   *  `focus` = top-right corner of FocusMode overlay; fades like other
   *  Focus chrome (0.35 idle / 1.0 hover/focus/open). */
  variant?: 'edit' | 'focus'
  /** Per-surface defaults. See useProseSettings. */
  defaults?: ProseSettingsOptions
  /** Optional anchor — used by Focus Mode where the button sits inside
   *  the overlay's portal and the dropdown should align right-edge. */
  align?: 'left' | 'right'
}

export function ProseSettingsMenu({
  variant = 'edit',
  defaults,
  align,
}: ProseSettingsMenuProps) {
  const [open, setOpen] = useState(false)
  const [hover, setHover] = useState(false)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const captionId = useId()
  const settings = useProseSettings(defaults)

  // Compute alignment. Both variants default to right-aligned so the
  // dropdown's right edge tracks the button's right edge and the menu
  // extends leftward — keeps it inside the parent in Edit Mode (where
  // the ⋯ sits at the right of the chrome row) and inside the viewport
  // in Focus Mode (where the ⋯ sits in the top-right corner).
  const effectiveAlign = align ?? 'right'

  // Outside-click + Escape handlers.
  useEffect(() => {
    if (!open) return
    function onClickOutside(e: MouseEvent) {
      const target = e.target as Node | null
      if (!target) return
      if (menuRef.current?.contains(target)) return
      if (triggerRef.current?.contains(target)) return
      setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false)
        triggerRef.current?.focus()
      }
    }
    document.addEventListener('mousedown', onClickOutside)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClickOutside)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // Variant-driven button opacity. Focus Mode fades like FocusBreadcrumb
  // (0.35 steady, 1.0 on hover/focus/open). Edit Mode is fully opaque
  // always — it's just chrome in the FocusModeButton row.
  const buttonOpacity =
    variant === 'edit'
      ? 1.0
      : open || hover
        ? 1.0
        : 0.35

  return (
    <div
      style={{ position: 'relative', display: 'inline-flex' }}
      data-testid="prose-settings-menu"
      data-variant={variant}
      data-open={open}
    >
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Prose settings"
        data-testid="prose-settings-trigger"
        onClick={() => setOpen((v) => !v)}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onFocus={() => setHover(true)}
        onBlur={() => setHover(false)}
        style={{
          width: 26,
          height: 26,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'transparent',
          border: `1px solid ${
            open || hover ? 'var(--color-border-default)' : 'var(--color-border-subtle)'
          }`,
          borderRadius: 4,
          fontSize: 14,
          color: open || hover ? 'var(--color-text-secondary)' : 'var(--color-text-muted)',
          cursor: 'pointer',
          opacity: buttonOpacity,
          transition: 'opacity 200ms var(--easing-default, ease-out), color var(--duration-fast, 120ms), border-color var(--duration-fast, 120ms)',
          fontFamily: 'var(--font-inter), Inter, sans-serif',
        }}
      >
        ⋯
      </button>

      {open && (
        <div
          ref={menuRef}
          role="menu"
          aria-labelledby={captionId}
          data-testid="prose-settings-dropdown"
          style={{
            position: 'absolute',
            top: 30,
            left: effectiveAlign === 'left' ? 0 : 'auto',
            right: effectiveAlign === 'right' ? 0 : 'auto',
            background: 'var(--color-bg-elevated)',
            border: '1px solid var(--color-border-default)',
            borderRadius: 4,
            boxShadow: '0 6px 24px rgba(0,0,0,0.45)',
            padding: 6,
            minWidth: 232,
            zIndex: 30,
            fontFamily: 'var(--font-inter), Inter, sans-serif',
          }}
        >
          {/* Hidden caption for screen readers — `role="menu"` wants a
              label. The trigger's aria-label covers the popover relationship,
              but supplying an aria-labelledby gives AT users a stable name. */}
          <span id={captionId} style={{ position: 'absolute', width: 1, height: 1, padding: 0, margin: -1, overflow: 'hidden', clip: 'rect(0,0,0,0)', whiteSpace: 'nowrap', border: 0 }}>
            Prose settings
          </span>

          <ToggleRow
            label="Sentence Focus"
            hint="Dim text outside the current sentence"
            checked={settings.sentenceFocus}
            onChange={settings.setSentenceFocus}
            testIdSuffix="sentence-focus"
          />
          <div
            style={{
              height: 1,
              background: 'var(--color-border-subtle)',
              margin: '4px 6px',
            }}
          />
          <ToggleRow
            label="Typewriter"
            hint="Keep the active line near vertical centre"
            checked={settings.typewriter}
            onChange={settings.setTypewriter}
            testIdSuffix="typewriter"
          />
        </div>
      )}
    </div>
  )
}

interface ToggleRowProps {
  label: string
  hint: string
  checked: boolean
  onChange: (value: boolean) => void
  testIdSuffix: string
}

function ToggleRow({ label, hint, checked, onChange, testIdSuffix }: ToggleRowProps) {
  const [hover, setHover] = useState(false)
  return (
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={checked}
      data-testid={`prose-settings-toggle-${testIdSuffix}`}
      onClick={() => onChange(!checked)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setHover(true)}
      onBlur={() => setHover(false)}
      style={{
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '8px 10px',
        borderRadius: 3,
        background: hover ? 'var(--color-bg-hover, var(--color-bg-surface))' : 'transparent',
        border: 'none',
        cursor: 'pointer',
        textAlign: 'left',
        fontFamily: 'inherit',
      }}
    >
      <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontSize: 12.5, color: 'var(--color-text-primary)' }}>{label}</span>
        <span style={{ fontSize: 10.5, color: 'var(--color-text-muted)' }}>{hint}</span>
      </span>
      <Toggle on={checked} />
    </button>
  )
}

/** Visual toggle — NOT verdigris (Inviolable #2 audit clean). On state
 *  uses --color-info; off state is neutral chrome. */
function Toggle({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      style={{
        position: 'relative',
        width: 28,
        height: 16,
        background: on ? 'var(--color-info)' : 'var(--color-bg-surface)',
        border: `1px solid ${on ? 'var(--color-info)' : 'var(--color-border-default)'}`,
        borderRadius: 9,
        flexShrink: 0,
        transition: 'background var(--duration-fast, 120ms), border-color var(--duration-fast, 120ms)',
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: 2,
          left: on ? 14 : 2,
          width: 10,
          height: 10,
          borderRadius: '50%',
          background: on ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
          transition: 'left var(--duration-fast, 120ms), background var(--duration-fast, 120ms)',
        }}
      />
    </span>
  )
}
