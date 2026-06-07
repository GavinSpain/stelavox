'use client'

// Phase 8.3 — supports controlled mode so callers (Dashboard's empty
// + populated canvases) can drive the dialog without owning the
// DialogTrigger. Backward-compatible: when no props are passed, the
// dialog renders its own "New project" trigger button.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'

const DOCUMENT_TYPES = [
  { value: 'novel',       label: 'Novel' },
  { value: 'short_story', label: 'Short story' },
  { value: 'series',      label: 'Series' },
]

export interface NewProjectDialogProps {
  /** Controlled open state. Omit for uncontrolled (the dialog renders
   *  its own trigger button). When provided, the caller is responsible
   *  for opening + closing the dialog. */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /** Called after a successful POST /api/projects with the new project.
   *  When provided, the dialog skips the default `router.refresh()`
   *  navigation — the caller takes over (typically to navigate the
   *  user into the new project). */
  onCreated?: (result: { projectId: string; projectName: string }) => void
}

export default function NewProjectDialog({
  open: controlledOpen,
  onOpenChange,
  onCreated,
}: NewProjectDialogProps = {}) {
  const router = useRouter()
  const [internalOpen, setInternalOpen] = useState(false)
  const isControlled = controlledOpen !== undefined
  const open = isControlled ? controlledOpen : internalOpen
  const setOpen = isControlled
    ? (o: boolean) => onOpenChange?.(o)
    : setInternalOpen

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [docType, setDocType] = useState('novel')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  function reset() {
    setName('')
    setDescription('')
    setDocType('novel')
    setError(null)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    const res = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim(), description: description.trim() || null, default_document_type: docType }),
    })
    setLoading(false)
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setError(body.message ?? body.error ?? 'Failed to create project.')
      return
    }
    const body = await res.json().catch(() => ({}))
    setOpen(false)
    reset()
    if (onCreated && body?.project?.id) {
      onCreated({ projectId: body.project.id, projectName: body.project.name ?? '' })
    } else {
      router.refresh()
    }
  }

  return (
    <Dialog open={open} onOpenChange={o => { setOpen(o); if (!o) reset() }}>
      {!isControlled && (
        <DialogTrigger style={primaryButtonStyle}>New project</DialogTrigger>
      )}
      <DialogContent style={{ background: 'var(--color-bg-elevated)', border: '1px solid var(--color-border-default)' }}>
        <DialogHeader>
          <DialogTitle style={{ color: 'var(--color-text-primary)', fontSize: 'var(--text-lg)' }}>
            New project
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', marginTop: 'var(--space-3)' }}>
          <Field label="Name">
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              required
              maxLength={200}
              style={inputStyle}
            />
          </Field>
          <Field label="Description (optional)">
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              maxLength={5000}
              rows={3}
              style={{ ...inputStyle, resize: 'vertical' }}
            />
          </Field>
          <Field label="Default document type">
            <select value={docType} onChange={e => setDocType(e.target.value)} style={inputStyle}>
              {DOCUMENT_TYPES.map(t => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </Field>
          {error && <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-error)' }}>{error}</p>}
          <div style={{ display: 'flex', gap: 'var(--space-3)', justifyContent: 'flex-end' }}>
            <button type="button" onClick={() => setOpen(false)} style={secondaryButtonStyle}>Cancel</button>
            <button type="submit" disabled={loading} style={primaryButtonStyle}>
              {loading ? 'Creating…' : 'Create'}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  // Wrapping label associates label text with the wrapped form control,
  // satisfying axe `label` and `select-name` rules without needing matching id/htmlFor.
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
      <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>{label}</span>
      {children}
    </label>
  )
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
