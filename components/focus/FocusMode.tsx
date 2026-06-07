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
import { createPortal } from 'react-dom'
import { ProseEditor } from '@/components/detail/ProseEditor'
import { FocusBreadcrumb, type FocusBreadcrumbSegment } from './FocusBreadcrumb'
import { FocusEscHint } from './FocusEscHint'
import { TypewriterContainer } from './TypewriterContainer'
import { ProseSettingsMenu } from '@/components/detail/ProseSettingsMenu'
import { useProseSettings } from '@/lib/hooks/useProseSettings'
import { useEditorStore } from '@/lib/stores/editor-store'
import { createClient } from '@/lib/supabase/client'
import { getAncestorChain } from '@/lib/nodes/getAncestorChain'
import { classifySwipe } from '@/lib/focus/swipeDetect'
import type { LayerKind } from '@/components/tree/LayerLabel'

// Phase 8.01.B T-1 — V1 structural layer set for the breadcrumb's leaf
// segment. Phase 14 replaces with layer_stack-driven validation.
const FOCUS_LAYER_KINDS: ReadonlySet<string> = new Set<LayerKind>([
  'series', 'book', 'act', 'chapter', 'scene', 'beat',
])

// Phase 8.01.B T-6.2 — cross-parent wrap helpers. When the same-parent
// siblings list is exhausted in direction `dir` (forward=1 / back=-1),
// walk UP through ancestors to find the nearest level with a next/previous
// sibling, then descend to find the appropriate leaf:
//   forward → leftmost leaf descendant of the next aunt/uncle (recursively
//             at deeper levels)
//   back    → rightmost leaf descendant of the previous aunt/uncle
//
// Recursive: if there's no aunt at the scene level (e.g. the active beat
// is the last leaf of the last scene of an act), we ascend to the act
// level and try the next/previous act, then descend into its first/last
// leaf. This handles the real-world case where the same act has only one
// scene but the document has multiple acts.
//
// If no aunt exists at any ancestor level (the document boundary),
// return undefined and the caller no-ops per T-6.3 stop-at-document-end.
//
// Exported for unit tests (T-7).
export function findCrossParentLeaf(
  allNodes: ReadonlyArray<SiblingRow>,
  parentId: string,
  dir: -1 | 1,
): SiblingRow | undefined {
  const parentRow = allNodes.find(n => n.id === parentId)
  if (!parentRow) return undefined
  const aunts = allNodes
    .filter(n => n.parent_id === parentRow.parent_id)
    .sort((a, b) => a.order - b.order)
  const auntIdx = aunts.findIndex(a => a.id === parentId)
  if (auntIdx < 0) return undefined
  const nextAunt = aunts[auntIdx + dir]
  if (nextAunt) {
    return findLeafDescendant(allNodes, nextAunt.id, dir)
  }
  // No sibling at this level — recurse up to the next ancestor and try
  // its siblings. T-6.3 stop-at-document-end implicitly handled by the
  // recursion terminating when parentRow.parent_id is null.
  if (parentRow.parent_id === null) return undefined
  return findCrossParentLeaf(allNodes, parentRow.parent_id, dir)
}

export function findLeafDescendant(
  allNodes: ReadonlyArray<SiblingRow>,
  rootId: string,
  dir: -1 | 1,
): SiblingRow | undefined {
  let cursor: SiblingRow | undefined = allNodes.find(n => n.id === rootId)
  let safety = 20
  while (cursor && safety > 0) {
    if (cursor.is_leaf === true) {
      return cursor
    }
    const kids = allNodes
      .filter(n => n.parent_id === cursor!.id)
      .sort((a, b) => a.order - b.order)
    if (kids.length === 0) return undefined
    cursor = dir === 1 ? kids[0] : kids[kids.length - 1]
    safety -= 1
  }
  return undefined
}

interface FocusModeNode {
  id: string
  name: string | null
  parent_id: string | null
  document_id: string | null
  word_count_target: number | null
  // Phase 8.01.B T-1.1 — needed for the structured-segment breadcrumb
  // (Component Spec v2.21 §6.2 / §18.1). Optional for backward compat
  // with any caller not yet migrated; missing values disable the leaf
  // bracketed-label rendering but the rest of the breadcrumb still works.
  node_type?: string
  order?: number
  layer_index?: number | null
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
  // Phase 8.01.B T-1: needed so navigateSibling can populate activeNode's
  // node_type for the breadcrumb without re-fetching the row.
  node_type?: string
  // Phase 8.01.B T-6.1 — filter siblings to leaf-only per Spec §6.1
  // ("the navigation never lands on a non-leaf"). The /api/documents/.../nodes
  // route decorates every row with is_leaf.
  is_leaf?: boolean
}

// Storage keys for the two prose-aid toggles live in
// lib/hooks/useProseSettings.ts (Phase 8.8). Both Edit Mode and Focus
// Mode read/write via that shared hook so a change in one surface
// immediately reflects in the other.

