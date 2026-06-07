'use client'

/**
 * Phase 8.3 follow-up — Project settings tab.
 *
 * Mounted at /projects/[id]?tab=settings. Houses project metadata
 * (rename, description, default document type) plus a Danger Zone
 * with the type-to-confirm delete affordance.
 *
 * Why a separate Settings tab (not a `···` on every ProjectCard):
 *   - Deleting a project is destructive and irreversible. Putting the
 *     control on a low-friction surface like the dashboard grid
 *     invites accidental clicks.
 *   - Industry pattern (GitHub, Vercel, Notion, Stripe) — destructive
 *     actions live inside Settings → Danger Zone, require typed
 *     confirmation. The user has to *go looking* for it.
 *
 * Type-to-confirm friction:
 *   - The destructive button is disabled until the user types the
 *     exact project name into the confirmation input
 *   - Accidental click + accidental "yes" is effectively impossible
 *
 * Inviolable audit:
 *   #1 prose surface — N/A (this is settings chrome, no prose)
 *   #2 verdigris — Save button uses neutral primary token; the
 *      destructive button uses --color-error. No verdigris.
 *   #3 / #6 — brand-only typefaces not referenced (Inter only)
 *   #4 — chrome surface, Inter
 *   #5 — N/A
 */

import { useRouter } from 'next/navigation'
import { useState } from 'react'

interface ProjectSettingsTabProps {
  projectId: string
  projectName: string
  projectDescription: string | null
  /** Spec calls this `default_document_type`. The project page passes
   *  whatever it computed; null is allowed for legacy projects. */
  projectDocumentType: string | null
}

const DOCUMENT_TYPES = [
  { value: 'novel',       label: 'Novel' },
  { value: 'short_story', label: 'Short story' },
  { value: 'series',      label: 'Series' },
] as const

