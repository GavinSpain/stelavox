'use client'

// Spec: stelavox_component_specification_v2_10.md §5.11 (v2.20 amendment)
//       stelavox_phase3_api_contract_v1_0.md §3.2, §3.3
//       Phase 6.C wireframe §05 — Restore action.
//
// Phase 3 shipped the list + hover-tooltip word-level diff. Phase 6.C
// added the Restore button on hover + RestoreConfirmModal + disabled
// states for nodes that are author-locked / in use / agent in-flight.
// The v2.19 amendment added a click-to-preview pane below the list.
// The v2.20 amendment removed the hover-diff tooltip — the click-to-
// preview pane is the single surface for inspecting historical content
// (two parallel surfaces was confusing UX; the preview pane gives a
// faithful read of the prose, summary, and notes which the 320px diff
// tooltip never could).
//
// Initial fetch: limit=7. "Show N more" loads the next 25.
// Click on a row → selects it (mirrored in the preview pane); click
//                  the same row again to deselect.
// Hover a row → Restore button fades in (Phase 6.C affordance).
// Empty state: TC-U-23 wording.

import { useCallback, useEffect, useRef, useState } from 'react'
import { RestoreConfirmModal } from './RestoreConfirmModal'
import { VersionPreviewPane } from './VersionPreviewPane'

interface VersionRow {
  id: string
  node_id: string
  version: number
  changed_by: string
  change_reason: string | null
  created_at: string
}

interface FullVersion extends VersionRow {
  // Post-M-042 the API returns JSONB columns as parsed objects; pre-M-042
  // and the editor wire format pass through as JSON-stringified docs.
  // The VersionPreviewPane renderer accepts either shape.
  summary: string | Record<string, unknown> | null
  prose: string | Record<string, unknown> | null
  notes: string | Record<string, unknown> | null
  metadata: Record<string, unknown> | null
}

interface VersionHistoryProps {
  nodeId: string
  // Phase 6.C: caller (NodeDetailPanel) signals whether restore is
  // available right now. Computed from check_node_writable on mount.
  // When the node is not writable, the Restore button renders in a
  // disabled state with a tooltip explaining why.
  restoreDisabledReason?: 'author_locked' | 'node_in_use' | 'node_in_progress' | null
  nodeName?: string
  currentVersion?: number
  onRestored?: (newVersion: number) => void
}

const INITIAL_LIMIT = 7
const PAGE_LIMIT = 25

// (v2.20 amendment) Removed extractPlainText + diffWords + DiffSeg —
// these powered the hover-diff tooltip which is gone. The click-to-
// preview pane below the list is now the single inspection surface.
// The unit/Vitest renderer for VersionPreviewPane handles the
// Tiptap-JSON walk that extractPlainText previously did inline.

