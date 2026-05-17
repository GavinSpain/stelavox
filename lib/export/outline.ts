/**
 * Phase 7.C — Outline (Markdown) renderer.
 *
 * Renders a structural summary of the document as Markdown per D10/D11.
 * Heading depth mirrors structural depth (Book = #, Act = ##,
 * Chapter = ###, Scene = ####, Beat = #####).
 *
 * Configurable per OutlineProfileConfig:
 *   - max_depth: null (unlimited) | number (depth cap)
 *   - include_word_count_target: appends "[target: N words]"
 *   - include_status: prefixes "[✓]" for approved, "[ ]" for draft
 *
 * Always excluded: prose, notes, context links, comments, metadata,
 * agent_instruction.
 * Empty-summary nodes: heading only, no blockquote.
 * Empty-name AND empty-summary: skip entirely.
 *
 * Outline uses its own tree walk (not the ContentBlock[] from the
 * shared tree-walker.ts) because it surfaces structural metadata
 * (depth, status, word_count_target) that ContentBlock doesn't carry,
 * and it renders ALL layers as headings — different from DOCX/EPUB
 * which collapse non-Chapter layers per D11.
 */

import type { ContentBlock, OutlineProfileConfig } from './types'
import { createServiceRoleClient } from '@/lib/supabase/service'

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

    // Outline heading depth = node.depth + 1 (document title is H1; first
    // structural layer below root is H2, etc.). max_depth caps from
    // the document's first structural layer.
    const headingLevel = (node.depth ?? 0) + 1

    if (maxDepth !== null && headingLevel > maxDepth + 1) continue

    const name = (node.name ?? '').trim()
    const summaryText = extractText(node.summary).trim()

    // Skip nodes with no name AND no summary
    if (!name && !summaryText) continue

    const hashes = '#'.repeat(Math.min(headingLevel, 6))
    let headingLine = `${hashes} `

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
