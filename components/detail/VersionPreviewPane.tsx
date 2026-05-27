'use client'

// Spec: stelavox_component_specification_v2_10.md §5.11 (VersionHistory v2.19 amendment)
//
// Click-to-preview surface for the History tab. When the author clicks a
// version row in VersionHistory, this pane renders the full Summary +
// Prose + Notes of that version so they can decide whether to restore
// without having to restore first and undo.
//
// The pane is read-only — no editor mounts, no autosave, no toolbar.
// Typeface boundary (Inviolable #4) is honoured via the same
// `[data-editor="summary|notes|prose"]` selectors the live editors use:
// summary + notes render in Inter, prose renders in Lora. That keeps the
// preview visually faithful to the live editing surface, so the author
// is making the restore decision against the same shape they'd see in
// the editor.
//
// The renderer walks Tiptap JSON directly rather than mounting a
// read-only Tiptap instance — preview doesn't need the editor machinery,
// and walking the JSON keeps the surface lightweight and avoids
// re-creating an editor instance for every selection change. Inline
// marks supported: bold, italic, link, code. Block nodes supported:
// paragraph, heading (h1-h6), bulletList, orderedList, listItem,
// blockquote. Unknown node types fall through to rendering their
// children, so the preview can't break on an unexpected mark/node — at
// worst it loses the formatting.

import { useEffect, useState } from 'react'

interface FullVersion {
  id: string
  node_id: string
  version: number
  changed_by: string
  change_reason: string | null
  created_at: string
  // Post-M-042 the API returns JSONB columns as parsed objects; pre-M-042
  // and the editor wire format pass through as JSON-stringified docs.
  // renderTiptapJson() accepts both shapes.
  summary: string | Record<string, unknown> | null
  prose: string | Record<string, unknown> | null
  notes: string | Record<string, unknown> | null
  metadata: Record<string, unknown> | null
}

interface VersionPreviewPaneProps {
  nodeId: string
  selectedVersion: number | null
  /** Fetcher injected by parent (VersionHistory) so the cache is shared
   *  with the hover-diff machinery. Returns null on fetch failure. */
  getVersionFull: (versionNumber: number) => Promise<FullVersion | null>
}

// ──────────────────────────────────────────────────────────────────
// Tiptap JSON → React renderer
// ──────────────────────────────────────────────────────────────────

interface TiptapMark {
  type: string
  attrs?: Record<string, unknown>
}

interface TiptapNode {
  type?: string
  text?: string
  marks?: TiptapMark[]
  attrs?: Record<string, unknown>
  content?: TiptapNode[]
}

function applyMarks(text: string, marks: TiptapMark[] | undefined, key: string): React.ReactNode {
  if (!marks || marks.length === 0) return text
  // Wrap inside-out: innermost mark first, outermost last. Order in the
  // marks array is innermost → outermost per Tiptap convention.
  let node: React.ReactNode = text
  for (const mark of marks) {
    if (mark.type === 'bold') {
      node = <strong key={key}>{node}</strong>
    } else if (mark.type === 'italic') {
      node = <em key={key}>{node}</em>
    } else if (mark.type === 'code') {
      node = (
        <code
          key={key}
          style={{
            fontFamily: 'var(--font-mono), ui-monospace, monospace',
            fontSize: '0.9em',
            background: 'var(--color-bg-elevated)',
            padding: '0 4px',
            borderRadius: 2,
          }}
        >
          {node}
        </code>
      )
    } else if (mark.type === 'link') {
      const href = typeof mark.attrs?.href === 'string' ? mark.attrs.href : '#'
      node = (
        <a
          key={key}
          href={href}
          target="_blank"
          rel="noreferrer noopener"
          style={{ color: 'var(--color-text-primary)', textDecoration: 'underline' }}
        >
          {node}
        </a>
      )
    }
    // Unknown marks: skip silently (text still renders unmarked).
  }
  return node
}

function renderInline(nodes: TiptapNode[] | undefined, keyBase: string): React.ReactNode[] {
  if (!nodes || nodes.length === 0) return []
  return nodes.map((n, i) => {
    const key = `${keyBase}-${i}`
    if (typeof n.text === 'string') {
      return <span key={key}>{applyMarks(n.text, n.marks, key)}</span>
    }
    if (n.type === 'hardBreak') {
      return <br key={key} />
    }
    // Inline-level node with content (rare — usually only text nodes are inline).
    if (n.content) return <span key={key}>{renderInline(n.content, key)}</span>
    return null
  })
}

