'use client'

// Phase 8.01.F T-7 — Director slide-over wrapper.
//
// Per OQ-4 lock, at iPad portrait Director Mode the spec calls for a
// 100px detail summary strip on top + Director full-width below. For V1
// 8.01.F, this wrapper provides the slide-over infrastructure; the
// in-document mount of DirectorPanel (via the right-slot mechanism)
// stays unchanged. Document-page-side integration of the slide-over is
// deferred to Phase 8.x polish.
//
// Surface ships as part of the slide-over infrastructure so future polish
// can route the right-slot content here when the active breakpoint is
// tablet-portrait.

import { SlideOver } from './SlideOver'
import { setDirectorSlideOverOpen, useDirectorSlideOverOpen } from '@/lib/stores/slide-over-state'
import type { ReactNode } from 'react'

interface DirectorSlideOverProps {
  children: ReactNode
}

export function DirectorSlideOver({ children }: DirectorSlideOverProps) {
  const open = useDirectorSlideOverOpen()
  return (
    <SlideOver
      open={open}
      onClose={() => setDirectorSlideOverOpen(false)}
      edge="right"
      width={440}
      ariaLabel="Director panel"
      testId="director-slide-over"
    >
      {children}
    </SlideOver>
  )
}
