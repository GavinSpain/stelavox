/**
 * Phase 7.C — Outline (Markdown) renderer.
 *
 * Renders a structural summary of the document as Markdown per D10/D11.
 *
 * 2026-06-07 update — line prefix changed from Markdown headings
 * (`###`) to the universal bracketed-monospace layer label format used
 * everywhere else in the app: `[Series]`, `[Book N]`, `[Act N]`,
 * `[Ch N]`, `[Sc N]`, `[Bt N]`. The bracket label is the structural
 * marker; hierarchy is conveyed by abbreviation + position numbering,
 * not by indentation or heading depth. Document title remains the only
 * `#`-heading at the top of the file.
 *
 * Configurable per OutlineProfileConfig:
 *   - max_depth: null (unlimited) | number (depth cap)
 *   - include_word_count_target: appends "[target: N words]"
 *   - include_status: inserts "[✓]" for approved, "[ ]" for draft
 *
 * Always excluded: prose, notes, context links, comments, metadata,
 * agent_instruction.
 * Empty-summary nodes: label only, no blockquote.
 * Empty-name AND empty-summary: skip entirely.
 *
 * Outline uses its own tree walk (not the ContentBlock[] from the
 * shared tree-walker.ts) because it surfaces structural metadata
 * (status, word_count_target) that ContentBlock doesn't carry, and it
 * renders ALL layers — different from DOCX/EPUB which collapse non-
 * Chapter layers per D11.
 */

import type { ContentBlock, OutlineProfileConfig } from './types'
import { createServiceRoleClient } from '@/lib/supabase/service'

/**
 * Layer abbreviation map — server-side copy of components/tree/LayerLabel.tsx
 * LAYER_ABBR. Kept in sync manually until Phase 14 extracts the layer
 * vocabulary into a shared module (`layer_stacks.layers[i].abbreviation`).
 * Inlined here to avoid importing a `'use client'` module from server code.
 */
const LAYER_ABBR: Record<string, string> = {
  series:  'Series',
  book:    'Book',
  act:     'Act',
  chapter: 'Ch',
  scene:   'Sc',
  beat:    'Bt',
}

/** Build the bracketed structural label for one node, e.g. `[Ch 1]`.
 *  Series omits the position (one series per document by convention).
 *  Returns null for unknown node_types so the caller can fall back. */
function buildLayerLabel(nodeType: string, position: number): string | null {
  const abbr = LAYER_ABBR[nodeType]
  if (!abbr) return null
  if (nodeType === 'series') return `[${abbr}]`
  return `[${abbr} ${position}]`
}

interface WalkContext {
  blocks: ContentBlock[]
  chapter_indices: number[]
  total_chapters: number
  total_word_count: number
}

interface NodeRow {
  id: string
  parent_id: string | null
  node_type: string
  layer_index: number | null
  depth: number | null
  order: number
  name: string | null
  summary: unknown
  status: string
  word_count_target: number | null
  export_include: boolean
}

function extractText(tiptapJson: unknown): string {
  if (!tiptapJson) return ''
  if (typeof tiptapJson === 'string') {
    try { return extractText(JSON.parse(tiptapJson)) } catch { return tiptapJson }
  }
  const node = tiptapJson as { content?: unknown[]; text?: string; type?: string }
  if (typeof node.text === 'string') return node.text
  const parts: string[] = []
  if (Array.isArray(node.content)) {
    for (const c of node.content) parts.push(extractText(c))
    if (node.type === 'paragraph') return parts.join('') + '\n'
  }
  return parts.join('')
}

export async function renderOutline(
  _blocks: ContentBlock[],
  walked: WalkContext,
  config: OutlineProfileConfig,
  onChapterRendered: (chapterName: string | null) => Promise<void>,
): Promise<string> {
  const svc = createServiceRoleClient()

  const firstNodeId = walked.blocks.find(b => b.nodeId)?.nodeId
  if (!firstNodeId) {
    await onChapterRendered(null)
    return '# (empty document)\n'
  }

  const { data: anyNode } = await svc
    .from('nodes').select('document_id').eq('id', firstNodeId).maybeSingle()
  const documentId = anyNode?.document_id as string | undefined
  if (!documentId) {
    await onChapterRendered(null)
    return '# (document not found)\n'
  }

  const { data: docRow } = await svc
    .from('documents').select('name').eq('id', documentId).maybeSingle()

  const { data: rows, error } = await svc
    .from('nodes_canonical')
    .select(
      `id, parent_id, node_type, layer_index, depth, "order", name, summary,
       status, word_count_target, export_include`,
    )
    .eq('document_id', documentId)
    .eq('node_category', 'structural')
    .order('ordinal_path')

  if (error) throw new Error(`renderOutline: ${error.message}`)
  if (!rows) {
    await onChapterRendered(null)
    return '# (empty document)\n'
  }

  const maxDepth = config.max_depth ?? null
  const includeWordCount = config.include_word_count_target ?? false
  const includeStatus = config.include_status ?? false

  const lines: string[] = []
  if (docRow?.name) {
    lines.push(`# ${docRow.name}`)
    lines.push('')
  }

  const skippedIds = new Set<string>()
  const idToParent = new Map<string, string | null>()
  for (const r of rows as unknown as NodeRow[]) idToParent.set(r.id, r.parent_id)

  function ancestorSkipped(id: string | null): boolean {
    let current = id
    while (current) {
      if (skippedIds.has(current)) return true
      current = idToParent.get(current) ?? null
    }
    return false
  }

  for (const node of rows as unknown as NodeRow[]) {
    if (!node.export_include || ancestorSkipped(node.parent_id)) {
      skippedIds.add(node.id)
      continue
    }

    // Skip the root (document title already rendered)
    if (node.parent_id === null) continue

    // max_depth is measured from the document's first structural layer.
    // node.depth is 1-based for the first structural layer under the
    // root, so `depth > maxDepth` is the cap.
    const depth = node.depth ?? 0
    if (maxDepth !== null && depth > maxDepth) continue

    const name = (node.name ?? '').trim()
    const summaryText = extractText(node.summary).trim()

    // Skip nodes with no name AND no summary
    if (!name && !summaryText) continue

    // 2026-06-07 — bracket label replaces the former `###` heading prefix.
    // Hierarchy is carried by the abbreviation + position number, not
    // indentation. Document title stays the only `#` heading.
    const label = buildLayerLabel(node.node_type, node.order)
    let headingLine = label ? `${label} ` : ''

    if (includeStatus) {
      headingLine += node.status === 'approved' ? '[✓] ' : '[ ] '
    }

    headingLine += name || '(untitled)'

    if (includeWordCount && node.word_count_target != null) {
      headingLine += `  *[target: ${node.word_count_target.toLocaleString()} words]*`
    }

    lines.push(headingLine)
    lines.push('')

    if (summaryText) {
      const summaryLines = summaryText.split('\n').filter(l => l.trim().length > 0)
      for (const l of summaryLines) lines.push(`> ${l.trim()}`)
      lines.push('')
    }

    if (node.node_type === 'chapter') {
      await onChapterRendered(name || 'Chapter')
    }
  }

  return lines.join('\n')
}
