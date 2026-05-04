'use client'

// Spec: stelavox_phase4_test_plan_v1_0.md TC-U-08, TC-U-13..16, TC-V-04
//       stelavox_phase4_build_checklist_v1_0.md §3.6 T-6.2
//
// Container for the detail panel's Context tab. Routes to:
//   - ContextLinker on a structural node (direct + inherited links)
//   - BackLinksList on a context node (incoming links — read-only)

import { ContextLinker } from './ContextLinker'
import { BackLinksList } from './BackLinksList'

interface Props {
  nodeId:        string
  nodeCategory:  'structural' | 'context'
  projectId:     string
  documentId:    string | null
}

export function ContextTab({ nodeId, nodeCategory, projectId, documentId }: Props) {
  if (nodeCategory === 'context') {
    return <BackLinksList nodeId={nodeId} />
  }
  return (
    <ContextLinker
      sourceNodeId={nodeId}
      projectId={projectId}
      documentId={documentId}
    />
  )
}
