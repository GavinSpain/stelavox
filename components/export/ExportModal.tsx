'use client'

/**
 * Phase 7.D — ExportModal
 *
 * Primary export trigger per wireframe §01. Format selector + profile
 * selector + Export button. Quick-save flow per §09. EPUB-as-fallback
 * suggestion per §06 when document is over DOCX limit but within EPUB.
 *
 * NOT verdigris — Export action uses neutral primary token.
 */

import { useEffect, useState } from 'react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { EXPORT_STARTED_EVENT } from '@/lib/hooks/useExportJobs'

type ExportFormat = 'docx' | 'epub' | 'json' | 'outline'

interface ExportProfile {
  id: string
  name: string
  format: ExportFormat
  is_builtin: boolean
  config: Record<string, unknown>
}

interface ExportModalProps {
  open: boolean
  documentId: string
  projectId: string
  documentName: string
  onClose: () => void
  onExportStarted: (exportJobId: string) => void
}

export function ExportModal({
  open, documentId, projectId, documentName, onClose, onExportStarted,
}: ExportModalProps) {
  if (!open) {
    return (
      <Dialog open={false} onOpenChange={() => {}}>
        <DialogContent />
      </Dialog>
    )
  }
  return (
    <ExportModalBody
      documentId={documentId}
      projectId={projectId}
      documentName={documentName}
      onClose={onClose}
      onExportStarted={onExportStarted}
    />
  )
}

