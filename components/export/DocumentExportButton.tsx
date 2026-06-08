'use client'

/**
 * Phase 7.D — DocumentExportButton
 *
 * Compact Export button that mounts in the document context. Opens the
 * ExportModal; tracks the resulting export_job id only briefly (the
 * actual progress UI is the ExportProgressStack chip mounted globally).
 *
 * Keyboard shortcut: Cmd+Shift+E (Ctrl+Shift+E on Windows).
 */

import { useEffect, useState } from 'react'
import dynamic from 'next/dynamic'

// Phase 8.5b B.7 — ExportModal dynamic-imported. The modal's dialog
// primitives + format tile + profile picker + history shouldn't ship in
// the document-route bundle; they're only needed when the user opens
// the export dialog. The JSX below is gated on `open === true` so the
// chunk is fetched lazily on first open, not on initial render.
const ExportModal = dynamic(
  () => import('./ExportModal').then((m) => m.ExportModal),
  { ssr: false },
)

interface DocumentExportButtonProps {
  projectId: string
  documentId: string
  documentName: string
}

export function DocumentExportButton({ projectId, documentId, documentName }: DocumentExportButtonProps) {
  const [open, setOpen] = useState(false)

  // Cmd+Shift+E (Ctrl+Shift+E) shortcut
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'e') {
        e.preventDefault()
        setOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <>
      <button
        type="button"
        data-testid="document-export-button"
        onClick={() => setOpen(true)}
        title="Export this document (⌘⇧E)"
        style={{
          fontSize: 11,
          padding: '6px 12px',
          borderRadius: 3,
          border: '1px solid var(--color-border-default)',
          background: 'transparent',
          color: 'var(--color-text-secondary)',
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          fontFamily: 'inherit',
        }}
      >
        📄 Export
      </button>

      {open ? (
        <ExportModal
          open={open}
          documentId={documentId}
          projectId={projectId}
          documentName={documentName}
          onClose={() => setOpen(false)}
          onExportStarted={() => {
            // Modal closes; ExportProgressStack at AppShell-level picks up
            // the new export_jobs row via Realtime and renders its chip.
          }}
        />
      ) : null}
    </>
  )
}