export function FocusMode({ node, onExit }: FocusModeProps) {
  const [activeNode, setActiveNode] = useState<FocusModeNode>(node)
  const [siblings, setSiblings] = useState<SiblingRow[]>([])
  // Phase 8.01.B T-6.2 — keep the full document node array so navigateSibling
  // can walk it for cross-parent wrap (advance from the last beat of a scene
  // to the first beat of the next scene, etc.). Sibling array stays filtered
  // by parent for the same-parent fast path.
  const [allNodes, setAllNodes] = useState<SiblingRow[]>([])
  // Phase 8.01.B T-1.2 — ancestor chain for the structured breadcrumb.
  // Root-first order, EXCLUDING the active node (the active node renders
  // as the last segment with its leaf name available for hover-reveal).
  const [ancestors, setAncestors] = useState<FocusBreadcrumbSegment[]>([])
  const [proseFading, setProseFading] = useState(false)
  // Phase 8.8 — shared toggles via useProseSettings. Focus Mode
  // defaults Typewriter ON (§6.4). Sentence Focus (§6.5) is consumed
  // inside ProseEditor itself (Phase 8.9) — FocusMode doesn't need
  // to read it here.
  const { typewriter: typewriterEnabled } =
    useProseSettings({ defaultTypewriter: true })
  const enteringRef = useRef(true)
  // Phase 8.01.B T-5 — swipe-tracking refs. Stored on a ref (not state)
  // so updating start coords doesn't trigger a re-render.
  const swipeStartRef = useRef<{ x: number; y: number; t: number; type: string } | null>(null)

  const prose = useEditorStore(s => s.prose)
  const setField = useEditorStore(s => s.setField)
  const lockedReason = useEditorStore(s => s.lockedReason)
  const flushPending = useEditorStore(s => s.flushPending)
  const loadNode = useEditorStore(s => s.loadNode)

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
      .then(async r => {
        if (!r.ok) {
          // F-248 (round-3 audit B3.6): pre-fix .then(r => r.json()) was
          // unconditional; on non-OK the body had no `nodes` key and
          // siblings became []. Sibling navigation silently did nothing.
          // Surface to dev console. Convention:
          // docs/architecture/error-handling-conventions.md.
          console.error('[FocusMode] siblings fetch non-OK', r.status)
          return null
        }
        return r.json()
      })
      .then(body => {
        if (cancelled || !body) return
        const all = (body.nodes ?? []) as Array<SiblingRow & { parent_id: string | null }>
        // Phase 8.01.B T-6.1: filter siblings to leaf-only ("navigation
        // never lands on a non-leaf" per Spec §6.1). Most V1 layer_stacks
        // have all-leaf children at a given parent so this is a no-op in
        // practice, but the filter is defensive against mixed-children
        // scenarios + Phase 14 layer_stack variations.
        const sibs = all
          .filter(r => r.parent_id === node.parent_id && r.is_leaf !== false)
          .sort((a, b) => a.order - b.order)
        setSiblings(sibs)
        // Phase 8.01.B T-6.2: keep full doc node array for cross-parent
        // wrap. Caching the full result avoids a second round-trip when
        // the wrap fires at a parent boundary.
        setAllNodes(all)
      })
      .catch(e => {
        // F-248: explicit silent catch. Surface.
        console.error('[FocusMode] siblings fetch failed', e)
      })
    return () => { cancelled = true }
  }, [node.document_id, node.parent_id])

  // Phase 8.01.B T-1.2 — fetch ancestor chain for the breadcrumb. Re-runs
  // when activeNode.id changes (sibling navigation always keeps the same
  // parent so ancestors don't change, but cross-parent wrap in T-6.2
  // will land here too).
  useEffect(() => {
    if (!activeNode.id) return
    let cancelled = false
    const supabase = createClient()
    getAncestorChain(supabase, activeNode.id)
      .then(chain => {
        if (cancelled) return
        setAncestors(chain)
      })
      .catch(e => {
        console.error('[FocusMode] ancestor fetch failed', e)
      })
    return () => { cancelled = true }
  }, [activeNode.id])

  const navigateSibling = useCallback(async (dir: -1 | 1) => {
    if (siblings.length === 0) return
    const idx = siblings.findIndex(s => s.id === activeNode.id)
    if (idx < 0) return

    // Phase 8.01.B T-6.2 — same-parent fast path; cross-parent wrap fallback
    // when the same-parent boundary is reached.
    let target: SiblingRow | undefined = siblings[idx + dir]
    if (!target && activeNode.parent_id) {
      target = findCrossParentLeaf(allNodes, activeNode.parent_id, dir)
    }
    // If still no target, we're at the document's first or last leaf — no-op
    // per T-6.3 stop-at-document-end guard.
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
      // Phase 8.01.B T-1: thread the new fields through so the breadcrumb
      // can render the leaf bracketed label without a second fetch.
      node_type: fetched.node_type,
      order: fetched.order,
      layer_index: fetched.layer_index,
    })

    // Briefly hold the fade-out, then fade in
    setTimeout(() => setProseFading(false), 150)
  }, [siblings, allNodes, activeNode.id, activeNode.parent_id, flushPending, loadNode])

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
        e.stopPropagation()
        void navigateSibling(-1)
        return
      }
      if (isMod && e.key === 'ArrowRight') {
        e.preventDefault()
        e.stopPropagation()
        void navigateSibling(1)
        return
      }
    }
    window.addEventListener('keydown', onKeydown, { capture: true })
    return () => window.removeEventListener('keydown', onKeydown, { capture: true } as EventListenerOptions)
  }, [navigateSibling, onExit])

  // Phase 8.01.B T-1.3 — compose the structured segment array. The leaf
  // segment carries the node name for the §6.2 hover/touch reveal; ancestor
  // segments are bare bracketed labels. If activeNode.node_type isn't a
  // known V1 layer kind, fall back to ancestors-only (avoids passing an
  // ill-shaped segment to LayerLabel; defensive against Phase 14 mismatch).
  const breadcrumbSegments: FocusBreadcrumbSegment[] = (() => {
    if (
      activeNode.node_type &&
      typeof activeNode.order === 'number' &&
      FOCUS_LAYER_KINDS.has(activeNode.node_type)
    ) {
      return [
        ...ancestors,
        {
          layer: activeNode.node_type as LayerKind,
          position: activeNode.order,
          name: activeNode.name ?? undefined,
        },
      ]
    }
    return ancestors
  })()

  // Phase 8.01.B T-1.4 — position counter for §6.2 hover/touch reveal.
  // 1-based for display per OQ-1 lock (recommendation accepted: "2 / 5").
  const breadcrumbPosition: { index: number; total: number } | undefined =
    (() => {
      if (siblings.length === 0) return undefined
      const idx = siblings.findIndex(s => s.id === activeNode.id)
      if (idx < 0) return undefined
      return { index: idx + 1, total: siblings.length }
    })()

  // Phase 8.01.B T-5 — swipe gesture handlers. Touch-only by gating in
  // classifySwipe. Text-selection guard prevents stealing from native
  // iPad selection inside the prose surface: any gesture starting inside
  // an editable element or an explicitly marked swipe-block ignores.
  const onSwipeDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== 'touch') {
      swipeStartRef.current = null
      return
    }
    const target = e.target as HTMLElement | null
    if (
      target &&
      target.closest('[contenteditable], textarea, input, [data-focus-swipe-block]')
    ) {
      swipeStartRef.current = null
      return
    }
    swipeStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      t: performance.now(),
      type: e.pointerType,
    }
  }, [])

  const onSwipeUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const start = swipeStartRef.current
    swipeStartRef.current = null
    if (!start) return
    const direction = classifySwipe({
      startX: start.x,
      startY: start.y,
      endX: e.clientX,
      endY: e.clientY,
      durationMs: performance.now() - start.t,
      pointerType: start.type,
    })
    if (direction === 'next') void navigateSibling(1)
    else if (direction === 'prev') void navigateSibling(-1)
  }, [navigateSibling])

  // Portal target. Mount on document.body during hydration only — SSR has no
  // body and we can't render a portal there. Returning null on the server is
  // safe: Focus Mode is exclusively a client interaction.
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPortalTarget(document.body)
  }, [])
  if (!portalTarget) return null

  // 🔒 createPortal to <body> per Component Spec v2.4 §6.1.
  // FocusMode is invoked as a child of NodeDetailPanel, which lives inside
  // AppShell's [data-shell="detail"]. The Focus-Mode entry transition sets
  // `opacity: 0` + `transform: translateX(100%)` on [data-shell="detail"];
  // CSS opacity and transform propagate to descendants, so a JSX-descendant
  // FocusMode would inherit them and become invisible. Portalling escapes
  // the AppShell's transformed subtree.
  return createPortal(
    <div
      data-testid="focus-mode"
      data-focus-mode="active"
      onPointerDown={onSwipeDown}
      onPointerUp={onSwipeUp}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        background: 'var(--color-bg-base)',  // 🔒 Inviolable #1 — bg-base only
        overflow: 'auto',
      }}
    >
      <FocusBreadcrumb segments={breadcrumbSegments} position={breadcrumbPosition} />

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

      {/* Phase 8.9 — SentenceFocus is now mounted inside ProseEditor
          itself (covers Edit Mode + Focus Mode with one source of
          truth). Removed from here to avoid duplicate mounts. */}

      {/* Phase 8.8 — ProseSettingsMenu in top-right corner. Fades like
          FocusBreadcrumb (0.35 idle / 1.0 hover/focus/open) per the
          wireframe. Defaults match Focus Mode behaviour. */}
      <div
        style={{
          position: 'absolute',
          top: 12,
          right: 12,
          zIndex: 10,
        }}
      >
        <ProseSettingsMenu
          variant="focus"
          defaults={{ defaultTypewriter: true, defaultSentenceFocus: false }}
        />
      </div>

      <FocusEscHint onExit={onExit} />
    </div>,
    portalTarget,
  )
}
