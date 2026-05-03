'use client'

// Spec: stelavox_phase3_build_checklist_v1_0.md §3.4 T-4.6
//       stelavox_phase3_api_contract_v1_0.md §2.4, §2.11
//
// Two states:
//   • 409 — conflictCurrent set: [Use latest] + [Keep mine] buttons
//   • 423 — lockedReason set:    [Use latest] only ("This node is now locked")
// 423 wins (set in the store) when both apply.
//
// role="alert" so the banner is announced by screen readers (TC-AX-04).

import { useEditorStore } from '@/lib/stores/editor-store'

export function ConflictBanner() {
  const conflictCurrent = useEditorStore(s => s.conflictCurrent)
  const lockedReason    = useEditorStore(s => s.lockedReason)
  const acceptCurrent   = useEditorStore(s => s.acceptCurrent)
  const keepMine        = useEditorStore(s => s.keepMine)
  const reload          = useEditorStore(s => s.reloadFromServer)
  const dismissLock     = useEditorStore(s => s.dismissLock)

  if (!conflictCurrent && !lockedReason) return null

  // 423 takes precedence when both are set (defence in depth — the store
  // already enforces this on response).
  const isLock = lockedReason !== null
  const isConflict = !isLock && conflictCurrent !== null

  const message = isLock
    ? lockedReason === 'parent_locked'
      ? 'A parent node is now locked. This node is read-only.'
      : 'This node is now locked. It is read-only.'
    : 'This node was modified by someone else while you were editing.'

  async function onUseLatest() {
    if (isLock) {
      await reload()
      dismissLock()
    } else {
      await acceptCurrent()
    }
  }

  async function onKeepMine() {
    await keepMine()
  }

  return (
    <div
      role="alert"
      aria-live="assertive"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 'var(--space-3)',
        padding: 'var(--space-3) var(--space-4)',
        background: 'var(--color-bg-elevated)',
        borderBottom: '1px solid var(--color-border-default)',
        fontFamily: 'var(--font-inter), Inter, sans-serif',
        fontSize: '12px',
        color: 'var(--color-text-primary)',
      }}
    >
      <span style={{ flex: 1, color: 'var(--color-text-secondary)' }}>{message}</span>
      <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
        <button
          type="button"
          onClick={onUseLatest}
          style={{
            padding: '4px 10px',
            background: 'var(--color-bg-base)',
            border: '1px solid var(--color-border-default)',
            borderRadius: '4px',
            fontSize: '11px',
            fontFamily: 'var(--font-inter), Inter, sans-serif',
            color: 'var(--color-text-primary)',
            cursor: 'pointer',
          }}
        >
          Use latest
        </button>
        {isConflict && (
          <button
            type="button"
            onClick={onKeepMine}
            style={{
              padding: '4px 10px',
              background: 'var(--color-bg-base)',
              border: '1px solid var(--color-border-default)',
              borderRadius: '4px',
              fontSize: '11px',
              fontFamily: 'var(--font-inter), Inter, sans-serif',
              color: 'var(--color-text-primary)',
              cursor: 'pointer',
            }}
          >
            Keep mine
          </button>
        )}
      </div>
    </div>
  )
}
