'use client'

// Spec: stelavox_phase4_api_contract_v1_0.md §3.1 (POST)
//       stelavox_phase4_test_plan_v1_0.md TC-U-03..TC-U-05, TC-V-06,
//                                          TC-M-01, TC-M-03, TC-AX-03, TC-AX-05
//       stelavox_phase4_build_checklist_v1_0.md §3.5 T-5.1..T-5.3
//
// Modal for creating a context node. The modal is pre-set to a type
// (the entry path locks the type — Sidebar [+] passes the section's
// type; the Picker's [+ Quick create] passes the filtered type). The
// scope defaults to Project; switching to Document reveals a document
// selector populated from /api/projects/[id]/documents.
//
// On Create: POST to /api/projects/[id]/context-nodes.
// On 201: invokes onCreated(node) and the parent closes the modal.
// On 4xx: surfaces the error message inline.

import { useEffect, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { ContextNodeType } from '@/lib/context/types'
import { getContextLabel } from '@/lib/context/labels'
import { getMetadataSchema, type MetadataField } from '@/lib/context/metadata-schemas'

interface DocumentSummary {
  id:   string
  name: string | null
}

interface CreatedNode {
  id:        string
  name:      string | null
  node_type: string
  scope:     'project' | 'document'
}

interface Props {
  open:         boolean
  defaultType:  ContextNodeType
  projectId:    string
  documentId?:  string | null
  onClose:      () => void
  onCreated:    (node: CreatedNode) => void
}

export function ContextCreateModal({
  open, defaultType, projectId, documentId,
  onClose, onCreated,
}: Props) {
  const [scope, setScope] = useState<'project' | 'document'>('project')
  const [selectedDocId, setSelectedDocId] = useState<string | null>(documentId ?? null)
  const [name, setName] = useState('')
  const [shortDescription, setShortDescription] = useState('')
  const [metadata, setMetadata] = useState<Record<string, string>>({})
  const [documents, setDocuments] = useState<DocumentSummary[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const schema = getMetadataSchema(defaultType)
  const labelSingular = getContextLabel(defaultType, false)

  // Fetch the project's documents for the scope-document path. If the
  // request fails we still render the toggle; submission will surface
  // a server error.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    fetch(`/api/projects/${projectId}/documents`)
      .then(r => r.ok ? r.json() : null)
      .then(body => {
        if (cancelled || !body) return
        const docs = (body.documents ?? []) as DocumentSummary[]
        setDocuments(docs)
        // If a context-document was supplied, auto-select it.
        if (documentId) setSelectedDocId(documentId)
      })
      .catch(() => { /* silent — server errors surface on submit */ })
    return () => { cancelled = true }
  }, [open, projectId, documentId])

  // Reset form when the modal closes. setState-in-effect is intentional
  // here — the side effect synchronises form state with the open prop.
  useEffect(() => {
    if (!open) {
      /* eslint-disable react-hooks/set-state-in-effect */
      setScope('project')
      setSelectedDocId(documentId ?? null)
      setName('')
      setShortDescription('')
      setMetadata({})
      setError(null)
      setSubmitting(false)
      /* eslint-enable react-hooks/set-state-in-effect */
    }
  }, [open, documentId])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!name.trim()) {
      setError('Please enter a name.')
      return
    }
    if (scope === 'document' && !selectedDocId) {
      setError('Please select a document.')
      return
    }
    setSubmitting(true)
    // Strip empty metadata entries — sending '' instead of omitting
    // would persist empty strings rather than letting the field be
    // unset. The form only stores non-empty values anyway.
    const cleanMetadata: Record<string, string | number> = {}
    for (const [k, v] of Object.entries(metadata)) {
      if (v === '') continue
      const field = schema.fields.find(f => f.key === k)
      if (field?.type === 'number') {
        const n = Number(v)
        if (Number.isFinite(n)) cleanMetadata[k] = n
      } else {
        cleanMetadata[k] = v
      }
    }
    const body: Record<string, unknown> = {
      scope,
      node_type: defaultType,
      name:      name.trim(),
    }
    if (shortDescription.trim()) body.short_description = shortDescription.trim()
    if (scope === 'document') body.document_id = selectedDocId
    if (Object.keys(cleanMetadata).length > 0) body.metadata = cleanMetadata

    const res = await fetch(`/api/projects/${projectId}/context-nodes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    setSubmitting(false)
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}))
      setError(errBody.message ?? errBody.error ?? 'Failed to create.')
      return
    }
    const success = await res.json()
    onCreated(success.node)
  }

  return (
    <Dialog open={open} onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent style={{ background: 'var(--color-bg-elevated)', border: '1px solid var(--color-border-default)', maxWidth: 520 }}>
        <DialogHeader>
          <DialogTitle style={{ color: 'var(--color-text-primary)', fontSize: 'var(--text-lg)' }}>
            New {labelSingular}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', marginTop: 'var(--space-3)' }}>
          {/* Scope toggle */}
          <Field label="Scope">
            <ScopeToggle scope={scope} onChange={setScope} />
          </Field>

          {scope === 'document' && (
            <Field label="Document">
              <select
                value={selectedDocId ?? ''}
                onChange={e => setSelectedDocId(e.target.value || null)}
                style={inputStyle}
              >
                <option value="">— Select document —</option>
                {documents.map(d => (
                  <option key={d.id} value={d.id}>{d.name ?? '(unnamed)'}</option>
                ))}
              </select>
            </Field>
          )}

          {/* Name */}
          <Field label="Name">
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              required
              maxLength={200}
              autoFocus
              style={inputStyle}
            />
          </Field>

          {/* Short description */}
          <Field label="Short description (optional)">
            <input
              type="text"
              value={shortDescription}
              onChange={e => setShortDescription(e.target.value)}
              maxLength={1000}
              style={inputStyle}
            />
          </Field>

          {/* Per-type metadata fields */}
          {schema.fields.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', borderTop: '1px solid var(--color-border-subtle)', paddingTop: 'var(--space-3)' }}>
              <div
                style={{
                  fontSize: 'var(--text-xs)',
                  color: 'var(--color-text-muted)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                }}
              >
                {labelSingular} details
              </div>
              {schema.fields.map(field => (
                <MetadataFieldRow
                  key={field.key}
                  field={field}
                  value={metadata[field.key] ?? ''}
                  onChange={v => setMetadata(prev => ({ ...prev, [field.key]: v }))}
                />
              ))}
            </div>
          )}

          {error && <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-error)' }} role="alert">{error}</p>}

          <div style={{ display: 'flex', gap: 'var(--space-3)', justifyContent: 'flex-end' }}>
            <button type="button" onClick={onClose} style={secondaryButtonStyle}>Cancel</button>
            <button type="submit" disabled={submitting} style={primaryButtonStyle}>
              {submitting ? 'Creating…' : 'Create'}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
      <label style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>{label}</label>
      {children}
    </div>
  )
}

function ScopeToggle({ scope, onChange }: {
  scope: 'project' | 'document'
  onChange: (s: 'project' | 'document') => void
}) {
  return (
    <div role="radiogroup" aria-label="Scope" style={{ display: 'inline-flex', gap: 0, border: '1px solid var(--color-border-default)', borderRadius: '4px', overflow: 'hidden', alignSelf: 'flex-start' }}>
      {(['project', 'document'] as const).map(s => {
        const selected = scope === s
        return (
          <button
            key={s}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(s)}
            style={{
              padding: 'var(--space-1) var(--space-3)',
              background: selected ? 'var(--color-bg-elevated)' : 'transparent',
              color: selected ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
              border: 'none',
              borderRight: s === 'project' ? '1px solid var(--color-border-default)' : 'none',
              cursor: 'pointer',
              fontSize: 'var(--text-sm)',
              fontWeight: selected ? 500 : 400,
              fontFamily: 'var(--font-sans)',
              minWidth: 80,
              textTransform: 'capitalize',
            }}
          >
            {s}
          </button>
        )
      })}
    </div>
  )
}

function MetadataFieldRow({ field, value, onChange }: {
  field: MetadataField
  value: string
  onChange: (v: string) => void
}) {
  const sharedInputStyle = {
    ...inputStyle,
    fontSize: 'var(--text-sm)',
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label
        htmlFor={`metadata-${field.key}`}
        style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}
      >
        {field.label}
      </label>
      {field.type === 'select' ? (
        <select
          id={`metadata-${field.key}`}
          value={value}
          onChange={e => onChange(e.target.value)}
          style={sharedInputStyle}
        >
          <option value="">—</option>
          {(field.options ?? []).map(opt => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      ) : field.type === 'textarea' ? (
        <textarea
          id={`metadata-${field.key}`}
          value={value}
          onChange={e => onChange(e.target.value)}
          rows={3}
          style={{ ...sharedInputStyle, resize: 'vertical', fontFamily: 'var(--font-sans)' }}
        />
      ) : (
        <input
          id={`metadata-${field.key}`}
          type={field.type}
          value={value}
          onChange={e => onChange(e.target.value)}
          style={sharedInputStyle}
        />
      )}
      {field.description && (
        <span
          style={{
            fontSize: 'var(--text-xs)',
            color: 'var(--color-text-disabled)',
          }}
        >
          {field.description}
        </span>
      )}
    </div>
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
