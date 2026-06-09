// Phase 8 nav refactor: this route is now the Edit mode of the
// document layout. The chrome (auth, tree, header, sidebar wiring) lives
// in layout.tsx. This page is a thin server-component shell whose job
// is to render the client body marker.
//
// The shell does NOT do its own data fetching — layout.tsx already
// has all the document/project state and exposes it via DocumentContext.

import { EditModeBody } from './_EditModeBody'

export default function EditModePage() {
  return <EditModeBody />
}
