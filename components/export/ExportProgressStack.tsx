'use client'

/**
 * Phase 7.D — ExportProgressStack
 *
 * Bottom-right container that mounts ExportProgressChip for each
 * in-flight or recently-completed export the user can see. Multi-export
 * stacking per wireframe §05 callout 12.
 *
 * Mounts at AppShell level (similar pattern to V1.x-B.1.1
 * AppShellStatusIndicator); the chip subscribes to its own row via
 * Realtime.
 */

import { useState } from 'react'
import { useActiveExports } from '@/lib/hooks/useExportJobs'
import { ExportProgressChip } from './ExportProgressChip'

export function ExportProgressStack() {
  const jobs = useActiveExports()
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())

  const visible = jobs.filter(j => !dismissed.has(j.id))

  if (visible.length === 0) return null

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 20,
        right: 20,
        zIndex: 50,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-end',
      }}
      data-testid="export-progress-stack"
    >
      {visible.map(job => (
        <ExportProgressChip
          key={job.id}
          exportJobId={job.id}
          onDismiss={() => setDismissed(prev => new Set(prev).add(job.id))}
        />
      ))}
    </div>
  )
}