function renderBlock(node: TiptapNode, keyBase: string): React.ReactNode {
  const t = node.type
  const children = node.content
  // Headings — Tiptap stores level in attrs.level.
  if (t === 'heading') {
    const level = Math.min(Math.max(Number(node.attrs?.level ?? 2), 1), 6)
    // Inline heading styles preserve the preview's typeface
    // (Lora for prose preview, Inter for summary/notes preview) rather
    // than fighting the host's heading defaults.
    const headingStyle: React.CSSProperties = {
      margin: '0.6em 0 0.3em',
      fontWeight: 600,
      lineHeight: 1.3,
    }
    const inner = renderInline(children, keyBase)
    switch (level) {
      case 1: return <h1 key={keyBase} style={{ ...headingStyle, fontSize: '1.4em' }}>{inner}</h1>
      case 2: return <h2 key={keyBase} style={{ ...headingStyle, fontSize: '1.25em' }}>{inner}</h2>
      case 3: return <h3 key={keyBase} style={{ ...headingStyle, fontSize: '1.15em' }}>{inner}</h3>
      case 4: return <h4 key={keyBase} style={{ ...headingStyle, fontSize: '1.05em' }}>{inner}</h4>
      case 5: return <h5 key={keyBase} style={headingStyle}>{inner}</h5>
      default: return <h6 key={keyBase} style={headingStyle}>{inner}</h6>
    }
  }
  if (t === 'paragraph') {
    return (
      <p key={keyBase}>
        {renderInline(children, keyBase)}
      </p>
    )
  }
  if (t === 'bulletList') {
    return (
      <ul key={keyBase} style={{ paddingLeft: '1.4em', margin: '0.4em 0' }}>
        {children?.map((c, i) => renderBlock(c, `${keyBase}-${i}`))}
      </ul>
    )
  }
  if (t === 'orderedList') {
    return (
      <ol key={keyBase} style={{ paddingLeft: '1.4em', margin: '0.4em 0' }}>
        {children?.map((c, i) => renderBlock(c, `${keyBase}-${i}`))}
      </ol>
    )
  }
  if (t === 'listItem') {
    return (
      <li key={keyBase}>
        {children?.map((c, i) => renderBlock(c, `${keyBase}-${i}`))}
      </li>
    )
  }
  if (t === 'blockquote') {
    return (
      <blockquote
        key={keyBase}
        style={{
          margin: '0.6em 0',
          paddingLeft: '12px',
          borderLeft: '3px solid var(--color-border-default)',
          color: 'var(--color-text-secondary)',
        }}
      >
        {children?.map((c, i) => renderBlock(c, `${keyBase}-${i}`))}
      </blockquote>
    )
  }
  if (t === 'horizontalRule') {
    return <hr key={keyBase} style={{ border: 0, borderTop: '1px solid var(--color-border-subtle)', margin: '0.8em 0' }} />
  }
  if (t === 'hardBreak') {
    return <br key={keyBase} />
  }
  // Unknown block — fall through to inline rendering of any children so
  // text isn't lost.
  if (children && children.length > 0) {
    return <div key={keyBase}>{children.map((c, i) => renderBlock(c, `${keyBase}-${i}`))}</div>
  }
  if (typeof node.text === 'string') {
    return <span key={keyBase}>{applyMarks(node.text, node.marks, keyBase)}</span>
  }
  return null
}

/** Render a Tiptap doc. Accepts either the JSON-stringified wire shape
 *  (legacy / fixture path) or the parsed object the Supabase JS client
 *  returns for JSONB columns (post-M-042). Exported for unit testing.
 *  Returns null when the input is unparseable or empty. */
export function renderTiptapJson(input: string | object | null | undefined): React.ReactNode {
  if (input === null || input === undefined) return null
  let root: TiptapNode
  if (typeof input === 'string') {
    if (input === '') return null
    try {
      root = JSON.parse(input) as TiptapNode
    } catch {
      // Not parseable JSON — fall back to plain-text rendering so the
      // author at least sees something rather than a broken preview.
      return <p>{input}</p>
    }
  } else if (typeof input === 'object') {
    // Supabase JS returns JSONB columns pre-parsed. Use the object directly.
    root = input as TiptapNode
  } else {
    return null
  }
  if (!root || typeof root !== 'object') return null
  // The root is usually { type: 'doc', content: [...] }. We render its
  // content; the root itself is a container and produces no element.
  if (!root.content || root.content.length === 0) return null
  return <>{root.content.map((c, i) => renderBlock(c, `n${i}`))}</>
}

// ──────────────────────────────────────────────────────────────────
// Preview pane
// ──────────────────────────────────────────────────────────────────

