// Phase 8 nav refactor: Director mode of the document layout.
// The chrome (tree + header + sidebar wiring) lives in the parent
// layout.tsx; this server-component shell just renders the client body.

import { DirectorModeBody } from './_DirectorModeBody'

export default function DirectorModePage() {
  return <DirectorModeBody />
}
