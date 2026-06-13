/**
 * DR-042 — Markdown manuscript renderer.
 *
 * The always-available "own-your-data / walk-away" backstop: document
 * structure as Markdown headings (`#` document title, then `#`×(depth+1)
 * per structural layer) + each node's FINAL PROSE ONLY. No version
 * history, no internal ids, no summaries/notes/metadata. Plain text an
 * author can take to any other tool.
 *
 * Trivially small and effectively unbounded at realistic scale
 * (prose-only ≈ 6 bytes/word), so it never hits a size wall — which is
 * why it is the guaranteed escape hatch (register DR-042 v3.4).
 *
 * Like outline.ts, it does its own tree walk (not the shared
 * ContentBlock[]) because it emits ALL layers as headings, not just
 * Chapter. Respects export_include + the optional subtree scope
 * (rootNodeId) for symmetry with the rest of the pipeline.
 */

import type { ContentBlock, MarkdownProfileConfig } from './types'
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
  depth: number | null
  order: number
  name: string | null
  prose: unknown
  export_include: boolean
  export_page_break_before: boolean
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

/** Final-prose paragraphs for a node (no history, no marks beyond text). */
export function extractProseParagraphs(tiptapJson: unknown): string[] {
  if (!tiptapJson) return []
  if (typeof tiptapJson === 'string') {
    try { return extractProseParagraphs(JSON.parse(tiptapJson)) } catch { return [tiptapJson] }
  }
  const node = tiptapJson as { content?: unknown[]; type?: string }
  if (!Array.isArray(node.content)) return []
  const out: string[] = []
  for (const child of node.content) {
    const c = child as { type?: string; content?: unknown[] }
    if (c.type === 'paragraph') {
      const text = extractText(child).trim()
      if (text) out.push(text)
    } else if (Array.isArray(c.content)) {
      out.push(...extractProseParagraphs(c))
    }
  }
  return out
}

export async function renderMarkdown(
  walked: WalkContext,
  config: MarkdownProfileConfig,
  onChapterRendered: (chapterName: string | null) => Promise<void>,
  documentName: string,
  rootNodeId: string | null = null,
): Promise<string> {
  const svc = createServiceRoleClient()

  const firstNodeId = walked.blocks.find(b => b.nodeId)?.nodeId
  if (!firstNodeId) {
    await onChapterRendered(null)
    return `# ${documentName}\n\n_(empty document)_\n`
  }
  const { data: anyNode } = await svc
    .from('nodes').select('document_id').eq('id', firstNodeId).maybeSingle()
  const documentId = anyNode?.document_id as string | undefined
  if (!documentId) {
    await onChapterRendered(null)
    return `# ${documentName}\n\n_(document not found)_\n`
  }

  const { data: rows, error } = await svc
    .from('nodes_canonical')
    .select(`id, parent_id, node_type, depth, "order", name, prose,
             export_include, export_page_break_before`)
    .eq('document_id', documentId)
    .eq('node_category', 'structural')
    .order('ordinal_path')
  if (error) throw new Error(`renderMarkdown: ${error.message}`)
  if (!rows) {
    await onChapterRendered(null)
    return `# ${documentName}\n`
  }

  const cap = config.heading_depth_cap ?? 6
  const includeSceneHeadings = config.include_scene_headings ?? true

  const idToParent = new Map<string, string | null>()
  for (const r of rows as unknown as NodeRow[]) idToParent.set(r.id, r.parent_id)
  const skippedIds = new Set<string>()
  function ancestorSkipped(id: string | null): boolean {
    let current = id
    while (current) {
      if (skippedIds.has(current)) return true
      current = idToParent.get(current) ?? null
    }
    return false
  }
  function inSubtree(id: string): boolean {
    if (!rootNodeId) return true
    let current: string | null = id
    while (current) {
      if (current === rootNodeId) return true
      current = idToParent.get(current) ?? null
    }
    return false
  }

  const lines: string[] = [`# ${documentName}`, '']

  for (const node of rows as unknown as NodeRow[]) {
    if (!inSubtree(node.id)) continue
    if (!node.export_include || ancestorSkipped(node.parent_id)) {
      skippedIds.add(node.id)
      continue
    }
    if (node.parent_id === null) continue   // root — title already emitted

    const name = (node.name ?? '').trim()
    const isScene = node.node_type === 'scene'
    const isBeat = node.node_type === 'beat'

    // Heading: every named structural layer except beats (and scenes when
    // disabled). Beats are prose flow only. Depth+1 → markdown level,
    // capped. Document root is depth 0, so its children start at level 2.
    const emitHeading =
      name.length > 0 && !isBeat && (!isScene || includeSceneHeadings)
    if (emitHeading) {
      const level = Math.min((node.depth ?? 0) + 1, cap)
      lines.push(`${'#'.repeat(Math.max(level, 2))} ${name}`)
      lines.push('')
    }

    for (const para of extractProseParagraphs(node.prose)) {
      lines.push(para)
      lines.push('')
    }

    if (node.node_type === 'chapter') {
      await onChapterRendered(name || 'Chapter')
    }
  }

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n'
}