export function VersionPreviewPane({ nodeId, selectedVersion, getVersionFull }: VersionPreviewPaneProps) {
  const [full, setFull] = useState<FullVersion | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    if (selectedVersion === null) {
      setFull(null)
      setLoading(false)
      return () => { cancelled = true }
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true)
    void getVersionFull(selectedVersion).then(v => {
      if (cancelled) return
      setFull(v)
      setLoading(false)
    })
    return () => { cancelled = true }
    // nodeId is in the dependency list so a node-switch clears the pane
    // even if the parent leaves selectedVersion set across the switch.
  }, [selectedVersion, nodeId, getVersionFull])

  if (selectedVersion === null) {
    return (
      <div
        data-testid="version-preview-empty"
        style={{
          margin: 'var(--space-4) var(--space-4) var(--space-3)',
          padding: 'var(--space-4)',
          border: '1px dashed var(--color-border-subtle)',
          borderRadius: 'var(--radius-sm)',
          color: 'var(--color-text-muted)',
          fontFamily: 'var(--font-inter), Inter, sans-serif',
          fontSize: 'var(--text-sm)',
          textAlign: 'center',
        }}
      >
        Click a version above to preview its contents.
      </div>
    )
  }

  if (loading && !full) {
    return (
      <div
        data-testid="version-preview-loading"
        style={{
          margin: 'var(--space-4) var(--space-4) var(--space-3)',
          padding: 'var(--space-4)',
          color: 'var(--color-text-muted)',
          fontFamily: 'var(--font-inter), Inter, sans-serif',
          fontSize: 'var(--text-sm)',
        }}
      >
        Loading v{selectedVersion}…
      </div>
    )
  }

  if (!full) {
    return (
      <div
        data-testid="version-preview-error"
        style={{
          margin: 'var(--space-4) var(--space-4) var(--space-3)',
          padding: 'var(--space-4)',
          color: 'var(--color-text-muted)',
          fontFamily: 'var(--font-inter), Inter, sans-serif',
          fontSize: 'var(--text-sm)',
        }}
      >
        Could not load v{selectedVersion}.
      </div>
    )
  }

  const summaryNode = renderTiptapJson(full.summary)
  const proseNode = renderTiptapJson(full.prose)
  const notesNode = renderTiptapJson(full.notes)
  const anyContent = summaryNode || proseNode || notesNode

  return (
    <div
      data-testid="version-preview-pane"
      data-preview-version={selectedVersion}
      style={{
        margin: 'var(--space-3) var(--space-4) var(--space-3)',
        padding: 'var(--space-4)',
        background: 'var(--color-bg-base)',
        border: '1px solid var(--color-border-subtle)',
        borderRadius: 'var(--radius-sm)',
      }}
    >
      <div
        style={{
          fontFamily: 'var(--font-inter), Inter, sans-serif',
          fontSize: '11px',
          color: 'var(--color-text-muted)',
          marginBottom: 'var(--space-3)',
          letterSpacing: '0.02em',
          textTransform: 'uppercase',
        }}
      >
        Preview — v{full.version} · {new Date(full.created_at).toLocaleString()}
      </div>

      {!anyContent && (
        <div
          data-testid="version-preview-empty-content"
          style={{
            color: 'var(--color-text-muted)',
            fontFamily: 'var(--font-inter), Inter, sans-serif',
            fontSize: 'var(--text-sm)',
            fontStyle: 'italic',
          }}
        >
          This version has no summary, prose, or notes content.
        </div>
      )}

      {summaryNode && (
        <PreviewSection label="Summary" editor="summary">
          {summaryNode}
        </PreviewSection>
      )}

      {proseNode && (
        <PreviewSection label="Prose" editor="prose">
          {proseNode}
        </PreviewSection>
      )}

      {notesNode && (
        <PreviewSection label="Notes" editor="notes">
          {notesNode}
        </PreviewSection>
      )}
    </div>
  )
}

function PreviewSection({
  label,
  editor,
  children,
}: {
  label: string
  editor: 'summary' | 'prose' | 'notes'
  children: React.ReactNode
}) {
  return (
    <div style={{ marginBottom: 'var(--space-4)' }} data-testid={`version-preview-section-${editor}`}>
      <div
        style={{
          fontFamily: 'var(--font-inter), Inter, sans-serif',
          fontSize: '10px',
          fontWeight: 600,
          color: 'var(--color-text-muted)',
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
          marginBottom: 'var(--space-2)',
        }}
      >
        {label}
      </div>
      {/* The data-editor attribute picks up the editor-specific typeface
          rules from app/globals.css (Inter for summary/notes, Lora for
          prose) — the .tiptap selector on those rules is paired here so
          the existing CSS applies without duplication. */}
      <div data-editor={editor}>
        <div
          className="tiptap"
          style={{
            // Preview overrides: no min-height, no bottom padding (those
            // are for the live editor's writing affordance). Word-wrap
            // matches the editor.
            wordBreak: 'break-word',
            whiteSpace: 'normal',
            paddingBottom: 0,
          }}
        >
          {children}
        </div>
      </div>
    </div>
  )
}
