import { notFound } from 'next/navigation'
import { dehydrate, HydrationBoundary, QueryClient } from '@tanstack/react-query'

import { createClient } from '@/lib/supabase/server'
import { documentKeys } from '@/lib/queries/keys'
import { getDocumentNodesProjected } from '@/lib/queries/documentNodesPrefetch'

import { DocumentLayoutClient } from './_DocumentLayoutClient'

interface Props {
  params: Promise<{ projectId: string; documentId: string }>
  children: React.ReactNode
}

/**
 * Document layout — shared chrome for every mode.
 *
 * Phase 8 nav refactor: mode (Edit / Director / Scheduler) is now URL-
 * driven via sub-routes. This layout absorbs the auth + document/project
 * fetch + RSC prefetch that previously lived in page.tsx so the chrome
 * is mounted ONCE and survives mode-switch navigation (selectedNodeId,
 * tree scroll position, expanded nodes — all preserved by the layout's
 * stable identity).
 *
 * Sub-routes:
 *   /edit (or /) — Edit mode body
 *   /director    — Director mode body
 *   /scheduler   — Scheduler mode body
 */
export default async function DocumentLayout({ params, children }: Props) {
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
  // the cache on first paint.
  //
  // Per Tier-A §3.6.2: prefetch reads via getDocumentNodesProjected()
  // (the shared helper the API route also uses) — NOT via internal
  // fetch of own API.
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

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        <DocumentLayoutClient
          projectId={projectId}
          documentId={documentId}
          documentName={document.name}
          documentType={document.document_type as 'novel' | 'short_story' | 'series'}
          documentUpdatedAt={effectiveUpdatedAt}
          profileId={document.profile_id}
          projectName={project?.name ?? null}
        >
          {children}
        </DocumentLayoutClient>
      </div>
    </HydrationBoundary>
  )
}
