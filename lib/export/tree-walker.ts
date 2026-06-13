/**
 * Phase 7 — Tree walker. Walks a document's structural tree and emits
 * ContentBlock[] for renderers to consume.
 *
 * Walk semantics (per D11 + wireframe §02 callout 5):
 *   - Book root: skipped at output level (no heading emitted); its
 *     children are the top-level entries in the export
 *   - Act / Book intermediate layers: skipped headings by default
 *     (per D11 — "Chapter = Heading 1; Acts/Books skip"). The author
 *     can override per-node via export_heading_override or change
 *     the heading map via profile.config.layer_heading_map (V2 polish).
 *   - Chapter: emits a heading ContentBlock (level 1) with the
 *     chapter heading text per profile.config.chapter_heading
 *   - Scene: emits a scene-separator ContentBlock between siblings,
 *     then its prose paragraphs
 *   - Beat: emits prose paragraphs only (no heading); contributes to
 *     scene-level prose flow
 *
 * Per-node overrides (from Phase 1 columns) are always honoured:
 *   - export_include = false: skip node entirely (and its subtree)
 *   - export_heading_override: replace auto-derived heading text
 *   - export_page_break_before: emit a page_break block before
 *
 * The walker is format-agnostic. Renderers may choose to render some
 * block types as no-ops (e.g. JSON ignores scene_separator entirely
 * because it serializes structured data, not prose flow).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ContentBlock } from './types'

interface NodeRow {
  id: string
  parent_id: string | null
  node_type: string
  node_category: string
  layer_index: number | null
  depth: number | null
  order: number
  name: string | null
  short_description: string | null
  summary: unknown    // Tiptap JSON
  prose: unknown      // Tiptap JSON
  notes: unknown
  metadata: unknown
  status: string
  word_count_target: number | null
  export_include: boolean
  export_heading_override: string | null
  export_page_break_before: boolean
}

interface WalkOptions {
  scene_separator?: string    // e.g. "* * *"; pulled from profile config
  chapter_heading_style?: 'centred_numbered' | 'centred_split' | 'centred_name_only' | 'left_numbered' | 'plain'
  // DR-042 — when set (a Book node id), walk only that node's subtree
  // (the node itself + its descendants). NULL/undefined = whole document.
  // Used for per-book exports of a Series document.
  rootNodeId?: string | null
}

// Layers that emit a heading by default. Per D11, Chapter = Heading 1
// and layers above Chapter (Act, Book) skip. Scene and Beat are prose
// flow only; no heading.
const HEADING_NODE_TYPES = new Set(['chapter'])

export interface WalkResult {
  blocks: ContentBlock[]
  chapter_indices: number[]    // indices in `blocks` where chapter headings appear (for runner progress)
  total_chapters: number
  total_word_count: number
}

function extractText(tiptapJson: unknown): string {
  if (!tiptapJson) return ''
  if (typeof tiptapJson === 'string') {
    // Old rows pre-JSONB might still be strings; try to parse.
    try {
      return extractText(JSON.parse(tiptapJson))
    } catch {
      return tiptapJson
    }
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

function extractParagraphs(tiptapJson: unknown): string[] {
  if (!tiptapJson) return []
  if (typeof tiptapJson === 'string') {
    try {
      return extractParagraphs(JSON.parse(tiptapJson))
    } catch {
      return [tiptapJson]
    }
  }
  const node = tiptapJson as { content?: unknown[]; type?: string }
  if (!Array.isArray(node.content)) return []
  const out: string[] = []
  for (const child of node.content) {
    const c = child as { type?: string }
    if (c.type === 'paragraph') {
      const text = extractText(child).trim()
      if (text) out.push(text)
    } else if (Array.isArray((c as { content?: unknown[] }).content)) {
      out.push(...extractParagraphs(c))
    }
  }
  return out
}

function approxWordCount(tiptapJson: unknown): number {
  const text = extractText(tiptapJson)
  return text.trim().split(/\s+/).filter(Boolean).length
}

function chapterHeadingText(
  node: NodeRow,
  chapterNumber: number,
  style: WalkOptions['chapter_heading_style'] = 'centred_numbered',
): string {
  if (node.export_heading_override) return node.export_heading_override
  const name = node.name ?? `Chapter ${chapterNumber}`
  switch (style) {
    case 'centred_split':
    case 'centred_numbered':
    case 'left_numbered':
      return `Chapter ${chapterNumber}: ${name}`
    case 'centred_name_only':
      return name
    case 'plain':
    default:
      return name
  }
}

export async function walkDocument(
  supabase: SupabaseClient,
  documentId: string,
  options: WalkOptions = {},
): Promise<WalkResult> {
  // Load all structural nodes for the document, ordered by ordinal_path
  // (the canonical-order view from M-047). This gives us depth-first
  // traversal order across parents.
  const { data: rows, error } = await supabase
    .from('nodes_canonical')
    .select(
      `id, parent_id, node_type, node_category, layer_index, depth, "order",
       name, short_description, summary, prose, notes, metadata, status,
       word_count_target, export_include, export_heading_override,
       export_page_break_before`,
    )
    .eq('document_id', documentId)
    .eq('node_category', 'structural')
    .order('ordinal_path')

  if (error) throw new Error(`walkDocument: ${error.message}`)
  if (!rows) return { blocks: [], chapter_indices: [], total_chapters: 0, total_word_count: 0 }

  const blocks: ContentBlock[] = []
  const chapter_indices: number[] = []
  let chapterCount = 0
  let totalWords = 0

  // Skipped-subtree tracking: when a node has export_include=false,
  // we skip it AND its descendants. Track ids of skipped nodes; a
  // descendant whose ancestor chain contains a skipped id is skipped.
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

  // DR-042 — subtree scoping. A node is in scope when rootNodeId is unset
  // (whole document) OR the node IS rootNodeId OR rootNodeId is one of its
  // ancestors. Nodes outside the subtree are skipped without emitting.
  const rootNodeId = options.rootNodeId ?? null
  function inSubtree(id: string): boolean {
    if (!rootNodeId) return true
    let current: string | null = id
    while (current) {
      if (current === rootNodeId) return true
      current = idToParent.get(current) ?? null
    }
    return false
  }

  // Track last scene to insert scene_separator between siblings
  let lastSceneParent: string | null = null

  for (const node of (rows as unknown as NodeRow[])) {
    if (!inSubtree(node.id)) continue
    if (!node.export_include || ancestorSkipped(node.parent_id)) {
      skippedIds.add(node.id)
      continue
    }

    // Page break (Phase 1 author override)
    if (node.export_page_break_before) {
      blocks.push({ type: 'page_break', nodeId: node.id })
    }

    // Heading? Only for layer types in the heading set (default: chapter).
    const isHeadingNode = HEADING_NODE_TYPES.has(node.node_type)
    if (isHeadingNode) {
      chapterCount += 1
      chapter_indices.push(blocks.length)
      blocks.push({
        type: 'heading',
        level: 1,
        text: chapterHeadingText(node, chapterCount, options.chapter_heading_style),
        nodeId: node.id,
        nodeType: node.node_type,
      })
      // reset scene tracking — new chapter
      lastSceneParent = null
    }

    // Prose only — emit paragraphs from node.prose. Planning-level
    // summaries on Book / Act / Chapter (the structural overview layers)
    // are NEVER part of the manuscript output; they are author notes.
    // This matches the user's expectation: a DOCX/EPUB export is the
    // finished prose, not planning intent.
    //
    // Earlier V1 versions emitted summary-as-italic for any non-heading
    // node without prose (Book/Act summaries leaking into the front of
    // the manuscript). Discovered 2026-05-17 during pre-Phase-8 test
    // pass: the book's summary appeared italicised before Chapter 1
    // even though the Book has no prose. Removed.
    const proseParagraphs = extractParagraphs(node.prose)

    if (proseParagraphs.length > 0) {
      // Scene separator between sibling scenes (only when within a
      // chapter and consecutive scenes with prose appear).
      if (node.node_type === 'scene' && lastSceneParent !== null && lastSceneParent === node.parent_id) {
        blocks.push({
          type: 'scene_separator',
          text: options.scene_separator ?? '* * *',
          nodeId: node.id,
        })
      }
      if (node.node_type === 'scene') {
        lastSceneParent = node.parent_id
      }
      for (const para of proseParagraphs) {
        blocks.push({
          type: 'paragraph',
          text: para,
          nodeId: node.id,
          nodeType: node.node_type,
          formatting: { indent: true },
        })
        totalWords += para.trim().split(/\s+/).filter(Boolean).length
      }
    }
    // approxWordCount() helper retained for future summary-based features
    // (e.g. a profile-opt-in "include planning notes" flag). Mark it
    // referenced to silence the unused-import gate.
    void approxWordCount
  }

  return {
    blocks,
    chapter_indices,
    total_chapters: chapterCount,
    total_word_count: totalWords,
  }
}
