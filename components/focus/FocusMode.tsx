'use client'

// Spec: stelavox_component_specification_v2_1.md §6.1
//       stelavox_phase3_build_checklist_v1_0.md §3.6 T-6.1 / T-6.2 / T-6.7 / T-6.8
//
// Full-viewport overlay above AppShell. The four AppShell elements
// (header / sidebar / tree / detail) are transformed off-screen via the
// body.focus-mode-active class — CSS in globals.css owns the simultaneous
// 280ms transition.
//
// Keys:
//   • Esc / ⌘Return → exit
//   • ⌘← / ⌘→       → sibling navigation (T-6.7) — fades prose 150ms each way
// 🔒 ⌘Return must NOT trigger Tiptap's hard-break inside the editor (T-6.8).

import { useCallback, useEffect, useRef, useState } from 'react'
import { ProseEditor } from '@/components/detail/ProseEditor'
import { FocusBreadcrumb } from './FocusBreadcrumb'
import { FocusEscHint } from './FocusEscHint'
import { TypewriterContainer } from './TypewriterContainer'
import { SentenceFocus } from './SentenceFocus'
import { useEditorStore } from '@/lib/stores/editor-store'

interface FocusModeNode {
  id: string
  name: string | null
  parent_id: string | null
  document_id: string | null
  word_count_target: number | null
}

interface FocusModeProps {
  node: FocusModeNode
  onExit: () => void
}

interface SiblingRow {
  id: string
  name: string | null
  parent_id: string | null
  order: number
  word_count_target: number | null
}

const TYPEWRITER_KEY = 'stelavox_typewriter_enabled'
const SENTENCE_KEY   = 'stelavox_sentence_focus_enabled'

export function FocusMode({ node, onExit }: FocusModeProps) {
  const [activeNode, setActiveNode] = useState<FocusModeNode>(node)
  const [siblings, setSiblings] = useState<SiblingRow[]>([])
  const [proseFading, setProseFading] = useState(false)
  // Default ON in Focus Mode for typewriter; OFF for sentence focus (§6.4 / §6.5).
  const [typewriterEnabled, setTypewriterEnabled] = useState(true)
  const [sentenceFocusEnabled, setSentenceFocusEnabled] = useState(false)
  const enteringRef = useRef(true)

  const prose = useEditorStore(s => s.prose)
  const setField = useEditorStore(s => s.setField)
  const lockedReason = useEditorStore(s => s.lockedReason)
  const flushPending = useEditorStore(s => s.flushPending)
  const loadNode = useEditorStore(s => s.loadNode)

  // Persisted toggles — hydrate from localStorage on mount (SSR-safe pattern).
  useEffect(() => {
    if (typeof window === 'undefined') return
    const t = window.localStorage.getItem(TYPEWRITER_KEY)
    if (t !== null) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTypewriterEnabled(t === 'true')
    }
    const s = window.localStorage.getItem(SENTENCE_KEY)
    if (s !== null) {
      setSentenceFocusEnabled(s === 'true')
    }
  }, [])

  // Mount: set body class for AppShell transitions (T-6.2).
  // Unmount: remove class so AppShell slides back. Exact-mirror exit.
  useEffect(() => {
    document.body.classList.add('focus-mode-active')
    enteringRef.current = false
    return () => {
      document.body.classList.remove('focus-mode-active')
    }
  }, [])

  // Load siblings for ⌘←/⌘→ navigation (T-6.7).
  useEffect(() => {
    if (!node.document_id) return
    let cancelled = false
    fetch(`/api/documents/${node.document_id}/nodes`)
      .then(r => r.json())
      .then(body => {
        if (cancelled) return
        const all = (body.nodes ?? []) as Array<SiblingRow & { parent_id: string | null }>
        const sibs = all
          .filter(r => r.parent_id === node.parent_id)
          .sort((a, b) => a.order - b.order)
        setSiblings(sibs)
      })
      .catch(() => { /* sibling navigation simply does nothing */ })
    return () => { cancelled = true }
  }, [node.document_id, node.parent_id])

  const navigateSibling = useCallback(async (dir: -1 | 1) => {
    if (siblings.length === 0) return
    const idx = siblings.findIndex(s => s.id === activeNode.id)
    if (idx < 0) return
    const target = siblings[idx + dir]
    if (!target) return

    // Prose fades out 150ms, breadcrumb updates instantly, prose fades in 150ms
    setProseFading(true)
    await flushPending()

    // Fetch the target's full body so loadNode can populate the store.
    const r = await fetch(`/api/nodes/${target.id}`)
    if (!r.ok) {
      setProseFading(false)
      return
    }
    const body = await r.json()
    const fetched = body.node
    loadNode({
      id: fetched.id,
      version: fetched.version,
      summary: fetched.summary,
      prose: fetched.prose,
      notes: fetched.notes,
      metadata: fetched.metadata,
    })
    setActiveNode({
      id: fetched.id,
      name: fetched.name,
      parent_id: fetched.parent_id,
      document_id: fetched.document_id,
      word_count_target: fetched.word_count_target,
    })

    // Briefly hold the fade-out, then fade in
    setTimeout(() => setProseFading(false), 150)
  }, [siblings, activeNode.id, flushPending, loadNode])

  // Keybindings (T-6.8 + T-6.7)
  useEffect(() => {
    function onKeydown(e: KeyboardEvent) {
      const isMod = e.metaKey || e.ctrlKey

      if (e.key === 'Escape') {
        e.preventDefault()
        onExit()
        return
      }
      if (isMod && e.key === 'Enter') {
        // ⌘Return as exit. Block Tiptap's hard-break.
        e.preventDefault()
        e.stopPropagation()
        onExit()
        return
      }
      if (isMod && e.key === 'ArrowLeft') {
        e.preventDefault()
        void navigateSibling(-1)
        return
      }
      if (isMod && e.key === 'ArrowRight') {
        e.preventDefault()
        void navigateSibling(1)
        return
      }
    }
    window.addEventListener('keydown', onKeydown, { capture: true })
    return () => window.removeEventListener('keydown', onKeydown, { capture: true } as EventListenerOptions)
  }, [navigateSibling, onExit])

  const breadcrumbSegments = ['Document', activeNode.name ?? '(untitled)']

  return (
    <div
      data-focus-mode="active"
      data-sentence-focus={sentenceFocusEnabled ? '' : undefined}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        background: 'var(--color-bg-base)',  // 🔒 Inviolable #1 — bg-base only
        overflow: 'auto',
      }}
    >
      <FocusBreadcrumb segments={breadcrumbSegments} />

      <div
        style={{
          minHeight: '100vh',
          paddingTop: '120px',
          paddingBottom: '120px',
          opacity: proseFading ? 0 : 1,
          transition: 'opacity 150ms var(--easing-prose, cubic-bezier(0.16, 1, 0.3, 1))',
        }}
      >
        <TypewriterContainer enabled={typewriterEnabled}>
          <ProseEditor
            mode="focus"
            value={prose}
            onChange={(v) => setField('prose', v)}
            readOnly={!!lockedReason}
            wordTarget={activeNode.word_count_target}
          />
        </TypewriterContainer>
      </div>

      <SentenceFocus enabled={sentenceFocusEnabled} />

      <FocusEscHint />
    </div>
  )
}
