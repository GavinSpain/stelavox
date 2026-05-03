'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

interface Props {
  projectId: string
  projectName: string
}

export default function ProjectMenu({ projectId, projectName }: Props) {
  const router = useRouter()
  const [renameOpen, setRenameOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [name, setName] = useState(projectName)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleRename(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    const res = await fetch(`/api/projects/${projectId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim() }),
    })
    setLoading(false)
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setError(body.message ?? body.error ?? 'Failed to rename project.')
      return
    }
    setRenameOpen(false)
    router.refresh()
  }

  async function handleDelete() {
    setLoading(true)
    const res = await fetch(`/api/projects/${projectId}`, { method: 'DELETE' })
    setLoading(false)
    if (!res.ok) return
    setDeleteOpen(false)
    router.refresh()
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger data-testid="project-menu" style={menuTriggerStyle} aria-label="Project options">···</DropdownMenuTrigger>
        <DropdownMenuContent align="end" style={{ background: 'var(--color-bg-elevated)', border: '1px solid var(--color-border-default)' }}>
          <DropdownMenuItem onClick={() => { setName(projectName); setRenameOpen(true) }} style={menuItemStyle}>
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setDeleteOpen(true)} style={{ ...menuItemStyle, color: 'var(--color-error)' }}>
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent style={{ background: 'var(--color-bg-elevated)', border: '1px solid var(--color-border-default)' }}>
          <DialogHeader>
            <DialogTitle style={{ color: 'var(--color-text-primary)', fontSize: 'var(--text-lg)' }}>Rename project</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleRename} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', marginTop: 'var(--space-3)' }}>
            <input value={name} onChange={e => setName(e.target.value)} required maxLength={200} style={inputStyle} />
            {error && <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-error)' }}>{error}</p>}
            <div style={{ display: 'flex', gap: 'var(--space-3)', justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => setRenameOpen(false)} style={secondaryButtonStyle}>Cancel</button>
              <button type="submit" disabled={loading} style={primaryButtonStyle}>{loading ? 'Saving…' : 'Save'}</button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent style={{ background: 'var(--color-bg-elevated)', border: '1px solid var(--color-border-default)' }}>
          <DialogHeader>
            <DialogTitle style={{ color: 'var(--color-text-primary)', fontSize: 'var(--text-lg)' }}>Delete project?</DialogTitle>
          </DialogHeader>
          <p style={{ fontSize: 'var(--text-base)', color: 'var(--color-text-secondary)', margin: 'var(--space-3) 0' }}>
            This will permanently delete <strong style={{ color: 'var(--color-text-primary)' }}>{projectName}</strong> and all its documents. This cannot be undone.
          </p>
          <div style={{ display: 'flex', gap: 'var(--space-3)', justifyContent: 'flex-end' }}>
            <button type="button" onClick={() => setDeleteOpen(false)} style={secondaryButtonStyle}>Cancel</button>
            <button type="button" onClick={handleDelete} disabled={loading} style={{ ...primaryButtonStyle, background: 'var(--color-error)' }}>
              {loading ? 'Deleting…' : 'Delete'}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

const menuTriggerStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  color: 'var(--color-text-muted)',
  fontSize: 'var(--text-base)',
  padding: 'var(--space-1) var(--space-2)',
  borderRadius: '4px',
  letterSpacing: '0.05em',
}

const menuItemStyle: React.CSSProperties = {
  fontSize: 'var(--text-sm)',
  color: 'var(--color-text-primary)',
  cursor: 'pointer',
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
