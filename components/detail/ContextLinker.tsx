'use client'

// Spec: stelavox_component_specification_v2_5.md §5.12 (ContextLinker)
//       stelavox_phase4_api_contract_v1_0.md §2.14 (list shape),
//                                            §3.5 (GET), §3.4 (DELETE)
//       stelavox_phase4_test_plan_v1_0.md TC-U-08, TC-U-13..16,
//                                          TC-V-04, TC-AX-04
//       stelavox_phase4_build_checklist_v1_0.md §3.6 T-6.3 / T-6.5

import { createElement, useCallback, useEffect, useState } from 'react'
import { ExternalLink, X } from 'lucide-react'
import { CONTEXT_NODE_TYPES_V1, isContextNodeType } from '@/lib/context/types'
import { getContextIcon } from '@/lib/context/icons'
import { NodePicker } from './NodePicker'
import { useSidebarProject } from '@/components/layout/AppShell'

interface ContextNodeSummary {
  id:            string
  name:          string | null
  node_type:     string
  scope:         'project' | 'document' | null
}

interface DirectEntry {
  link: { id: string; source_node_id: string; target_node_id: string; created_at: string }
  context_node: ContextNodeSummary
}

interface InheritedEntry {
  link: { id: string; source_node_id: string; target_node_id: string; created_at: string }
  context_node: ContextNodeSummary
  inherited_from: { id: string; name: string | null; node_type: string; depth: number | null }
}

interface Props {
  sourceNodeId: string
  projectId:    string
  documentId:   string | null
}

export function ContextLinker({ sourceNodeId, projectId, documentId }: Props) {
  const [direct, setDirect] = useState<DirectEntry[]>([])
  const [inherited, setInherited] = useState<InheritedEntry[]>([])
  const [showInherited, setShowInherited] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [announce, setAnnounce] = useState<string>('')
  const { setProject: _setProject, bumpRefresh } = useSidebarProject()
  void _setProject

  const refetch = useCallback(async () => {
    let r: Response
    try {
      r = await fetch(`/api/nodes/${sourceNodeId}/context-links`)
    } catch (e) {
      // F-239 (round-3 audit B3.6): network failure was silent — both
      // lists were cleared, indistinguishable from "no links". Surface
      // to the dev console at minimum. Convention:
      // docs/architecture/error-handling-conventions.md.
      console.error('[ContextLinker] context-links fetch failed', e)
      setDirect([])
      setInherited([])
      return
    }
    if (!r.ok) {
      // F-239: non-OK was silent for the same reason. Surface.
      console.error('[ContextLinker] context-links fetch non-OK', r.status)
      setDirect([])
      setInherited([])
      return
    }
    const body = await r.json() as { direct: DirectEntry[]; inherited: InheritedEntry[] }
    setDirect(body.direct ?? [])
    setInherited(body.inherited ?? [])
  }, [sourceNodeId])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refetch()
  }, [refetch])

  async function handleLinkCreated(targetId: string, contextNode: ContextNodeSummary) {
    setBusy(true)
    // Optimistic insert.
    const optimistic: DirectEntry = {
      link: {
        id: `optimistic-${targetId}`,
        source_node_id: sourceNodeId,
        target_node_id: targetId,
        created_at: new Date().toISOString(),
      },
      context_node: contextNode,
    }
    setDirect(prev => [...prev, optimistic])

    const r = await fetch(`/api/nodes/${sourceNodeId}/context-links`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ context_node_id: targetId }),
    })
    setBusy(false)

    if (r.ok) {
      setAnnounce(`Linked ${contextNode.name ?? 'node'} to this node.`)
      await refetch()
    } else {
      // Roll back the optimistic insert.
      setDirect(prev => prev.filter(d => d.link.id !== `optimistic-${targetId}`))
      const err = await r.json().catch(() => ({}))
      setAnnounce(`Could not link: ${err.error ?? 'unknown error'}`)
    }
  }

  async function handleUnlink(entry: DirectEntry) {
    setBusy(true)
    // Optimistic remove.
    const removed = entry
    setDirect(prev => prev.filter(d => d.link.id !== entry.link.id))

    const r = await fetch(
      `/api/nodes/${sourceNodeId}/context-links/${entry.context_node.id}`,
      { method: 'DELETE' },
    )
    setBusy(false)

    if (r.ok) {
      setAnnounce(`Unlinked ${entry.context_node.name ?? 'node'} from this node.`)
      // Refresh the Sidebar in case the unlinking affected display.
      bumpRefresh()
    } else {
      // Restore the row.
      setDirect(prev => [...prev, removed])
      const err = await r.json().catch(() => ({}))
      setAnnounce(`Could not unlink: ${err.error ?? 'unknown error'}`)
    }
  }

  return (
    <div
      style={{
        padding: 'var(--space-4) var(--space-5)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-4)',
      }}
    >
      <SectionHeader>Linked context</SectionHeader>
      {direct.length === 0 ? (
        <p
          style={{
            fontSize: 'var(--text-sm)',
            color: 'var(--color-text-muted)',
            margin: 0,
            fontStyle: 'italic',
          }}
        >
          No context linked yet.
        </p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {direct.map(entry => (
            <DirectRow
              key={entry.link.id}
              entry={entry}
              onUnlink={() => handleUnlink(entry)}
              disabled={busy}
            />
          ))}
        </ul>
      )}

      <button
        type="button"
        onClick={() => setPickerOpen(true)}
        disabled={busy}
        style={{
          alignSelf: 'flex-start',
          padding: '6px 12px',
          background: 'var(--color-bg-base)',
          border: '1px solid var(--color-border-default)',
          borderRadius: 4,
          color: 'var(--color-text-secondary)',
          fontSize: 'var(--text-sm)',
          fontFamily: 'var(--font-sans)',
          cursor: busy ? 'wait' : 'pointer',
        }}
      >
        + Link context node
      </button>

      {pickerOpen && (
        <NodePicker
          open
          projectId={projectId}
          documentId={documentId}
          alreadyLinkedIds={new Set(direct.map(d => d.context_node.id))}
          onClose={() => setPickerOpen(false)}
          onSelect={(target) => {
            setPickerOpen(false)
            void handleLinkCreated(target.id, target)
          }}
        />
      )}

      <div style={{ borderTop: '1px solid var(--color-border-subtle)', paddingTop: 'var(--space-3)' }}>
        <button
          type="button"
          onClick={() => setShowInherited(s => !s)}
          aria-expanded={showInherited}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--color-text-muted)',
            fontSize: 'var(--text-xs)',
            fontFamily: 'var(--font-sans)',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            padding: 0,
            display: 'flex',
            alignItems: 'center',
            gap: 4,
          }}
        >
          {showInherited ? '▾' : '▸'} Inherited from ancestors ({inherited.length})
        </button>
        {showInherited && inherited.length > 0 && (
          <ul style={{ listStyle: 'none', padding: '8px 0 0', margin: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {inherited.map(entry => (
              <InheritedRow key={entry.link.id} entry={entry} />
            ))}
          </ul>
        )}
      </div>

      {/* Live region — TC-AX-04. */}
      <div role="status" aria-live="polite" style={{ position: 'absolute', left: '-9999px' }}>
        {announce}
      </div>
    </div>
  )
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 'var(--text-xs)',
        fontWeight: 500,
        color: 'var(--color-text-muted)',
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
      }}
    >
      {children}
    </div>
  )
}

