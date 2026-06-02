'use client'

// Phase 8.01.F T-2 — generic slide-over panel.
//
// Per OQ-1 lock: Portal-mounted under document.body to escape any
// parent transforms (same lesson as FocusMode 8.01.B / Component Spec
// v2.4 §6.1). Edge-anchored (left or right), backdrop dismisses, ESC
// dismisses, body scroll locked while open.
//
// SSR-safe: portalTarget resolves in useEffect; returns null on the
// server.

import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

interface SlideOverProps {
  open: boolean
  onClose: () => void
  edge: 'left' | 'right'
  width: number
  ariaLabel: string
  /** Optional test id for the outer slide-over container. */
  testId?: string
  children: ReactNode
}

const SLIDE_DURATION_MS = 280
const BODY_LOCK_CLASS = 'slide-over-active'

export function SlideOver({
  open,
  onClose,
  edge,
  width,
  ariaLabel,
  testId = 'slide-over',
  children,
}: SlideOverProps) {
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null)

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPortalTarget(document.body)
  }, [])

  // Body scroll lock + Escape-to-close.
  useEffect(() => {
    if (!open) return
    document.body.classList.add(BODY_LOCK_CLASS)
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.classList.remove(BODY_LOCK_CLASS)
    }
  }, [open, onClose])

  if (!portalTarget) return null
  if (!open) return null

  const panelTransform = edge === 'left' ? 'translateX(0)' : 'translateX(0)'
  return createPortal(
    <div
      data-testid={testId}
      data-edge={edge}
      data-state="open"
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 200,
      }}
    >
      {/* Backdrop — tap dismisses. */}
      <button
        type="button"
        data-testid={`${testId}-backdrop`}
        aria-label="Close"
        onClick={onClose}
        style={{
          position: 'absolute',
          inset: 0,
          background: 'rgba(0,0,0,0.4)',
          border: 0,
          padding: 0,
          cursor: 'pointer',
          // Backdrop is part of the dialog focus surface but visually transparent
          // for hover states.
        }}
      />
      {/* Panel — edge-anchored, fixed width. */}
      <div
        data-testid={`${testId}-panel`}
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          [edge]: 0,
          width: `${width}px`,
          background: 'var(--color-bg-surface)',
          borderRight: edge === 'left' ? '1px solid var(--color-border-strong)' : 'none',
          borderLeft: edge === 'right' ? '1px solid var(--color-border-strong)' : 'none',
          boxShadow: edge === 'left' ? '8px 0 24px rgba(0,0,0,0.4)' : '-8px 0 24px rgba(0,0,0,0.4)',
          transform: panelTransform,
          transition: `transform ${SLIDE_DURATION_MS}ms cubic-bezier(0.16,1,0.3,1)`,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {children}
      </div>
    </div>,
    portalTarget,
  )
}
