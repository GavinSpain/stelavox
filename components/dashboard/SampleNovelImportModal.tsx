'use client'

// Phase 8.01.D T-9 — Sample novel import modal.
//
// Spec: Component Spec v2.21 §18.6 SampleNovelImportModal.
// Per OQ-3 lock: every Import click creates a new copy with the lowest-
// available `(N)` suffix. No "open existing" branch — that decision was
// made at the wireframe lock stage in favour of letting authors freely
// experiment with multiple copies.
//
// Inviolable #2: verdigris Import button = use #7 (affirmative-action
// triggers family — no broadening, same family as PlanCard Approve etc.).

import { useState } from 'react'
import { SAMPLE_PREVIEW } from '@/lib/samples/sampleNovel'

interface SampleNovelImportModalProps {
  open: boolean
  onClose: () => void
  /**
   * Called on successful import. Caller is responsible for navigating
   * the user to the new document. Keeps this component navigation-
   * agnostic so it's renderable in unit tests + Storybook-style mounts.
   */
  onImported?: (result: { projectId: string; documentId: string; projectName: string }) => void
}

export function SampleNovelImportModal({ open, onClose, onImported }: SampleNovelImportModalProps) {
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!open) return null

  async function handleImport() {
    setError(null)
    setSubmitting(true)
    try {
      const res = await fetch('/api/samples/import', { method: 'POST' })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.message ?? `import failed (${res.status})`)
      }
      const body = (await res.json()) as { projectId: string; documentId: string; projectName: string }
      onImported?.(body)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unexpected error')
      setSubmitting(false)
    }
  }

  return (
    <div
      data-testid="sample-import-modal"
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose()
      }}
    >
      <div
        style={{
          background: 'var(--color-bg-base)',
          border: '1px solid var(--color-border-subtle)',
          borderRadius: 8,
          padding: 32,
          maxWidth: 560,
          width: '100%',
        }}
      >
        <h2
          style={{
            fontFamily: 'var(--font-inter), Inter, sans-serif',
            fontWeight: 500,
            fontSize: 19,
            color: 'var(--color-text-primary)',
            margin: '0 0 6px',
          }}
        >
          Load the sample novel
        </h2>
        <p
          style={{
            fontFamily: 'var(--font-inter), Inter, sans-serif',
            fontSize: 13,
            color: 'var(--color-text-secondary)',
            marginBottom: 20,
            marginTop: 0,
          }}
        >
          A pre-built example you can open, read, edit, or delete. Useful for seeing how
          Stelavox handles structure, prose, and the Director.
        </p>
        <div
          data-testid="sample-import-preview"
          style={{
            background: 'var(--color-bg-elevated)',
            border: '1px solid var(--color-border-subtle)',
            borderRadius: 6,
            padding: '16px 18px',
            marginBottom: 18,
          }}
        >
          <div
            style={{
              fontFamily: 'ui-monospace, "JetBrains Mono", SFMono-Regular, Menlo, monospace',
              fontSize: 10.5,
              color: 'var(--color-text-muted)',
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
              marginBottom: 8,
            }}
          >
            Sample Project
          </div>
          <div
            style={{
              fontFamily: 'var(--font-inter), Inter, sans-serif',
              fontWeight: 500,
              fontSize: 15,
              color: 'var(--color-text-primary)',
              marginBottom: 4,
            }}
          >
            {SAMPLE_PREVIEW.title}
          </div>
          <div
            style={{
              fontFamily: 'ui-monospace, "JetBrains Mono", SFMono-Regular, Menlo, monospace',
              fontSize: 10.5,
              color: 'var(--color-text-muted)',
            }}
          >
            {SAMPLE_PREVIEW.metaLine}
          </div>
        </div>
        {error && (
          <div
            data-testid="sample-import-error"
            style={{
              marginBottom: 12,
              padding: '8px 12px',
              border: '1px solid var(--color-error)',
              borderRadius: 4,
              color: 'var(--color-error)',
              fontFamily: 'var(--font-inter), Inter, sans-serif',
              fontSize: 12,
            }}
          >
            {error}
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            data-testid="sample-import-cancel"
            style={{
              background: 'transparent',
              border: '1px solid var(--color-border-strong)',
              borderRadius: 6,
              padding: '10px 18px',
              color: 'var(--color-text-primary)',
              fontFamily: 'var(--font-inter), Inter, sans-serif',
              fontSize: 12.5,
              cursor: submitting ? 'not-allowed' : 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleImport}
            disabled={submitting}
            data-testid="sample-import-confirm"
            style={{
              background: 'var(--color-accent)',
              border: 0,
              borderRadius: 6,
              padding: '10px 18px',
              color: 'var(--color-bg-base)',
              fontFamily: 'var(--font-inter), Inter, sans-serif',
              fontWeight: 500,
              fontSize: 12.5,
              cursor: submitting ? 'not-allowed' : 'pointer',
              opacity: submitting ? 0.6 : 1,
            }}
          >
            {submitting ? 'Importing…' : 'Import to my workspace'}
          </button>
        </div>
      </div>
    </div>
  )
}
