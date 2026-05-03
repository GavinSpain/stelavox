'use client'

// Spec: stelavox_component_specification_v2_0.md §2.4 (PanelResizer)
//       stelavox_brand_identity_v2_0.md §12 Inviolable #2 (verdigris)
//       wireframes/stelavox_wireframe_errata_v1_0.md (PanelResizer dragging
//                                                     colour correction)
//       stelavox_phase2_build_checklist_v1_0.md v1.1 §3.2 T-2.4
//
// 4px vertical drag handle that resizes an adjacent panel. Pure controlled
// component — AppShell holds the width state and is responsible for
// localStorage persistence; PanelResizer only emits new values via
// onChange. Two instances are mounted in AppShell:
//   - position="sidebar-tree" sits between Sidebar (left, controlled) and
//     the centre tree slot. Dragging right grows the sidebar.
//   - position="tree-detail"  sits between the centre tree slot and the
//     DetailPanel (right, controlled). Dragging left grows the detail panel.
//
// Constraints (per Component Spec §2.4) are passed in by AppShell via the
// min/max props: Sidebar [220, 340], DetailPanel [320, 540]. The centre
// tree's min-width: 320 is enforced as a flex constraint, not by this
// resizer.
//
// Inviolable #2 audit: this is NOT verdigris use #9. The dragging colour
// is `--color-border-strong`, NOT `--color-accent`. The Wireframe Errata
// explicitly corrects this — earlier docs that said `--color-accent` here
// were wrong. `--color-accent` MUST NOT appear in this file.

import { useState } from 'react'

interface PanelResizerProps {
  position: 'sidebar-tree' | 'tree-detail'
  value: number
  onChange: (width: number) => void
  min: number
  max: number
}

export function PanelResizer({ position, value, onChange, min, max }: PanelResizerProps) {
  const [hovered, setHovered] = useState(false)
  const [dragging, setDragging] = useState(false)

  function handleMouseDown(e: React.MouseEvent) {
    e.preventDefault()
    const startX = e.clientX
    const startValue = value
    setDragging(true)

    // Lock cursor across the whole page while dragging — the handle is
    // only 4px wide so the pointer routinely leaves it during a drag.
    // Also suppress text selection in adjacent panels.
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    function onMouseMove(ev: MouseEvent) {
      const delta = ev.clientX - startX
      // sidebar-tree: drag right grows the sidebar.
      // tree-detail:  drag left grows the detail panel.
      const candidate =
        position === 'sidebar-tree' ? startValue + delta : startValue - delta
      onChange(Math.max(min, Math.min(max, candidate)))
    }

    function onMouseUp() {
      setDragging(false)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }

  const background = dragging
    ? 'var(--color-border-strong)'
    : hovered
    ? 'var(--color-border-default)'
    : 'transparent'

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      onMouseDown={handleMouseDown}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: '4px',
        flexShrink: 0,
        cursor: 'col-resize',
        background,
        transition: 'background var(--duration-fast)',
      }}
    />
  )
}
