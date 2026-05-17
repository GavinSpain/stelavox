/**
 * Phase 7.B — JSON export renderer.
 *
 * Pure-JSON backup format per D9. Single-doc scope. Full version
 * history. No attachments. No zip wrapper. Format version "1.0"
 * (lock-in for V1; V2 import path will version-handle).
 *
 * Output shape (TA §9.6 + Phase 7 JSON deep-dive):
 *
 *   {
 *     "stelavox_backup": { version, created_at, organisation_id,
 *                           document_id, document_name },
 *     "document": { ...documents row... },
 *     "layer_stack": { ...layer_stacks row... },
 *     "nodes": [ ...all structural + context nodes for the document... ],
 *     "node_versions": [ ...all historical versions of any node... ],
 *     "context_nodes_referenced": [ ...deduplicated... ],
 *     "context_links": [ ...node_context_links for this document's nodes... ],
 *     "node_comments": [ ...all comments on doc nodes... ],
 *     "node_author_locks": [ ...Author Lock rows for this doc... ]
 *   }
 *
 * Excluded by design (per Phase 7 JSON deep-dive):
 *   - agent_jobs / director_iterations / scheduler state (execution
 *     telemetry, not document state)
 *   - conversation_messages / Director conversations (author can clear)
 *   - briefs / brief_stages / brief_amendments (operation plans, not doc)
 *   - active node_locks (Edit Sessions — ephemeral)
 *   - attachments + attachments_manifest (D9 — no attachments in v1.0)
 *   - Stelavox-internal state: keys, RLS state, BYOK keys, etc.
 *
 * The renderer emits a single progress event covering the whole walk
 * (JSON renders ~50,000 words/sec; per-chapter granularity isn't
 * meaningful).
 */

import type { SupabaseClient } from '@supabase/supabase-js'

const BACKUP_FORMAT_VERSION = '1.0'

export async function renderJson(
  supabase: SupabaseClient,
  documentId: string,
  onChapterRendered: (chapterName: string | null) => Promise<void>,
): Promise<string> {
  // Pull document-scoped data in parallel for speed.
  const [
    docResult,
    nodesResult,
  ] = await Promise.all([
    supabase.from('documents').select('*').eq('id', documentId).maybeSingle(),
    supabase.from('nodes').select('*').eq('document_id', documentId),
  ])

  if (docResult.error || !docResult.data) {
    throw new Error(`renderJson: document_not_found (${docResult.error?.message ?? 'no data'})`)
  }
  const doc = docResult.data as Record<string, unknown>
  const nodes = (nodesResult.data ?? []) as Record<string, unknown>[]
  const nodeIds = nodes.map(n => n.id as string)

  // Layer stack
  const stackId = doc.layer_stack_id as string | null
  let layerStack: Record<string, unknown> | null = null
  if (stackId) {
    const { data } = await supabase
      .from('layer_stacks')
      .select('*')
      .eq('id', stackId)
      .maybeSingle()
    layerStack = data as Record<string, unknown> | null
  }

  // Versions / links / comments / locks — filtered by node ids
  let nodeVersions: Record<string, unknown>[] = []
  let contextLinks: Record<string, unknown>[] = []
  let nodeComments: Record<string, unknown>[] = []
  let nodeAuthorLocks: Record<string, unknown>[] = []

  if (nodeIds.length > 0) {
    const [versionsResult, linksResult, commentsResult, locksResult] = await Promise.all([
      supabase.from('node_versions').select('*').in('node_id', nodeIds)
        .order('node_id').order('version'),
      supabase.from('node_context_links').select('*').in('source_node_id', nodeIds),
      supabase.from('node_comments').select('*').in('node_id', nodeIds),
      supabase.from('node_author_locks').select('*').in('node_id', nodeIds),
    ])
    nodeVersions = (versionsResult.data ?? []) as Record<string, unknown>[]
    contextLinks = (linksResult.data ?? []) as Record<string, unknown>[]
    nodeComments = (commentsResult.data ?? []) as Record<string, unknown>[]
    nodeAuthorLocks = (locksResult.data ?? []) as Record<string, unknown>[]
  }

  // Context nodes referenced by any node in this document. Deduplicated.
  const linkedContextNodeIds = Array.from(
    new Set(contextLinks.map(l => l.target_node_id as string)),
  )
  let contextNodesReferenced: Record<string, unknown>[] = []
  if (linkedContextNodeIds.length > 0) {
    const { data } = await supabase
      .from('nodes')
      .select('*')
      .in('id', linkedContextNodeIds)
    contextNodesReferenced = (data ?? []) as Record<string, unknown>[]
  }

  await onChapterRendered('Serializing document...')

  const payload = {
    stelavox_backup: {
      version: BACKUP_FORMAT_VERSION,
      created_at: new Date().toISOString(),
      organisation_id: doc.organisation_id,
      document_id: doc.id,
      document_name: doc.name,
    },
    document: doc,
    layer_stack: layerStack,
    nodes,
    node_versions: nodeVersions,
    context_nodes_referenced: contextNodesReferenced,
    context_links: contextLinks,
    node_comments: nodeComments,
    node_author_locks: nodeAuthorLocks,
  }

  return JSON.stringify(payload, null, 2)
}
