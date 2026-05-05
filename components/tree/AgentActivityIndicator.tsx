'use client'

/**
 * AgentActivityIndicator — overlays a running-job pulse on a NodeRow's icon.
 *
 * Source: stelavox_component_specification_v2_6.md §4.4
 *         stelavox_phase5_test_plan_v1_0.md TC-V-06, TC-M-01, TC-M-02
 * Build Checklist T-12.2.
 *
 * Renders nothing if the node has no pending|running job. When a job is
 * active, the parent type icon's opacity pulses 1 → 0.4 → 1 over 2s
 * ease-in-out, infinite. prefers-reduced-motion: static at 0.4.
 *
 * Per Component Spec §4.4: "the only animation that runs unsolicited in
 * the tree". Calm, not urgent.
 *
 * The component is intentionally a thin wrapper — it returns null when no
 * job is active, and a CSS-animated overlay when one is. The NodeRow
 * mounts it inside the type-icon container so the animation visually
 * targets the icon.
 */

import { useNodeHasRunningJob } from '@/lib/hooks/useAgentJobsRealtime'

interface Props {
  nodeId: string
}

export function AgentActivityIndicator({ nodeId }: Props) {
  const hasRunningJob = useNodeHasRunningJob(nodeId)
  if (!hasRunningJob) return null
  return (
    <span
      aria-hidden="true"
      className="agent-activity-pulse"
      style={{
        position: 'absolute',
        inset: 0,
        background: 'transparent',
        pointerEvents: 'none',
      }}
    />
  )
}
