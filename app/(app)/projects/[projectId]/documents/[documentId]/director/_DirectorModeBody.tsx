'use client'

// Phase 8 nav refactor — Director mode body.
//
// Mounts DirectorPanel in the right slot. Reads document state from
// DocumentContext. DirectorPanel's "Close" affordance navigates back
// to /edit via Next.js router.

import { useEffect } from 'react'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'

import { useRightSlot } from '@/components/layout/AppShell'

import { useDocument } from '../_DocumentLayoutClient'

// Phase 8.5b B.7 — DirectorPanel dynamic-imported so the Director
// conversation thread + workflow card primitives stay out of any
// bundle that doesn't actually mount Director mode. `ssr: false`
// because the panel is interactive-only and there's no SSR-relevant
// content to pre-render (the conversation hydrates from
// /api/documents/[id]/conversation on mount).
const DirectorPanel = dynamic(
  () => import('@/components/director/DirectorPanel').then((m) => m.DirectorPanel),
  { ssr: false },
)

const DIRECTOR_MIN_WIDTH = 400 // Component Spec §7.1

export function DirectorModeBody() {
  const { projectId, documentId, documentName, profileId } = useDocument()
  const { setContent, setMinWidthOverride } = useRightSlot()
  const router = useRouter()

  useEffect(() => {
    setMinWidthOverride(DIRECTOR_MIN_WIDTH)
    setContent(
      <DirectorPanel
        documentId={documentId}
        documentName={documentName}
        profileId={profileId}
        onClose={() => router.push(`/projects/${projectId}/documents/${documentId}`)}
      />,
    )
    return () => {
      setContent(null)
      setMinWidthOverride(null)
    }
  }, [
    projectId,
    documentId,
    documentName,
    profileId,
    setContent,
    setMinWidthOverride,
    router,
  ])

  return null
}
