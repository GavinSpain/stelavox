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
import { getMaxLayerIndexByDocument } from '@/lib/data/nodes'

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
  /** Used with the document's layer_stack to derive leaf-ness per H-15. */
  layer_index: number | null
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
  // H-15: leaf-ness is derived from the document's layer_stack
  // (layer_index === max), NOT stored as a column on the row. We pull a
  // wider candidate window of structural rows with non-null prose
  // ordered by updated_at, resolve max layer-index per document in one
  // round-trip, then pick the first row whose layer_index matches its
  // document's max AND whose prose extracts to non-empty text.
  //
  // Window size: 50 candidates is generous enough that any author with a
  // populated novel will surface their most-recent leaf even if the
  // top of the list happens to include non-leaf structural rows that
  // ended up with prose values (rare — prose typically lives on leaves
  // because synthesise targets leaves; expand on non-leaves doesn't
  // write prose at all). If 50 is exhausted we return null gracefully.
  const { data: leafRows, error: leafErr } = await supabase
    .from('nodes')
    .select('id, name, node_type, "order", prose, updated_at, document_id, project_id, layer_index')
    .eq('organisation_id', orgId)
    .eq('node_category', 'structural')
    .not('prose', 'is', null)
    .order('updated_at', { ascending: false })
    .limit(50)
    .returns<LeafRow[]>()
  if (leafErr || !leafRows || leafRows.length === 0) return null

  const docIds = Array.from(new Set(leafRows.map((r) => r.document_id)))
  const maxByDoc = await getMaxLayerIndexByDocument(supabase, docIds)

  // Pick the first row that (a) is a leaf in its document, (b) has
  // non-empty prose text.
  let chosen: LeafRow | null = null
  let chosenExcerpt = ''
  for (const row of leafRows) {
    const max = maxByDoc.get(row.document_id)
    if (max === undefined) continue
    if (row.layer_index !== max) continue
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
