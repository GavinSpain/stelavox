'use client'

// Spec: stelavox_component_specification_v2_1.md §5.11 (VersionHistory)
//       stelavox_phase3_api_contract_v1_0.md §3.2, §3.3
//       stelavox_phase3_build_checklist_v1_0.md §3.5 T-5.4
//
// 🔒 NO Restore button in Phase 3 (Phase 6 work — see §5.11 lock-aware
//    semantics block).
//
// Initial fetch: limit=7. "Show N more" loads the next 25.
// Hover on a row → fetches that version's content + the next-higher
// version's content → renders a word-level diff in a small tooltip.
// Empty state: TC-U-23 wording.

import { useEffect, useRef, useState } from 'react'

interface VersionRow {
  id: string
  node_id: string
  version: number
  changed_by: string
  change_reason: string | null
  created_at: string
}

interface FullVersion extends VersionRow {
  summary: string | null
  prose: string | null
  notes: string | null
  metadata: Record<string, unknown> | null
}

interface VersionHistoryProps {
  nodeId: string
}

const INITIAL_LIMIT = 7
const PAGE_LIMIT = 25

// Walk Tiptap JSON for plain-text contents (used by the diff).
// Stays inline rather than reaching for generateText() — avoids needing
// the extensions array here, and is small enough that the editor-side
// helper isn't worth coupling.
function extractPlainText(jsonString: string | null): string {
  if (!jsonString) return ''
  try {
    const root = JSON.parse(jsonString) as { content?: unknown[]; text?: string }
    const out: string[] = []
    function walk(node: unknown): void {
      if (!node || typeof node !== 'object') return
      const n = node as { content?: unknown[]; text?: string; type?: string }
      if (typeof n.text === 'string') out.push(n.text)
      if (Array.isArray(n.content)) {
        for (const c of n.content) walk(c)
      }
      // Paragraph boundaries become single spaces in the diff text — diff is
      // word-level so that's fine.
      if (n.type === 'paragraph') out.push(' ')
    }
    walk(root)
    return out.join('').replace(/\s+/g, ' ').trim()
  } catch {
    return jsonString
  }
}

// Compute a token-level diff via LCS. Tokens are word-runs separated by spaces.
// Returns an array of { type: 'unchanged'|'added'|'removed', text }.
type DiffSeg = { type: 'unchanged' | 'added' | 'removed'; text: string }

function diffWords(oldText: string, newText: string): DiffSeg[] {
  const a = oldText ? oldText.split(/(\s+)/) : []
  const b = newText ? newText.split(/(\s+)/) : []
  const m = a.length
  const n = b.length

  // O(mn) LCS table — bounded to short prose tooltips.
  const lcs: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (a[i] === b[j]) lcs[i][j] = lcs[i + 1][j + 1] + 1
      else lcs[i][j] = Math.max(lcs[i + 1][j], lcs[i][j + 1])
    }
  }

  const out: DiffSeg[] = []
  let i = 0, j = 0
  while (i < m && j < n) {
    if (a[i] === b[j]) { out.push({ type: 'unchanged', text: a[i] }); i++; j++ }
    else if (lcs[i + 1][j] >= lcs[i][j + 1]) { out.push({ type: 'removed', text: a[i] }); i++ }
    else { out.push({ type: 'added', text: b[j] }); j++ }
  }
  while (i < m) { out.push({ type: 'removed', text: a[i++] }) }
  while (j < n) { out.push({ type: 'added', text: b[j++] }) }
  return out
}

export function VersionHistory({ nodeId }: VersionHistoryProps) {
  const [rows, setRows]     = useState<VersionRow[]>([])
  const [total, setTotal]   = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError]   = useState(false)
  const [hoveredVersion, setHoveredVersion] = useState<number | null>(null)
  const [diffSegs, setDiffSegs] = useState<DiffSeg[] | null>(null)
  const versionCache = useRef<Map<number, FullVersion>>(new Map())

  // Initial fetch
  useEffect(() => {
    let cancelled = false
    // Reset loading + error on every nodeId change.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true)
    setError(false)
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

  async function getVersionFull(versionNumber: number): Promise<FullVersion | null> {
    const cached = versionCache.current.get(versionNumber)
    if (cached) return cached
    const res = await fetch(`/api/nodes/${nodeId}/versions/${versionNumber}`)
    if (!res.ok) return null
    const body = await res.json()
    const v = body.version as FullVersion
    versionCache.current.set(versionNumber, v)
    return v
  }

  async function onHover(versionNumber: number) {
    setHoveredVersion(versionNumber)
    setDiffSegs(null)
    // Find the next-higher version in the list (rows are DESC ordered).
    const idx = rows.findIndex(r => r.version === versionNumber)
    if (idx <= 0) {
      // Top row (current) — no next-higher to diff against; show no diff.
      const self = await getVersionFull(versionNumber)
      if (!self) return
      setDiffSegs([{ type: 'unchanged', text: extractPlainText(self.prose) }])
      return
    }
    const newer = rows[idx - 1]  // index above = newer (DESC)
    const [oldFull, newFull] = await Promise.all([
      getVersionFull(versionNumber),
      getVersionFull(newer.version),
    ])
    if (!oldFull || !newFull) return
    if (hoveredVersion !== null && versionNumber !== hoveredVersion) return
    const segs = diffWords(extractPlainText(oldFull.prose), extractPlainText(newFull.prose))
    setDiffSegs(segs)
  }

  function onLeave() {
    setHoveredVersion(null)
    setDiffSegs(null)
  }

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
        return (
          <div
            key={row.id}
            data-version-row={row.version}
            onMouseEnter={() => onHover(row.version)}
            onMouseLeave={onLeave}
            style={{
              position: 'relative',
              padding: '8px 4px',
              borderBottom: '1px solid var(--color-border-subtle)',
              cursor: 'default',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              {isCurrent && (
                <span
                  aria-label="Current version"
                  style={{ color: 'var(--color-accent)', fontSize: '11px' }}
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
                  color: 'var(--color-text-muted)',
                }}
              >
                {row.change_reason}
              </div>
            )}
            {hoveredVersion === row.version && diffSegs && (
              <div
                role="tooltip"
                style={{
                  position: 'absolute',
                  left: 0,
                  top: '100%',
                  marginTop: '4px',
                  maxWidth: '320px',
                  padding: '8px 10px',
                  background: 'var(--color-bg-elevated)',
                  border: '1px solid var(--color-border-default)',
                  borderRadius: '4px',
                  boxShadow: 'var(--shadow-md)',
                  fontFamily: 'var(--font-inter), Inter, sans-serif',
                  fontSize: '11px',
                  lineHeight: 1.5,
                  color: 'var(--color-text-secondary)',
                  zIndex: 20,
                  pointerEvents: 'none',
                }}
              >
                {diffSegs.map((seg, i) => {
                  if (seg.type === 'added') {
                    return <span key={i} style={{ textDecoration: 'underline', color: 'var(--color-text-primary)' }}>{seg.text}</span>
                  }
                  if (seg.type === 'removed') {
                    return <span key={i} style={{ textDecoration: 'line-through', color: 'var(--color-text-muted)' }}>{seg.text}</span>
                  }
                  return <span key={i}>{seg.text}</span>
                })}
              </div>
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
    </div>
  )
}