export function ProjectSettingsTab({
  projectId,
  projectName: initialName,
  projectDescription: initialDescription,
  projectDocumentType: initialDocType,
}: ProjectSettingsTabProps) {
  const router = useRouter()
  const [name, setName] = useState(initialName)
  const [description, setDescription] = useState(initialDescription ?? '')
  const [docType, setDocType] = useState<string>(initialDocType ?? 'novel')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)

  const hasUnsavedChanges =
    name.trim() !== initialName ||
    (description.trim() || null) !== (initialDescription ?? null) ||
    docType !== (initialDocType ?? 'novel')

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaveError(null)
    setSaving(true)
    const res = await fetch(`/api/projects/${projectId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: name.trim(),
        description: description.trim() || null,
        default_document_type: docType,
      }),
    })
    setSaving(false)
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setSaveError(body.message ?? body.error ?? 'Failed to save changes.')
      return
    }
    setSavedAt(new Date().toLocaleTimeString())
    router.refresh()
  }

  return (
    <div data-testid="project-settings-tab" style={{ maxWidth: 640 }}>
      <form onSubmit={handleSave}>
        <SectionHeading>Project</SectionHeading>

        <Field label="Name">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={200}
            data-testid="project-settings-name"
            style={inputStyle}
          />
        </Field>

        <Field label="Description (optional)">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={5000}
            rows={3}
            data-testid="project-settings-description"
            style={{ ...inputStyle, resize: 'vertical' }}
          />
        </Field>

        <Field label="Default document type">
          <select
            value={docType}
            onChange={(e) => setDocType(e.target.value)}
            data-testid="project-settings-doc-type"
            style={inputStyle}
          >
            {DOCUMENT_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </Field>

        {saveError && (
          <p style={{ fontSize: 12, color: 'var(--color-error)', margin: '4px 0 12px' }}>
            {saveError}
          </p>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8 }}>
          <button
            type="submit"
            disabled={!hasUnsavedChanges || saving}
            data-testid="project-settings-save"
            style={{
              ...primaryButtonStyle,
              opacity: !hasUnsavedChanges || saving ? 0.5 : 1,
              cursor: !hasUnsavedChanges || saving ? 'not-allowed' : 'pointer',
            }}
          >
            {saving ? 'Saving…' : 'Save changes'}
          </button>
          {savedAt && !hasUnsavedChanges && (
            <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
              Saved at {savedAt}
            </span>
          )}
        </div>
      </form>

      {/* Danger Zone — visually demoted so it doesn't compete with
          the rename form above. Border tint hints at destructiveness
          without screaming. */}
      <div
        data-testid="project-settings-danger-zone"
        style={{
          marginTop: 48,
          border: '1px solid color-mix(in srgb, var(--color-error) 35%, transparent)',
          borderRadius: 6,
          padding: '16px 18px',
          background: 'color-mix(in srgb, var(--color-error) 4%, transparent)',
        }}
      >
        <h3
          style={{
            margin: '0 0 12px',
            fontSize: 12,
            fontWeight: 500,
            letterSpacing: '0.16em',
            textTransform: 'uppercase',
            color: 'var(--color-error)',
          }}
        >
          Danger Zone
        </h3>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 16,
          }}
        >
          <div style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
            <div style={{ color: 'var(--color-text-primary)', marginBottom: 2 }}>
              Delete this project
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--color-text-muted)' }}>
              Permanently removes the project, all documents, all nodes. Cannot be undone.
            </div>
          </div>
          <button
            type="button"
            data-testid="project-settings-open-delete"
            onClick={() => setDeleteOpen(true)}
            style={{
              ...secondaryButtonStyle,
              borderColor: 'color-mix(in srgb, var(--color-error) 60%, transparent)',
              color: 'var(--color-error)',
            }}
          >
            Delete project…
          </button>
        </div>
      </div>

      {deleteOpen && (
        <DeleteProjectModal
          projectId={projectId}
          projectName={initialName}
          onClose={() => setDeleteOpen(false)}
        />
      )}
    </div>
  )
}

interface DeleteProjectModalProps {
  projectId: string
  projectName: string
  onClose: () => void
}

function DeleteProjectModal({ projectId, projectName, onClose }: DeleteProjectModalProps) {
  const router = useRouter()
  const [confirmText, setConfirmText] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Friction layer: button stays disabled until the user types the
  // exact project name. Trimmed comparison so trailing whitespace
  // doesn't trip up someone who pasted from elsewhere.
  const canDelete = confirmText.trim() === projectName.trim() && !deleting

  async function handleDelete() {
    if (!canDelete) return
    setError(null)
    setDeleting(true)
    const res = await fetch(`/api/projects/${projectId}`, { method: 'DELETE' })
    setDeleting(false)
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setError(body.message ?? body.error ?? 'Failed to delete project.')
      return
    }
    // Land on the dashboard. The deleted project no longer appears in
    // the project grid; if it was the only project the EmptyCanvas
    // returns.
    router.push('/dashboard')
  }

  return (
    <div
      data-testid="delete-project-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-project-title"
      onClick={(e) => { if (e.target === e.currentTarget && !deleting) onClose() }}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 240,
      }}
    >
      <div
        style={{
          width: 'min(520px, 92vw)',
          background: 'var(--color-bg-elevated)',
          border: '1px solid var(--color-border-default)',
          borderRadius: 6,
          padding: '22px 24px 20px',
          fontFamily: 'var(--font-inter), Inter, sans-serif',
        }}
      >
        <h2
          id="delete-project-title"
          style={{
            margin: '0 0 10px',
            fontSize: 16,
            fontWeight: 500,
            color: 'var(--color-text-primary)',
          }}
        >
          Delete <strong>{projectName}</strong>?
        </h2>
        <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--color-text-secondary)', lineHeight: 1.55 }}>
          Deleting <strong style={{ color: 'var(--color-text-primary)' }}>{projectName}</strong> will permanently remove the project, all its documents, all its nodes, every comment, and every version. This cannot be undone.
        </p>
        <label style={{ display: 'block', fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 6 }}>
          Type <strong style={{ color: 'var(--color-text-primary)' }}>{projectName}</strong> below to confirm.
        </label>
        <input
          type="text"
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          data-testid="delete-project-confirm-input"
          autoFocus
          style={inputStyle}
        />
        {error && (
          <p style={{ fontSize: 12, color: 'var(--color-error)', margin: '8px 0 0' }}>
            {error}
          </p>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18 }}>
          <button
            type="button"
            onClick={onClose}
            disabled={deleting}
            data-testid="delete-project-cancel"
            style={secondaryButtonStyle}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={!canDelete}
            data-testid="delete-project-confirm"
            style={{
              ...primaryButtonStyle,
              background: canDelete ? 'var(--color-error)' : 'color-mix(in srgb, var(--color-error) 50%, transparent)',
              cursor: canDelete ? 'pointer' : 'not-allowed',
            }}
          >
            {deleting ? 'Deleting…' : 'Delete project'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Layout helpers ─────────────────────────────────────────────────

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3
      style={{
        margin: '0 0 14px',
        fontSize: 12,
        fontWeight: 500,
        letterSpacing: '0.16em',
        textTransform: 'uppercase',
        color: 'var(--color-text-muted)',
      }}
    >
      {children}
    </h3>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 16 }}>
      <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>{label}</span>
      {children}
    </label>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  background: 'var(--color-bg-base)',
  border: '1px solid var(--color-border-default)',
  borderRadius: 4,
  color: 'var(--color-text-primary)',
  fontSize: 13,
  fontFamily: 'inherit',
  outline: 'none',
  boxSizing: 'border-box',
}

const primaryButtonStyle: React.CSSProperties = {
  padding: '8px 16px',
  background: 'var(--color-text-primary)',
  color: 'var(--color-bg-base)',
  border: 'none',
  borderRadius: 4,
  fontSize: 13,
  fontWeight: 500,
}

const secondaryButtonStyle: React.CSSProperties = {
  padding: '8px 16px',
  background: 'transparent',
  color: 'var(--color-text-secondary)',
  border: '1px solid var(--color-border-default)',
  borderRadius: 4,
  fontSize: 13,
  cursor: 'pointer',
}