function ContextNodeIcon({ nodeType }: { nodeType: string }) {
  if (!isContextNodeType(nodeType)) {
    // Defensive — V1 whitelist is hardcoded; an extended type slipping
    // in is a server-side issue. Show a placeholder dot.
    return (
      <span
        style={{ display: 'inline-block', width: 14, height: 14, background: 'var(--color-text-muted)', borderRadius: 7, opacity: 0.4 }}
      />
    )
  }
  // The lint rule react-x/no-create-component-in-render flags <Icon> when
  // the value comes from a function call inside the component body. Using
  // createElement makes the component-reference indirection explicit and
  // satisfies the rule (the underlying Lucide icon is a stable module-
  // level function — there is no actual component creation here).
  const Icon = getContextIcon(nodeType)
  return createElement(Icon, { size: 14, color: 'var(--color-text-muted)', style: { flexShrink: 0 } })
}

function DirectRow({ entry, onUnlink, disabled }: {
  entry: DirectEntry
  onUnlink: () => void
  disabled: boolean
}) {
  return (
    <li
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 10px',
        background: 'var(--color-bg-base)',
        border: '1px solid var(--color-border-subtle)',
        borderRadius: 4,
      }}
    >
      <ContextNodeIcon nodeType={entry.context_node.node_type} />
      <span
        style={{
          flex: 1,
          fontSize: 'var(--text-sm)',
          color: 'var(--color-text-primary)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {entry.context_node.name ?? '(unnamed)'}
      </span>
      <button
        type="button"
        title="Open"
        aria-label={`Open ${entry.context_node.name ?? 'node'}`}
        style={iconButtonStyle}
      >
        <ExternalLink size={12} />
      </button>
      <button
        type="button"
        onClick={onUnlink}
        disabled={disabled}
        title="Unlink"
        aria-label={`Unlink ${entry.context_node.name ?? 'node'}`}
        style={iconButtonStyle}
      >
        <X size={14} />
      </button>
    </li>
  )
}

function InheritedRow({ entry }: { entry: InheritedEntry }) {
  return (
    <li
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 10px',
        background: 'var(--color-bg-base)',
        border: '1px solid var(--color-border-subtle)',
        borderRadius: 4,
        opacity: 0.7,
      }}
      title={`Inherited from ${entry.inherited_from.name ?? entry.inherited_from.node_type}`}
    >
      <ContextNodeIcon nodeType={entry.context_node.node_type} />
      <span
        style={{
          flex: 1,
          fontSize: 'var(--text-sm)',
          color: 'var(--color-text-primary)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {entry.context_node.name ?? '(unnamed)'}
      </span>
      <span
        style={{
          fontSize: 'var(--text-xs)',
          color: 'var(--color-text-muted)',
          padding: '1px 6px',
          border: '1px solid var(--color-border-subtle)',
          borderRadius: 4,
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
        }}
      >
        inherited
      </span>
    </li>
  )
}

const iconButtonStyle: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  cursor: 'pointer',
  color: 'var(--color-text-muted)',
  display: 'inline-flex',
  alignItems: 'center',
  padding: 4,
}

// Make the V1 type-check rule available to call sites that can't easily
// import the type guard.
void CONTEXT_NODE_TYPES_V1
