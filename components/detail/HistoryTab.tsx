'use client'

// Spec: stelavox_phase3_build_checklist_v1_0.md §3.5 T-5.3

import { VersionHistory } from './VersionHistory'

export function HistoryTab({ nodeId }: { nodeId: string }) {
  return <VersionHistory nodeId={nodeId} />
}
