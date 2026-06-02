'use client'

// Phase 8.01.F T-6 — Tree slide-over wrapper.
//
// Wraps the Sidebar component inside a generic SlideOver. Reads the
// open state from the slide-over store; calls the close setter from
// onClose. Only mounted when the active breakpoint is tablet-portrait
// (gated by AppShell).
//
// V1 scope: this wraps the AppShell project Sidebar (LIBRARY / CONTEXT
// / SYSTEM rows). The DocumentClient-level NodeTree slide-over (per the
// iPad wireframe) is deferred to Phase 8.x polish — needs page-level
// changes outside AppShell.

import { Sidebar } from './Sidebar'
import { SlideOver } from './SlideOver'
import { setTreeSlideOverOpen, useTreeSlideOverOpen } from '@/lib/stores/slide-over-state'

interface TreeSlideOverProps {
  /** Sidebar width to render inside the slide-over body. */
  sidebarWidth: number
}

export function TreeSlideOver({ sidebarWidth }: TreeSlideOverProps) {
  const open = useTreeSlideOverOpen()
  return (
    <SlideOver
      open={open}
      onClose={() => setTreeSlideOverOpen(false)}
      edge="left"
      width={Math.max(280, Math.min(360, sidebarWidth))}
      ariaLabel="Project navigation"
      testId="tree-slide-over"
    >
      <Sidebar width={sidebarWidth} />
    </SlideOver>
  )
}
