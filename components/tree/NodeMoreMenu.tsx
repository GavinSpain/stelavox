'use client'

// Spec: stelavox_phase2_build_checklist_v1_0.md v1.1 §3.4 T-4.6
//       stelavox_component_specification_v2_0.md §4.2 (More menu)
//
// Phase 2 stub: an anchored inline menu (Rename / Delete / Status)
// opened from a NodeRow's More button. Refined Modal/Dropdown
// primitives in components/overlay/ are a future polish task; this
// component bundles a minimal dropdown shape inline.
//
// Rename and Delete previously used native window.prompt() / window.confirm().
// SU-22 (round-3 follow-up) replaces both with the project's existing
// shadcn Dialog primitive: native dialogs blocked the renderer and were
// undriveable from MCP / Playwright, which made the launch-standard
// test impossible. Status is an inline sub-section with four pills
// (draft, in_review, approved, locked) — clicking one PATCHes status
// and closes the menu.
//
// On any mutation, calls onMutated() so NodeTree re-fetches the tree.

import { useEffect, useRef, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

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
  // SU-22 follow-up: dialog state lives in the menu so the popover stays
  // mounted while the dialog is open. We disable the click-outside /
  // escape-close handlers below when a dialog is showing — the dialog
  // owns dismissal during that window.
  const [renameOpen, setRenameOpen] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const [deleteOpen, setDeleteOpen] = useState(false)

  const dialogOpen = renameOpen || deleteOpen

  // Anchor position: place menu directly below the More button.
  const rect = anchor.getBoundingClientRect()

  // Click-outside dismissal. Suspended while a dialog is open so a
  // click on the dialog backdrop / inputs doesn't unmount the menu
  // (the menu owns the dialog state).
  useEffect(() => {
    if (dialogOpen) return
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
  }, [anchor, onClose, dialogOpen])

  function openRename() {
    setRenameValue('')
    setRenameOpen(true)
  }

  async function submitRename(e: React.FormEvent) {
    e.preventDefault()
    const next = renameValue.trim()
    if (!next) return
    setBusy(true)
    try {
      const r = await fetch(`/api/nodes/${nodeId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: next }),
      })
      if (r.ok) onMutated()
      else console.error('[NodeMoreMenu] rename non-OK', r.status)  // F-247
    } catch (e) {
      // F-247 (round-3 audit B3.6): pre-fix the network error case had
      // no catch — the failure surface was just the missing onMutated().
      console.error('[NodeMoreMenu] rename failed', e)
    } finally {
      setBusy(false)
      setRenameOpen(false)
      onClose()
    }
  }

  function openDelete() {
    setDeleteOpen(true)
  }

  async function confirmDelete() {
    setBusy(true)
    try {
      const r = await fetch(`/api/nodes/${nodeId}`, { method: 'DELETE' })
      if (r.ok) onMutated()
      else console.error('[NodeMoreMenu] delete non-OK', r.status)  // F-247
    } catch (e) {
      // F-247 (round-3 audit B3.6): pre-fix no catch.
      console.error('[NodeMoreMenu] delete failed', e)
    } finally {
      setBusy(false)
      setDeleteOpen(false)
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
    <>
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
        <MenuButton onClick={openRename} disabled={busy}>Rename…</MenuButton>
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
            <MenuButton onClick={openDelete} disabled={busy} danger>
              Delete…
            </MenuButton>
          </>
        )}
      </div>

      <Dialog open={renameOpen} onOpenChange={(o) => { if (!busy) setRenameOpen(o); if (!o) onClose() }}>
        <DialogContent style={dialogContentStyle}>
          <DialogHeader>
            <DialogTitle style={dialogTitleStyle}>Rename node</DialogTitle>
          </DialogHeader>
          <form onSubmit={submitRename} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', marginTop: 'var(--space-2)' }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
              <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>New name</span>
              <input
                type="text"
                value={renameValue}
                onChange={e => setRenameValue(e.target.value)}
                autoFocus
                required
                maxLength={500}
                style={inputStyle}
              />
            </label>
            <div style={{ display: 'flex', gap: 'var(--space-3)', justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => { setRenameOpen(false); onClose() }} style={secondaryButtonStyle} disabled={busy}>Cancel</button>
              <button type="submit" disabled={busy || !renameValue.trim()} style={primaryButtonStyle}>
                {busy ? 'Saving…' : 'Rename'}
              </button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteOpen} onOpenChange={(o) => { if (!busy) setDeleteOpen(o); if (!o) onClose() }}>
        <DialogContent style={dialogContentStyle}>
          <DialogHeader>
            <DialogTitle style={dialogTitleStyle}>Delete node</DialogTitle>
          </DialogHeader>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', marginTop: 'var(--space-2)' }}>
            Delete this node and all its descendants? This cannot be undone.
          </p>
          <div style={{ display: 'flex', gap: 'var(--space-3)', justifyContent: 'flex-end', marginTop: 'var(--space-3)' }}>
            <button type="button" onClick={() => { setDeleteOpen(false); onClose() }} style={secondaryButtonStyle} disabled={busy}>Cancel</button>
            <button type="button" onClick={confirmDelete} disabled={busy} style={dangerButtonStyle}>
              {busy ? 'Deleting…' : 'Delete'}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
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

const dialogContentStyle: React.CSSProperties = {
  background: 'var(--color-bg-elevated)',
  border: '1px solid var(--color-border-default)',
}

const dialogTitleStyle: React.CSSProperties = {
  color: 'var(--color-text-primary)',
  fontSize: 'var(--text-lg)',
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: 'var(--space-2) var(--space-3)',
  background: 'var(--color-bg-base)',
  border: '1px solid var(--color-border-default)',
  borderRadius: '4px',
  color: 'var(--color-text-primary)',
  fontSize: 'var(--text-base)',
  outline: 'none',
  boxSizing: 'border-box',
}

const primaryButtonStyle: React.CSSProperties = {
  padding: 'var(--space-2) var(--space-4)',
  background: 'var(--color-text-primary)',
  color: 'var(--color-bg-base)',
  border: 'none',
  borderRadius: '4px',
  fontSize: 'var(--text-sm)',
  fontWeight: 500,
  cursor: 'pointer',
}

const secondaryButtonStyle: React.CSSProperties = {
  padding: 'var(--space-2) var(--space-4)',
  background: 'none',
  color: 'var(--color-text-secondary)',
  border: '1px solid var(--color-border-default)',
  borderRadius: '4px',
  fontSize: 'var(--text-sm)',
  cursor: 'pointer',
}

const dangerButtonStyle: React.CSSProperties = {
  padding: 'var(--space-2) var(--space-4)',
  background: 'var(--color-error)',
  color: 'var(--color-bg-base)',
  border: 'none',
  borderRadius: '4px',
  fontSize: 'var(--text-sm)',
  fontWeight: 500,
  cursor: 'pointer',
}
