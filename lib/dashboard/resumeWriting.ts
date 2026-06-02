// Phase 8.01.D T-1 — Resume Writing data helper.
//
// Finds the leaf node most recently edited across the user's org that
// has non-empty prose, walks its ancestor chain (via the 8.01.B helper),
// extracts a plain-text prose excerpt, and returns the payload the
// ResumeWritingHero needs.
//
// Spec: Phase 8.01.D build checklist v1.0 — T-1, T-2.
//       Component Spec v2.21 §18.4 Dashboard populated shape.
//
// Returns null when no leaf with prose exists (first-time path —
// dashboard branches to the empty shape).

import type { SupabaseClient } from '@supabase/supabase-js'

import { getAncestorChain } from '@/lib/nodes/getAncestorChain'
import type { FocusBreadcrumbSegment } from '@/components/focus/FocusBreadcrumb'
import { extractPlainText } from '@/lib/llm/tiptap-text'

export interface ResumeWritingTarget {
  documentId: string
  documentName: string
  projectId: string
  projectName: string
  nodeId: string
  nodeName: string | null
  /** Ancestor chain root→parent (excludes the leaf itself). */
  layerChain: FocusBreadcrumbSegment[]
  /** Leaf node's own layer + position; pairs with layerChain to form the full crumb. */
  leafLayer: FocusBreadcrumbSegment
  /** First ~320 chars of plain prose, suitable for Lora render in the hero. */
  proseExcerpt: string
  updatedAt: string
}

const EXCERPT_MAX_CHARS = 320

interface LeafRow {
  id: string
  name: string | null
  node_type: string
  order: number
  prose: unknown
  updated_at: string
  document_id: string
  project_id: string
}

interface DocumentRow {
  id: string
  name: string
  project_id: string
}

interface ProjectRow {
  id: string
  name: string
}

export async function getResumeWritingTarget(
  supabase: SupabaseClient,
  orgId: string,
): Promise<ResumeWritingTarget | null> {
  // Find the most recently updated leaf node with non-empty prose. We
  // can't filter on `prose IS NOT NULL AND prose <> '{}'` directly via
  // the Supabase JS API for JSONB, so we filter is_leaf + has prose at
  // the SQL level and post-filter empty-prose rows in TS.
  const { data: leafRows, error: leafErr } = await supabase
    .from('nodes')
    .select('id, name, node_type, "order", prose, updated_at, document_id, project_id')
    .eq('organisation_id', orgId)
    .eq('node_category', 'structural')
    .eq('is_leaf', true)
    .not('prose', 'is', null)
    .order('updated_at', { ascending: false })
    .limit(20)
    .returns<LeafRow[]>()
  if (leafErr || !leafRows || leafRows.length === 0) return null

  // Pick the first leaf with non-empty prose text.
  let chosen: LeafRow | null = null
  let chosenExcerpt = ''
  for (const row of leafRows) {
    const text = extractPlainText(row.prose as Parameters<typeof extractPlainText>[0]).trim()
    if (text.length === 0) continue
    chosen = row
    chosenExcerpt =
      text.length > EXCERPT_MAX_CHARS
        ? text.slice(0, EXCERPT_MAX_CHARS).trimEnd() + '…'
        : text
    break
  }
  if (!chosen) return null

  // Resolve document + project names.
  const { data: docRow } = await supabase
    .from('documents')
    .select('id, name, project_id')
    .eq('id', chosen.document_id)
    .maybeSingle<DocumentRow>()
  const { data: projectRow } = await supabase
    .from('projects')
    .select('id, name')
    .eq('id', chosen.project_id)
    .maybeSingle<ProjectRow>()
  if (!docRow || !projectRow) return null

  // Walk the ancestor chain for the bracketed crumb.
  const layerChain = await getAncestorChain(supabase, chosen.id)

  return {
    documentId: docRow.id,
    documentName: docRow.name,
    projectId: projectRow.id,
    projectName: projectRow.name,
    nodeId: chosen.id,
    nodeName: chosen.name,
    layerChain,
    leafLayer: {
      layer: chosen.node_type as FocusBreadcrumbSegment['layer'],
      position: chosen.order,
      name: chosen.name ?? undefined,
    },
    proseExcerpt: chosenExcerpt,
    updatedAt: chosen.updated_at,
  }
}
