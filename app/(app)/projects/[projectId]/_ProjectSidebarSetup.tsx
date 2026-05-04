'use client'

// Spec: stelavox_phase4_build_checklist_v1_0.md §3.4 T-4.3
//
// Tiny client component that activates the Sidebar's Phase 4 Context
// library on the project-list page. The project page itself is a
// server component (it loads the documents list); this component
// runs in the page's client boundary and just calls setProject(...)
// on mount and clears on unmount.
//
// Row clicks at the project level fall through (the project page has
// no detail-panel mechanism yet). The user can drill into a document
// for the full sidebar + detail-panel experience.

import { useEffect } from 'react'
import { useSidebarProject } from '@/components/layout/AppShell'

interface Props {
  projectId: string
}

export function ProjectSidebarSetup({ projectId }: Props) {
  const { setProject } = useSidebarProject()
  useEffect(() => {
    setProject({ projectId, documentId: null, onSelectContextNode: null })
    return () => {
      setProject({ projectId: null, documentId: null, onSelectContextNode: null })
    }
  }, [projectId, setProject])
  return null
}
