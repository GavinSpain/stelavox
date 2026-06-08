import { notFound } from 'next/navigation'
import { dehydrate, HydrationBoundary, QueryClient } from '@tanstack/react-query'

import { createClient } from '@/lib/supabase/server'
import { documentKeys } from '@/lib/queries/keys'
import { getDocumentNodesProjected } from '@/lib/queries/documentNodesPrefetch'
import { DocumentClient } from './_DocumentClient'

interface Props {
  params: Promise<{ projectId: string; documentId: string }>
}

export default async function DocumentPage({ params }: Props) {
  const { projectId, documentId } = await params
  const supabase = await createClient()

  const { data: document } = await supabase
    .from('documents')
    .select('id, name, description, document_type, status, created_at, updated_at, profile_id')
    .eq('id', documentId)
    .maybeSingle()

  if (!document) notFound()

  // Project name for the Sidebar PROJECT slot. Tiny extra read; the
  // server-render path already has a Supabase client open.
  const { data: project } = await supabase
    .from('projects')
    .select('name')
    .eq('id', projectId)
    .maybeSingle()

  // Round-3 follow-up — `documents.updated_at` is never bumped when
  // nodes change (no application-level trigger), so the title-strip
  // "last edit X ago" label reads stale (it just shows the document's
  // creation time). Compute an effective last-edit on the read side:
  // max(documents.updated_at, MAX(nodes.updated_at)) across the
  // document's structural nodes. Single PostgREST call ordering by
  // updated_at DESC — cheap given the document_id index.
  const { data: newestNode } = await supabase
    .from('nodes')
    .select('updated_at')
    .eq('document_id', documentId)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle<{ updated_at: string | null }>()
  const docUpdated = document.updated_at ?? null
  const nodeUpdated = newestNode?.updated_at ?? null
  const effectiveUpdatedAt =
    docUpdated && nodeUpdated
      ? docUpdated > nodeUpdated
        ? docUpdated
        : nodeUpdated
      : docUpdated ?? nodeUpdated ?? null

  // Phase 8.5b B.4 — RSC initial seed. Prefetch the document's
  // structural nodes into a per-request QueryClient and dehydrate it
  // into a HydrationBoundary so the client tree component reads from
  // the cache on first paint. Eliminates the cold-load round-trip
  // measured in the Phase 8.5 baseline (J2 ~2 s of /api/.../nodes
  // server time on the mega-doc); B.2's projection already cut the
  // payload, B.3 cached it client-side, B.4 closes the loop by
  // serving the first paint from the server-rendered HTML.
  //
  // Per Tier-A §3.6.2: prefetch reads via getDocumentNodesProjected()
  // (the shared helper the API route also uses) — NOT via internal
  // fetch of own API. That avoids the fetch-self anti-pattern + double
  // round-trip; the projection logic is identical between paths
  // because both call the same helper.
  //
  // The QueryClient is per-request — never a module-level singleton on
  // the server (Tier-A §3.6.1) — so per-user/RLS state doesn't leak.
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: 60_000 } },
  })
  try {
    await queryClient.prefetchQuery({
      queryKey: documentKeys.nodes(documentId),
      queryFn: () => getDocumentNodesProjected(supabase, documentId),
    })
  } catch {
    // Prefetch failure is non-fatal — the client will fall back to a
    // normal useDocumentNodes fetch on mount. We don't want a single
    // RPC blip to 500 the page.
  }

  // Phase 8.01 wireframe-alignment round 3: the ProjectProfileViewer
  // strip that previously sat above the tree is removed — the
  // wireframe Edit Mode (`02_edit_mode_v2_iter3.html`) doesn't show a
  // Profile strip in the tree pane; Profile content is reachable via
  // the Director panel. Removing the server-side getProjectProfile
  // round-trip too since nothing on this page renders it now.
  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        <DocumentClient
          projectId={projectId}
          documentId={documentId}
          documentName={document.name}
          documentType={document.document_type as 'novel' | 'short_story' | 'series'}
          documentUpdatedAt={effectiveUpdatedAt}
          profileId={document.profile_id}
          projectName={project?.name ?? null}
        />
      </div>
    </HydrationBoundary>
  )
}
