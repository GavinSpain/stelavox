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
import { ExportModal } from './ExportModal'

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
    </>
  )
}
