'use client'

// Phase 8 nav refactor — Scheduler mode body.
//
// Mounts SchedulerPanel in the right slot. Reads document state from
// DocumentContext.

import { useEffect } from 'react'

import { SchedulerPanel } from '@/components/scheduler/SchedulerPanel'
import { useRightSlot } from '@/components/layout/AppShell'

import { useDocument } from '../_DocumentLayoutClient'

export function SchedulerModeBody() {
  const { projectId, documentId, documentName } = useDocument()
  const { setContent, setMinWidthOverride } = useRightSlot()

  useEffect(() => {
    setMinWidthOverride(null)
    setContent(
      <SchedulerPanel
        projectId={projectId}
        documentId={documentId}
        documentName={documentName}
      />,
    )
    return () => {
      setContent(null)
    }
  }, [projectId, documentId, documentName, setContent, setMinWidthOverride])

  return null
}
