'use client'

// Spec: stelavox_phase2_build_checklist_v1_0.md v1.1 §3.4 T-4.6
//       stelavox_component_specification_v2_0.md §4.2 (More menu)
//
// Phase 2 stub: an anchored inline menu (Rename / Delete / Status)
// opened from a NodeRow's More button. Refined Modal/Dropdown
// primitives in components/overlay/ are a future polish task; this
// component bundles a minimal dropdown shape inline.
//
// Rename uses window.prompt() — primitive but functional. Delete
// fetches the node's descendant-deleted count from the API response
// and shows a confirm() pre-populated with the count. Status is an
// inline sub-section with four pills (draft, in_review, approved,
// locked) — clicking one PATCHes status and closes the menu.
//
// On any mutation, calls onMutated() so NodeTree re-fetches the tree.

import { useEffect, useRef, useState } from 'react'

export type StatusValue = 'draft' | 'in_review' | 'approved' | 'locked'
const STATUS_VALUES: readonly StatusValue[] = ['draft', 'in_review', 'approved', 'locked']

interface NodeMoreMenuProps {
  nodeId: string
  anchor: HTMLElement
  isRoot: boolean
  onClose: () => void
  onMutated: () => void
}

export function NodeMoreMenu({ nodeId, anchor, isRoot, onClose, onMutated }: NodeMoreMenuProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [busy, setBusy] = useState(false)
  const [showStatus, setShowStatus] = useState(false)

  // Anchor position: place menu directly below the More button.
  const rect = anchor.getBoundingClientRect()

  // Click-outside dismissal.
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!ref.current) return
      if (!ref.current.contains(e.target as Node) && !anchor.contains(e.target as Node)) {
        onClose()
      }
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onEsc)
    }
  }, [anchor, onClose])

  async function rename() {
    const next = window.prompt('Rename to:')
    if (next === null || next.trim() === '') { onClose(); return }
    setBusy(true)
    try {
      const r = await fetch(`/api/nodes/${nodeId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: next.trim() }),
      })
      if (r.ok) onMutated()
      else console.error('[NodeMoreMenu] rename non-OK', r.status)  // F-247
    } catch (e) {
      // F-247 (round-3 audit B3.6): pre-fix the network error case had
      // no catch — the failure surface was just the missing onMutated().
      console.error('[NodeMoreMenu] rename failed', e)
    } finally {
      setBusy(false)
      onClose()
    }
  }

  async function del() {
    setBusy(true)
    try {
      // DELETE returns descendants_deleted; can't show count without
      // first calling. Use a probe call: actually we need to confirm
      // BEFORE deleting. Phase 2 stub: confirm with a generic message,
      // delete, then surface the descendants count via console.
      const ok = window.confirm('Delete this node and all its descendants? This cannot be undone.')
      if (!ok) { onClose(); return }
      const r = await fetch(`/api/nodes/${nodeId}`, { method: 'DELETE' })
      if (r.ok) onMutated()
      else console.error('[NodeMoreMenu] delete non-OK', r.status)  // F-247
    } catch (e) {
      // F-247 (round-3 audit B3.6): pre-fix no catch.
      console.error('[NodeMoreMenu] delete failed', e)
    } finally {
      setBusy(false)
      onClose()
    }
  }

  async function setStatus(status: StatusValue) {
    setBusy(true)
    try {
      const r = await fetch(`/api/nodes/${nodeId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      if (r.ok) onMutated()
      else console.error('[NodeMoreMenu] setStatus non-OK', r.status)  // F-247
    } catch (e) {
      // F-247 (round-3 audit B3.6): pre-fix no catch.
      console.error('[NodeMoreMenu] setStatus failed', e)
    } finally {
      setBusy(false)
      onClose()
    }
  }

  return (
    <div
      ref={ref}
      role="menu"
      style={{
        position: 'fixed',
        top: rect.bottom + 4,
        left: rect.left,
        background: 'var(--color-bg-elevated)',
        border: '1px solid var(--color-border-default)',
        borderRadius: '6px',
        padding: 'var(--space-1)',
        minWidth: '160px',
        zIndex: 50,
        boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
        fontSize: 'var(--text-sm)',
      }}
    >
      <MenuButton onClick={rename} disabled={busy}>Rename…</MenuButton>
      <MenuButton onClick={() => setShowStatus(s => !s)} disabled={busy}>
        Status {showStatus ? '▾' : '▸'}
      </MenuButton>
      {showStatus && (
        <div style={{ paddingLeft: 'var(--space-3)' }}>
          {STATUS_VALUES.map(s => (
            <MenuButton key={s} onClick={() => setStatus(s)} disabled={busy}>
              {s.replace('_', ' ')}
            </MenuButton>
          ))}
        </div>
      )}
      {!isRoot && (
        <>
          <div style={{ height: '1px', background: 'var(--color-border-subtle)', margin: 'var(--space-1) 0' }} />
          <MenuButton onClick={del} disabled={busy} danger>
            Delete…
          </MenuButton>
        </>
      )}
    </div>
  )
}

interface MenuButtonProps {
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
  danger?: boolean
}

function MenuButton({ children, onClick, disabled, danger }: MenuButtonProps) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
      style={{
        display: 'block',
        width: '100%',
        textAlign: 'left',
        background: 'transparent',
        border: 'none',
        color: danger ? 'var(--color-error)' : 'var(--color-text-secondary)',
        padding: '6px 10px',
        borderRadius: '3px',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        fontSize: 'inherit',
      }}
    >
      {children}
    </button>
  )
}
