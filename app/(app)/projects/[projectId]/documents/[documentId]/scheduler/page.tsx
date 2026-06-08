// Phase 8 nav refactor: Scheduler mode of the document layout.
// The chrome (tree + header + sidebar wiring) lives in the parent
// layout.tsx; this server-component shell just renders the client body.
//
// Pre-refactor, this route did its own document fetch and rendered
// SchedulerPanel as the full-page body. Now SchedulerPanel mounts as
// the right-slot content under the shared layout, peer to Edit's
// NodeDetailPanel and Director's DirectorPanel.

import { SchedulerModeBody } from './_SchedulerModeBody'

export default function SchedulerModePage() {
  return <SchedulerModeBody />
}