export function VersionHistory({
  nodeId,
  restoreDisabledReason = null,
  nodeName = 'this node',
  currentVersion,
  onRestored,
}: VersionHistoryProps) {
  const [rows, setRows]     = useState<VersionRow[]>([])
  const [total, setTotal]   = useState(0)
  const [restoreModalOpen, setRestoreModalOpen] = useState(false)
  const [restoreTargetVersion, setRestoreTargetVersion] = useState<number | null>(null)
  const [restoreTargetMeta, setRestoreTargetMeta] = useState<{ changedAt: string; changeReason: string | null } | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError]   = useState(false)
  // v2.20: simple per-row hover boolean (just the version number being
  // hovered, or null). Drives the Restore button fade-in (Phase 6.C
  // affordance). No content fetched on hover; the click-to-preview pane
  // is the inspection surface.
  const [hoveredRowVersion, setHoveredRowVersion] = useState<number | null>(null)
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null)
  const versionCache = useRef<Map<number, FullVersion>>(new Map())

  // Initial fetch
  useEffect(() => {
    let cancelled = false
    // Reset loading + error + selection + cache on every nodeId change.
    // The cache is per-node — historical versions from one node can't be
    // reused for another. Clearing it prevents the preview pane briefly
    // rendering the wrong node's content after a tree-navigation.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true)
    setError(false)
    setSelectedVersion(null)
    versionCache.current = new Map()
    fetch(`/api/nodes/${nodeId}/versions?limit=${INITIAL_LIMIT}&offset=0`)
      .then(r => r.json().then(body => ({ ok: r.ok, body })))
      .then(({ ok, body }) => {
        if (cancelled) return
        if (!ok) { setError(true); return }
        setRows(body.versions ?? [])
        setTotal(body.total ?? 0)
        setHasMore(!!body.has_more)
      })
      .catch(() => { if (!cancelled) setError(true) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [nodeId])

  async function loadMore() {
    const res = await fetch(`/api/nodes/${nodeId}/versions?limit=${PAGE_LIMIT}&offset=${rows.length}`)
    if (!res.ok) return
    const body = await res.json()
    setRows(prev => [...prev, ...(body.versions ?? [])])
    setTotal(body.total ?? rows.length)
    setHasMore(!!body.has_more)
  }

  // useCallback so the reference is stable across renders — the preview
  // pane's useEffect depends on this function and would re-run on every
  // parent render otherwise.
  const getVersionFull = useCallback(async (versionNumber: number): Promise<FullVersion | null> => {
    const cached = versionCache.current.get(versionNumber)
    if (cached) return cached
    const res = await fetch(`/api/nodes/${nodeId}/versions/${versionNumber}`)
    if (!res.ok) return null
    const body = await res.json()
    const v = body.version as FullVersion
    versionCache.current.set(versionNumber, v)
    return v
  }, [nodeId])

  if (loading) {
    return (
      <div style={{ padding: 'var(--space-4)', color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>
        Loading…
      </div>
    )
  }

  if (error) {
    return (
      <div style={{ padding: 'var(--space-4)', color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>
        Could not load version history.
      </div>
    )
  }

  if (rows.length === 0) {
    return (
      <div
        style={{
          padding: 'var(--space-5) var(--space-4)',
          color: 'var(--color-text-muted)',
          fontSize: 'var(--text-sm)',
          fontFamily: 'var(--font-inter), Inter, sans-serif',
          lineHeight: 1.6,
        }}
      >
        Versions are recorded when the agent revises this node. Agent operations arrive in Phase 5.
      </div>
    )
  }

  return (
    <div style={{ padding: 'var(--space-3) var(--space-4)' }}>
      {rows.map((row, idx) => {
        const isCurrent = idx === 0
        const isSelected = selectedVersion === row.version
        return (
          <div
            key={row.id}
            data-version-row={row.version}
            data-version-selected={isSelected ? 'true' : 'false'}
            role="button"
            tabIndex={0}
            aria-pressed={isSelected}
            aria-label={`Preview v${row.version}`}
            onMouseEnter={() => setHoveredRowVersion(row.version)}
            onMouseLeave={() => setHoveredRowVersion(prev => (prev === row.version ? null : prev))}
            onClick={() => setSelectedVersion(prev => (prev === row.version ? null : row.version))}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                setSelectedVersion(prev => (prev === row.version ? null : row.version))
              }
            }}
            style={{
              position: 'relative',
              padding: '8px 4px 8px 8px',
              borderBottom: '1px solid var(--color-border-subtle)',
              // 2px left selection bar in --color-text-primary (NOT
              // verdigris — selection is informational, not affirmative
              // action; Inviolable #2 unchanged).
              borderLeft: isSelected
                ? '2px solid var(--color-text-primary)'
                : '2px solid transparent',
              background: isSelected ? 'var(--color-bg-elevated)' : 'transparent',
              cursor: 'pointer',
              transition: 'background var(--duration-fast) var(--easing-default)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              {isCurrent && (
                <span
                  aria-label="Current version"
                  // Component Spec §5.11 calls for verdigris-tinted but the Brand
                  // Identity / CLAUDE.md Inviolable #2 enumerates only nine
                  // permitted verdigris uses, and the current-version star is
                  // not among them. Phase 3 Build Checklist criterion 14b
                  // admits only uses #3 (cursor) and #6 (word count at target)
                  // for this phase, so the star uses --color-text-primary
                  // pending upstream reconciliation (see test report SU).
                  style={{ color: 'var(--color-text-primary)', fontSize: '11px' }}
                >
                  ★
                </span>
              )}
              <span
                style={{
                  fontFamily: 'var(--font-inter), Inter, sans-serif',
                  fontWeight: 600,
                  fontSize: '11px',
                  color: 'var(--color-text-primary)',
                }}
              >
                v{row.version}
              </span>
              <span style={{ color: 'var(--color-text-muted)', fontSize: '10px', fontWeight: 300 }}>
                {new Date(row.created_at).toLocaleString()}
              </span>
              <span style={{ color: 'var(--color-text-muted)', fontSize: '10px' }}>·</span>
              <span style={{ color: 'var(--color-text-secondary)', fontSize: '11px' }}>
                {row.changed_by}
              </span>
            </div>
            {row.change_reason && (
              <div
                style={{
                  marginTop: '2px',
                  fontFamily: 'var(--font-inter), Inter, sans-serif',
                  fontSize: '11px',
                  fontWeight: 300,
                  color: row.change_reason.startsWith('restore_from_v')
                    ? 'var(--color-status-review)'
                    : 'var(--color-text-muted)',
                  fontStyle: row.change_reason.startsWith('restore_from_v') ? 'italic' : 'normal',
                }}
              >
                {row.change_reason.startsWith('restore_from_v')
                  ? `restored from v${row.change_reason.substring('restore_from_v'.length)}`
                  : row.change_reason}
              </div>
            )}
            {/* Phase 6.C: Restore button on hover (non-current rows only). */}
            {!isCurrent && (
              <button
                type="button"
                disabled={restoreDisabledReason !== null}
                data-testid={`version-restore-${row.version}`}
                title={
                  restoreDisabledReason === 'author_locked'
                    ? 'This node is locked. Unlock it from the More menu before restoring.'
                    : restoreDisabledReason === 'node_in_use'
                      ? 'Another author is editing this node. You can restore when they finish.'
                      : restoreDisabledReason === 'node_in_progress'
                        ? 'Agent result pending review. Accept or Dismiss the pending result first, then restore.'
                        : `Restore to v${row.version}`
                }
                onClick={(e) => {
                  // Stop the row's onClick — we don't want clicking
                  // Restore to also toggle the row's preview selection.
                  e.stopPropagation()
                  if (restoreDisabledReason !== null) return
                  setRestoreTargetVersion(row.version)
                  setRestoreTargetMeta({
                    changedAt: row.created_at,
                    changeReason: row.change_reason,
                  })
                  setRestoreModalOpen(true)
                }}
                style={{
                  position: 'absolute',
                  right: 4,
                  top: 6,
                  fontSize: '10px',
                  color: restoreDisabledReason !== null
                    ? 'var(--color-text-muted)'
                    : 'var(--color-error)',
                  border: `1px solid ${restoreDisabledReason !== null
                    ? 'var(--color-border-subtle)'
                    : 'var(--color-error)'}`,
                  borderRadius: 3,
                  padding: '3px 10px',
                  background: 'transparent',
                  cursor: restoreDisabledReason !== null ? 'not-allowed' : 'pointer',
                  opacity: hoveredRowVersion === row.version || restoreDisabledReason !== null ? 1 : 0,
                  transition: 'opacity 120ms ease',
                }}
              >
                Restore…
              </button>
            )}
          </div>
        )
      })}
      {hasMore && (
        <button
          type="button"
          onClick={loadMore}
          style={{
            marginTop: 'var(--space-3)',
            padding: '4px 8px',
            background: 'transparent',
            border: 'none',
            color: 'var(--color-text-secondary)',
            fontFamily: 'var(--font-inter), Inter, sans-serif',
            fontSize: '11px',
            cursor: 'pointer',
            textDecoration: 'underline',
          }}
        >
          Show {Math.min(PAGE_LIMIT, total - rows.length)} more versions…
        </button>
      )}

      {/* Click-to-preview pane (v2.19 amendment). Hidden when there are
          no rows — the empty-state copy above already covers that case. */}
      <VersionPreviewPane
        nodeId={nodeId}
        selectedVersion={selectedVersion}
        getVersionFull={getVersionFull}
      />

      <RestoreConfirmModal
        open={restoreModalOpen && restoreTargetVersion !== null}
        nodeId={nodeId}
        nodeName={nodeName}
        targetVersion={restoreTargetVersion ?? 0}
        targetVersionMeta={restoreTargetMeta ?? undefined}
        expectedVersion={currentVersion ?? (rows[0]?.version ?? 1)}
        onClose={() => {
          setRestoreModalOpen(false)
          setRestoreTargetVersion(null)
          setRestoreTargetMeta(null)
        }}
        onRestored={(newVersion) => {
          // Refresh the list — the new version row will appear at the top.
          void (async () => {
            const r = await fetch(`/api/nodes/${nodeId}/versions?limit=${INITIAL_LIMIT}`)
            if (r.ok) {
              const body = await r.json() as { versions: VersionRow[]; total: number }
              setRows(body.versions)
              setTotal(body.total)
            }
            onRestored?.(newVersion)
          })()
        }}
        onVersionConflict={() => {
          void (async () => {
            const r = await fetch(`/api/nodes/${nodeId}/versions?limit=${INITIAL_LIMIT}`)
            if (r.ok) {
              const body = await r.json() as { versions: VersionRow[]; total: number }
              setRows(body.versions)
              setTotal(body.total)
            }
          })()
        }}
      />
    </div>
  )
}