function ExportModalBody({
  documentId, projectId, documentName, onClose, onExportStarted,
}: Omit<ExportModalProps, 'open'>) {
  const [format, setFormat] = useState<ExportFormat>('docx')
  const [profiles, setProfiles] = useState<ExportProfile[]>([])
  const [profileId, setProfileId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(`/api/projects/${projectId}/export-profiles`)
        if (!res.ok) return
        const body = await res.json() as { profiles: ExportProfile[] }
        if (cancelled) return
        setProfiles(body.profiles)
        // Auto-select the first profile matching current format
        const match = body.profiles.find(p => p.format === format)
        if (match) setProfileId(match.id)
      } catch {
        // ignore
      }
    })()
    return () => { cancelled = true }
  }, [projectId, format])

  const filteredProfiles = profiles.filter(p => p.format === format)

  // Derive effective profileId: if stored selection no longer matches the
  // current format (e.g. user switched format tile), fall back to the first
  // matching profile. Avoids setState-in-effect cascade.
  const storedProfile = profileId ? profiles.find(p => p.id === profileId) : null
  const effectiveProfileId =
    storedProfile && storedProfile.format === format
      ? storedProfile.id
      : (filteredProfiles[0]?.id ?? null)

  async function handleExport() {
    setBusy(true)
    setErrorMsg(null)
    try {
      const res = await fetch('/api/exports', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          document_id: documentId,
          format,
          profile_id: effectiveProfileId,
        }),
      })
      if (res.ok) {
        const body = await res.json() as { export_job_id: string }
        // 2026-06-07 — broadcast to mounted ExportHistoryPanel(s) so the
        // new row appears immediately without waiting for Realtime.
        window.dispatchEvent(new CustomEvent(EXPORT_STARTED_EVENT, {
          detail: { documentId, exportJobId: body.export_job_id },
        }))
        onExportStarted(body.export_job_id)
        onClose()
      } else {
        const body = await res.json().catch(() => ({})) as { message?: string }
        setErrorMsg(body.message ?? `Export failed (status ${res.status}).`)
      }
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Network error.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!busy && !o) onClose() }}>
      <DialogContent style={{
        background: 'var(--color-bg-elevated)',
        border: '1px solid var(--color-border-default)',
        maxWidth: 560,
      }}>
        <DialogHeader>
          <DialogTitle style={{ color: 'var(--color-text-primary)', fontSize: 'var(--text-lg)' }}>
            Export &quot;{documentName}&quot;
          </DialogTitle>
        </DialogHeader>

        <div style={{ marginTop: 'var(--space-2)' }}>
          <label style={fieldLabelStyle}>Format</label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
            {([
              ['docx', '📄 DOCX', 'Word document for editors, contests, submissions'],
              ['epub', '📚 EPUB', 'E-book for Kindle / Kobo / Apple Books'],
              ['json', '{ } JSON', 'Full backup of all content + versions'],
              ['outline', '📋 Outline', 'Printable structural summary (Markdown)'],
            ] as [ExportFormat, string, string][]).map(([f, label, desc]) => (
              <button
                key={f}
                type="button"
                data-testid={`format-tile-${f}`}
                onClick={() => setFormat(f)}
                style={{
                  padding: 12,
                  border: format === f
                    ? '1px solid var(--color-text-muted)'
                    : '1px solid var(--color-border-default)',
                  background: format === f ? 'var(--color-bg-base)' : 'var(--color-bg-surface)',
                  borderRadius: 4,
                  cursor: 'pointer',
                  textAlign: 'left',
                  fontFamily: 'inherit',
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text-primary)' }}>
                  {label}
                </div>
                <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 4 }}>
                  {desc}
                </div>
              </button>
            ))}
          </div>

          <label style={fieldLabelStyle}>Profile</label>
          <select
            data-testid="profile-select"
            value={effectiveProfileId ?? ''}
            onChange={(e) => setProfileId(e.target.value || null)}
            style={selectStyle}
          >
            {filteredProfiles.map(p => (
              <option key={p.id} value={p.id}>
                {p.is_builtin ? '📐 ' : ''}{p.name}{p.is_builtin ? ' — built-in' : ''}
              </option>
            ))}
            {filteredProfiles.length === 0 && (
              <option value="">(no profiles for this format)</option>
            )}
          </select>
          <div style={{
            fontSize: 11, color: 'var(--color-text-muted)', marginTop: 4, fontStyle: 'italic',
          }}>
            Choose a saved configuration. Author-saved profiles attach to this project.
          </div>

          {errorMsg && (
            <div style={{
              marginTop: 12,
              padding: '8px 12px',
              background: 'var(--color-bg-surface)',
              borderLeft: '2px solid var(--color-error)',
              borderRadius: 3,
              fontSize: 12,
              color: 'var(--color-text-secondary)',
            }}>
              {errorMsg}
            </div>
          )}

          <div style={{
            display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end',
            marginTop: 'var(--space-4)',
          }}>
            <button type="button" onClick={onClose} disabled={busy} style={ghostBtnStyle}>
              Cancel
            </button>
            <button
              type="button"
              onClick={handleExport}
              disabled={busy || !effectiveProfileId}
              data-testid="export-modal-export"
              style={primaryBtnStyle}
            >
              {busy ? 'Starting…' : 'Export'}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

const fieldLabelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 10, fontWeight: 500, letterSpacing: '.14em',
  textTransform: 'uppercase', color: 'var(--color-text-muted)',
  marginBottom: 6,
}

const selectStyle: React.CSSProperties = {
  width: '100%', padding: '8px 10px',
  background: 'var(--color-bg-base)',
  border: '1px solid var(--color-border-default)',
  borderRadius: 3,
  color: 'var(--color-text-primary)',
  fontFamily: 'inherit',
  fontSize: 12,
}

const ghostBtnStyle: React.CSSProperties = {
  padding: 'var(--space-2) var(--space-4)',
  background: 'transparent',
  color: 'var(--color-text-secondary)',
  border: '1px solid var(--color-border-default)',
  borderRadius: 3,
  fontSize: 12,
  cursor: 'pointer',
}

// D3 wireframe callout 3: NOT verdigris.
const primaryBtnStyle: React.CSSProperties = {
  padding: 'var(--space-2) var(--space-4)',
  background: 'var(--color-text-primary)',
  color: 'var(--color-bg-base)',
  border: 'none',
  borderRadius: 3,
  fontSize: 12,
  fontWeight: 500,
  cursor: 'pointer',
}
