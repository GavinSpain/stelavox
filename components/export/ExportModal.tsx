'use client'

/**
 * Phase 7.D — ExportModal  (DR-042: per-book + Markdown backstop)
 *
 * Format selector + profile selector + Export. For a Series document
 * (more than one Book-layer node) the publishing formats (DOCX/EPUB)
 * show a book picker — a deliberate pick (nothing checked by default),
 * one file per selected book. Markdown/Outline are whole-document. JSON
 * is removed (DR-042). Markdown manuscript is the always-available
 * own-your-data backstop.
 *
 * NOT verdigris — Export action uses neutral primary token.
 */

import { useEffect, useMemo, useState } from 'react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { EXPORT_STARTED_EVENT } from '@/lib/hooks/useExportJobs'
import { createClient } from '@/lib/supabase/client'

type ExportFormat = 'docx' | 'epub' | 'markdown' | 'outline'

const EXT: Record<ExportFormat, string> = { docx: 'docx', epub: 'epub', markdown: 'md', outline: 'md' }
const PER_BOOK_FORMATS = new Set<ExportFormat>(['docx', 'epub'])

interface ExportProfile {
  id: string
  name: string
  format: ExportFormat
  is_builtin: boolean
  config: Record<string, unknown>
}

interface BookNode { id: string; name: string | null; order: number }

interface ExportModalProps {
  open: boolean
  documentId: string
  projectId: string
  documentName: string
  onClose: () => void
  onExportStarted: (exportJobId: string) => void
}

export function ExportModal(props: ExportModalProps) {
  if (!props.open) {
    return (
      <Dialog open={false} onOpenChange={() => {}}>
        <DialogContent />
      </Dialog>
    )
  }
  return <ExportModalBody {...props} />
}

function sanitise(s: string): string {
  return s.replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim() || 'Untitled'
}

function ExportModalBody({
  documentId, projectId, documentName, onClose, onExportStarted,
}: Omit<ExportModalProps, 'open'>) {
  const [format, setFormat] = useState<ExportFormat>('docx')
  const [profiles, setProfiles] = useState<ExportProfile[]>([])
  const [profileId, setProfileId] = useState<string | null>(null)
  const [bookNodes, setBookNodes] = useState<BookNode[]>([])
  const [selectedBookIds, setSelectedBookIds] = useState<Set<string>>(new Set())
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
        const match = body.profiles.find(p => p.format === format)
        if (match) setProfileId(match.id)
      } catch { /* ignore */ }
    })()
    return () => { cancelled = true }
  }, [projectId, format])

  // DR-042 — fetch the document's Book-layer nodes. >1 ⇒ Series document
  // (picker trigger D1: node-count, not document_type).
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const supabase = createClient()
        const { data } = await supabase
          .from('nodes')
          .select('id, name, "order"')
          .eq('document_id', documentId)
          .eq('node_category', 'structural')
          .eq('node_type', 'book')
          .order('order')
        if (cancelled || !data) return
        setBookNodes(data.map(d => ({ id: d.id as string, name: d.name as string | null, order: (d.order as number) ?? 0 })))
      } catch { /* ignore */ }
    })()
    return () => { cancelled = true }
  }, [documentId])

  const filteredProfiles = profiles.filter(p => p.format === format)
  const storedProfile = profileId ? profiles.find(p => p.id === profileId) : null
  const effectiveProfileId =
    storedProfile && storedProfile.format === format
      ? storedProfile.id
      : (filteredProfiles[0]?.id ?? null)

  const isSeries = bookNodes.length > 1
  const showPicker = isSeries && PER_BOOK_FORMATS.has(format)

  const filenamePreview = useMemo(() => {
    const ext = EXT[format]
    const series = sanitise(documentName)
    if (!showPicker) return `${series}.${ext}`
    const picked = bookNodes.filter(b => selectedBookIds.has(b.id))
    if (picked.length === 0) return `${series} — NN {Book}.${ext}`
    const first = picked[0]
    const nn = String(first.order).padStart(2, '0')
    const name = sanitise(first.name ?? `Book ${nn}`)
    const more = picked.length > 1 ? ` · … (${picked.length} files)` : ''
    return `${series} — ${nn} ${name}.${ext}${more}`
  }, [format, documentName, showPicker, bookNodes, selectedBookIds])

  function toggleBook(id: string) {
    setSelectedBookIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const exportDisabled =
    busy || !effectiveProfileId || (showPicker && selectedBookIds.size === 0)

  async function handleExport() {
    setBusy(true)
    setErrorMsg(null)
    try {
      const payload: Record<string, unknown> = {
        document_id: documentId,
        format,
        profile_id: effectiveProfileId,
      }
      if (showPicker) payload.book_node_ids = [...selectedBookIds]

      const res = await fetch('/api/exports', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (res.ok) {
        const body = await res.json() as { export_job_id?: string; export_job_ids?: string[] }
        const ids = body.export_job_ids ?? (body.export_job_id ? [body.export_job_id] : [])
        for (const id of ids) {
          window.dispatchEvent(new CustomEvent(EXPORT_STARTED_EVENT, {
            detail: { documentId, exportJobId: id },
          }))
          onExportStarted(id)
        }
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
              ['docx', '📄 DOCX', 'Word — editors, contests, KDP print'],
              ['epub', '📚 EPUB', 'E-book — Kindle / Kobo / Apple Books'],
              ['markdown', '⌶ Markdown', 'Plain-text manuscript — take it anywhere'],
              ['outline', '📋 Outline', 'Structural summary (Markdown)'],
            ] as [ExportFormat, string, string][]).map(([f, label, desc]) => (
              <button
                key={f}
                type="button"
                data-testid={`format-tile-${f}`}
                onClick={() => setFormat(f)}
                style={{
                  padding: 12, position: 'relative',
                  border: format === f
                    ? '1px solid var(--color-text-muted)'
                    : '1px solid var(--color-border-default)',
                  background: format === f ? 'var(--color-bg-base)' : 'var(--color-bg-surface)',
                  borderRadius: 4, cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit',
                }}
              >
                {f === 'markdown' && (
                  <span style={{
                    position: 'absolute', top: 7, right: 8, fontSize: 8, fontWeight: 600,
                    letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--color-text-muted)',
                  }}>always available</span>
                )}
                <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text-primary)' }}>{label}</div>
                <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 4 }}>{desc}</div>
              </button>
            ))}
          </div>

          {showPicker && (
            <div style={{ marginBottom: 16 }} data-testid="book-picker">
              <label style={fieldLabelStyle}>Which books? (one file each)</label>
              <div style={{
                border: '1px solid var(--color-border-default)', borderRadius: 5,
                background: 'var(--color-bg-base)', overflow: 'hidden',
              }}>
                <div style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '8px 12px', borderBottom: '1px solid var(--color-border-subtle)',
                  fontSize: 11, color: 'var(--color-text-secondary)',
                }}>
                  <span>Select the books to export</span>
                  <button
                    type="button"
                    data-testid="book-picker-select-all"
                    onClick={() => setSelectedBookIds(
                      selectedBookIds.size === bookNodes.length ? new Set() : new Set(bookNodes.map(b => b.id)),
                    )}
                    style={{
                      background: 'none', border: 'none', cursor: 'pointer', fontSize: 11,
                      color: 'var(--color-text-secondary)', borderBottom: '1px solid var(--color-border-strong)',
                    }}
                  >
                    {selectedBookIds.size === bookNodes.length ? 'Clear' : 'Select all'}
                  </button>
                </div>
                {bookNodes.map(b => {
                  const on = selectedBookIds.has(b.id)
                  const nn = String(b.order).padStart(2, '0')
                  return (
                    <button
                      key={b.id}
                      type="button"
                      data-testid={`book-row-${b.id}`}
                      onClick={() => toggleBook(b.id)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                        padding: '9px 12px', borderBottom: '1px solid var(--color-border-subtle)',
                        background: 'none', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit',
                      }}
                    >
                      <span style={{
                        width: 15, height: 15, borderRadius: 3, flexShrink: 0,
                        border: '1px solid var(--color-border-strong)',
                        background: on ? 'var(--color-text-secondary)' : 'transparent',
                        color: 'var(--color-bg-base)', fontSize: 10, lineHeight: '15px', textAlign: 'center',
                      }}>{on ? '✓' : ''}</span>
                      <span style={{
                        fontSize: 10, fontFamily: 'ui-monospace, monospace', color: 'var(--color-text-muted)',
                        border: '1px solid var(--color-border-subtle)', borderRadius: 3, padding: '1px 6px',
                      }}>{nn}</span>
                      <span style={{ fontSize: 12.5, color: 'var(--color-text-primary)' }}>
                        {b.name ?? `Book ${nn}`}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

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
            fontSize: 11, color: 'var(--color-text-muted)', marginTop: 8,
            fontFamily: 'ui-monospace, monospace',
            background: 'var(--color-bg-base)', border: '1px solid var(--color-border-subtle)',
            borderRadius: 3, padding: '6px 9px',
          }} data-testid="filename-preview">{filenamePreview}</div>

          {errorMsg && (
            <div style={{
              marginTop: 12, padding: '8px 12px', background: 'var(--color-bg-surface)',
              borderLeft: '2px solid var(--color-error)', borderRadius: 3,
              fontSize: 12, color: 'var(--color-text-secondary)',
            }}>{errorMsg}</div>
          )}

          <div style={{
            display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end', marginTop: 'var(--space-4)',
          }}>
            <button type="button" onClick={onClose} disabled={busy} style={ghostBtnStyle}>Cancel</button>
            <button
              type="button"
              onClick={handleExport}
              disabled={exportDisabled}
              data-testid="export-modal-export"
              style={{ ...primaryBtnStyle, ...(exportDisabled ? { opacity: 0.5, cursor: 'not-allowed' } : {}) }}
            >
              {busy ? 'Starting…'
                : showPicker
                  ? `Export ${selectedBookIds.size} book${selectedBookIds.size === 1 ? '' : 's'}`
                  : 'Export'}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

const fieldLabelStyle: React.CSSProperties = {
  display: 'block', fontSize: 10, fontWeight: 500, letterSpacing: '.14em',
  textTransform: 'uppercase', color: 'var(--color-text-muted)', marginBottom: 6,
}
const selectStyle: React.CSSProperties = {
  width: '100%', padding: '8px 10px', background: 'var(--color-bg-base)',
  border: '1px solid var(--color-border-default)', borderRadius: 3,
  color: 'var(--color-text-primary)', fontFamily: 'inherit', fontSize: 12,
}
const ghostBtnStyle: React.CSSProperties = {
  padding: 'var(--space-2) var(--space-4)', background: 'transparent',
  color: 'var(--color-text-secondary)', border: '1px solid var(--color-border-default)',
  borderRadius: 3, fontSize: 12, cursor: 'pointer',
}
// NOT verdigris — neutral primary token.
const primaryBtnStyle: React.CSSProperties = {
  padding: 'var(--space-2) var(--space-4)', background: 'var(--color-text-primary)',
  color: 'var(--color-bg-base)', border: 'none', borderRadius: 3,
  fontSize: 12, fontWeight: 500, cursor: 'pointer',
}
