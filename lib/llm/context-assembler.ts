/**
 * Context assembler — produces an AssembledPrompt from a node + agent profile.
 *
 * Source: stelavox_technical_architecture_v1_8.md §6.2.
 *         stelavox_phase5_api_contract_v1_0.md v1.2 §2.11.
 * Build Checklist T-4.1.
 *
 * The assembler:
 *   1. Loads the target node, ancestor chain, linked context nodes
 *      (direct + ancestor-inherited per Phase 4 §3.5 logic), and
 *      unresolved comments — in parallel via Promise.all.
 *   2. Extracts plain text from Tiptap JSON fields (H-06).
 *   3. Scans every user-controlled string with scanContent() (TA §4.3).
 *      HIGH-severity matches throw — caught by the Edge Function which
 *      marks the job failed with error_message='injection_blocked'.
 *   4. XML-escapes every user value and wraps in <user_data> tags (TA §4.2).
 *   5. Splits content into a STABLE block (system prompt + ancestors +
 *      context nodes + style guide — byte-for-byte identical across
 *      sequential calls in a session, enabling Anthropic prompt caching
 *      per TA §7.3) and a DYNAMIC block (current node, agent_instruction,
 *      unresolved comments).
 *   6. Wraps with the security frame from TA §4.2.
 *   7. Returns the AssembledPrompt for the provider layer.
 *
 * The Edge Function writes the result to agent_jobs.context_snapshot
 * (JSONB) before invoking the provider — every AI-generated result is
 * permanently auditable to the exact context the model saw (TA §6.2 +
 * API Contract §2.11 invariant 8).
 */

import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import { extractPlainText } from '@/lib/llm/tiptap-text'
import {
  hasHighSeverityMatch,
  logScanMatches,
  scanContent,
} from '@/lib/security/injection-scanner'
import { escapeXml } from '@/lib/security/escape-xml'
import { wrapContextWithSecurityFrame } from '@/lib/security/security-frame'
import type { AssembledPrompt } from '@/lib/llm/types'
import type { Database } from '@/lib/types/database'

type Client = SupabaseClient<Database>

/** Subset of agent_profiles row needed by the assembler. */
export interface AssemblerProfile {
  id: string
  name: string
  operation_type: string
  node_type: string | null
  system_prompt: string
  model_id: string
  temperature: number | null
  max_tokens: number
  context_rules: Record<string, unknown> | null
}

/** Maximum hops walking up the parent chain (defensive; V1 templates max at 6). */
const MAX_ANCESTOR_DEPTH = 10

/**
 * Custom error thrown when assembly hits an injection-pattern HIGH match.
 * The Edge Function catches this and marks the job failed.
 */
export class InjectionDetectedError extends Error {
  constructor(public readonly fieldName: string) {
    super(`Injection pattern detected in field: ${fieldName}`)
    this.name = 'InjectionDetectedError'
  }
}

/**
 * Assemble a full prompt for an agent operation.
 *
 * The Edge Function calls this with the service-role Supabase client (RLS
 * bypassed; the Edge Function trusts the agent_jobs row's organisation_id
 * was already validated by the API route).
 */
export async function assembleContext(
  supabase: Client,
  nodeId: string,
  profile: AssemblerProfile,
  agentInstruction: string,
): Promise<AssembledPrompt> {
  // 1. Parallel data fetch
  const [node, ancestors, contextNodes, comments] = await Promise.all([
    fetchNode(supabase, nodeId),
    fetchAncestors(supabase, nodeId),
    fetchLinkedContextNodes(supabase, nodeId, profile),
    fetchUnresolvedComments(supabase, nodeId, profile),
  ])

  if (!node) throw new Error(`Node ${nodeId} not found in context assembly`)

  // 1b. For generate_context (and any other profile with
  //     context_rules.include_book_synopsis = true), fetch the project's
  //     first document's book root summary so the agent has thematic
  //     grounding. Context nodes have no ancestors of their own, so without
  //     this they assemble with empty stable context and the model
  //     declines. SU surfaced from T-15 prompt review.
  let bookSynopsis: NodeForAssembly | null = null
  if (profile.context_rules?.['include_book_synopsis'] === true) {
    bookSynopsis = await fetchBookSynopsisForContextNode(supabase, node)
  }

  // 2. Run injection scan on the agent_instruction (the only user input
  //    here that wasn't scanned at API-route time — defensive double scan).
  if (agentInstruction.trim()) {
    const scan = scanContent(agentInstruction)
    logScanMatches(scan, { fieldName: 'agent_instruction', nodeId })
    if (hasHighSeverityMatch(scan)) {
      throw new InjectionDetectedError('agent_instruction')
    }
  }

  // 3. Build the formatted blocks (each formatter does its own scan + escape)
  const formattedAncestors = formatAncestorChain(ancestors, nodeId)
  const formattedContextNodes = formatContextNodes(contextNodes, nodeId)
  const formattedStyleGuide = formatStyleGuide(contextNodes, nodeId)
  const formattedBookSynopsis = formatBookSynopsis(bookSynopsis, nodeId)
  const formattedCurrentNode = formatCurrentNode(node, nodeId)
  const formattedComments = formatComments(comments, nodeId)

  const stableRaw = [
    formattedBookSynopsis,
    formattedAncestors,
    formattedContextNodes,
    formattedStyleGuide,
  ]
    .filter(Boolean)
    .join('\n')

  const dynamicRaw = [
    formattedCurrentNode,
    agentInstruction.trim()
      ? `\n<agent_instruction><user_data>${escapeXml(agentInstruction.trim())}</user_data></agent_instruction>`
      : '',
    formattedComments,
  ]
    .filter(Boolean)
    .join('\n')

  // 4. Wrap with the security frame (TA §4.2)
  const { stable: stableWrapped, dynamic: dynamicWrapped } =
    wrapContextWithSecurityFrame(stableRaw, dynamicRaw)

  return {
    stable: {
      systemPrompt: profile.system_prompt,
      ancestors: formattedAncestors,
      contextNodes: formattedContextNodes,
      styleGuide: formattedStyleGuide,
      securityWrapped: stableWrapped,
    },
    dynamic: {
      currentNode: formattedCurrentNode,
      agentInstruction: agentInstruction.trim(),
      editorialComments: formattedComments,
      securityWrapped: dynamicWrapped,
    },
    config: {
      model: profile.model_id,
      temperature: profile.temperature ?? 0.7,
      maxTokens: profile.max_tokens,
      stream: false, // Phase 5 ships non-streaming; Phase 5c flips this for synthesise.
      operationType: profile.operation_type,
    },
  }
}

// ---------------------------------------------------------------------------
// Data fetching
// ---------------------------------------------------------------------------

interface NodeForAssembly {
  id: string
  name: string | null
  node_type: string
  node_category: string
  depth: number | null
  parent_id: string | null
  document_id?: string | null
  summary: string | null
  prose: string | null
  notes: string | null
  metadata: Record<string, unknown> | null
}

async function fetchNode(supabase: Client, nodeId: string): Promise<NodeForAssembly | null> {
  const { data, error } = await supabase
    .from('nodes')
    .select('id, name, node_type, node_category, depth, parent_id, summary, prose, notes, metadata')
    .eq('id', nodeId)
    .maybeSingle()
  if (error) throw new Error(`fetchNode failed: ${error.message}`)
  return data as NodeForAssembly | null
}

async function fetchAncestors(
  supabase: Client,
  nodeId: string,
): Promise<NodeForAssembly[]> {
  // Walk parent_id up the tree, in order from immediate parent to root.
  // V1 templates max at 6 layers — capped at MAX_ANCESTOR_DEPTH defensively.
  const ancestors: NodeForAssembly[] = []
  let currentId: string | null = nodeId

  for (let i = 0; i < MAX_ANCESTOR_DEPTH; i++) {
    if (!currentId) break
    const result: { data: NodeForAssembly | null; error: { message: string } | null } =
      await supabase
        .from('nodes')
        .select('id, name, node_type, node_category, depth, parent_id, summary, prose, notes, metadata')
        .eq('id', currentId)
        .maybeSingle()
    if (result.error) throw new Error(`fetchAncestors failed at hop ${i}: ${result.error.message}`)
    if (!result.data) break
    if (i > 0) ancestors.push(result.data) // skip the target itself
    currentId = result.data.parent_id
  }

  // Reverse so root is first, immediate parent is last (reading order).
  return ancestors.reverse()
}

/**
 * Fetch the book synopsis to ground a context-node operation.
 * Strategy:
 *   1. Look for any structural node linking TO this context node
 *      (back-links via node_context_links).
 *   2. If found: walk up its parent chain to the document root.
 *   3. If not found (project-scope context node with no incoming links):
 *      fall back to the project's first document's root node.
 * Returns null if no plausible book synopsis exists in the project.
 */
async function fetchBookSynopsisForContextNode(
  supabase: Client,
  contextNode: { id: string; document_id?: string | null; node_category: string },
): Promise<NodeForAssembly | null> {
  // Try back-link path first
  const { data: backLinks } = await supabase
    .from('node_context_links')
    .select('source_node_id')
    .eq('target_node_id', contextNode.id)
    .limit(1)
  const sourceId = backLinks?.[0]?.source_node_id
  if (sourceId) {
    return walkToBookRoot(supabase, sourceId)
  }

  // Fall back to project's first document's root
  if (contextNode.node_category !== 'context') return null
  const { data: ctxNode } = await supabase
    .from('nodes')
    .select('project_id')
    .eq('id', contextNode.id)
    .maybeSingle()
  if (!ctxNode?.project_id) return null

  const { data: doc } = await supabase
    .from('documents')
    .select('root_node_id')
    .eq('project_id', ctxNode.project_id)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (!doc?.root_node_id) return null

  const { data: root } = await supabase
    .from('nodes')
    .select('id, name, node_type, node_category, depth, parent_id, summary, prose, notes, metadata')
    .eq('id', doc.root_node_id)
    .maybeSingle()
  return (root as NodeForAssembly | null) ?? null
}

async function walkToBookRoot(supabase: Client, startId: string): Promise<NodeForAssembly | null> {
  let currentId: string | null = startId
  for (let i = 0; i < MAX_ANCESTOR_DEPTH; i++) {
    if (!currentId) break
    const { data } = await supabase
      .from('nodes')
      .select('id, name, node_type, node_category, depth, parent_id, summary, prose, notes, metadata')
      .eq('id', currentId)
      .maybeSingle()
    if (!data) return null
    const n = data as NodeForAssembly
    if (n.parent_id === null && n.node_category === 'structural') return n
    currentId = n.parent_id
  }
  return null
}

async function fetchLinkedContextNodes(
  supabase: Client,
  nodeId: string,
  profile: AssemblerProfile,
): Promise<NodeForAssembly[]> {
  if (profile.context_rules?.['include_linked_contexts'] === false) return []

  // SU-J14-11 (Step 1 LLM drive 2026-05-09): the comment below claimed
  // "Direct links from this node, plus ancestor-inherited links" but the
  // implementation only fetched direct links. As a result, when an
  // author linked a character/world/theme to the BOOK or ACT level, the
  // synthesise/refine prompt at scene/beat level got NONE of those
  // context nodes. The model was then writing prose with no anchor to
  // the cast or world the author had explicitly attached. This is the
  // root cause of the weak-output anomaly observed across prior drives.
  //
  // Fix: walk the parent chain from nodeId up to the document root,
  // collect every source_node_id along the way, fetch all context links
  // whose source is any node in the chain. The chain is bounded by
  // MAX_ANCESTOR_DEPTH so this stays cheap.

  // Step 1 — collect ancestor IDs (including the target itself).
  const chainIds: string[] = []
  let currentId: string | null = nodeId
  for (let i = 0; i < MAX_ANCESTOR_DEPTH; i++) {
    if (!currentId) break
    chainIds.push(currentId)
    const result: { data: { parent_id: string | null } | null } = await supabase
      .from('nodes')
      .select('parent_id')
      .eq('id', currentId)
      .maybeSingle()
    if (!result.data) break
    currentId = result.data.parent_id
  }

  // Step 2 — fetch all context links from any node in the chain.
  const { data: links, error: linkErr } = await supabase
    .from('node_context_links')
    .select('target_node_id')
    .in('source_node_id', chainIds)
  if (linkErr) throw new Error(`fetchLinkedContextNodes failed: ${linkErr.message}`)

  // Dedupe target IDs (a context could be linked at multiple levels).
  let targetIds = Array.from(new Set((links ?? []).map((row) => row.target_node_id)))

  // SU-J14-12 (Step 1 LLM drive 2026-05-09): when the target itself is a
  // context node (generate_context operation), the structural-ancestor
  // chain is empty (context nodes have parent_id=NULL) so the previous
  // logic delivered ZERO context. The user's expectation: when enriching
  // a character, the agent should see other characters, the world, the
  // themes — i.e., the full cast deployed in the project.
  //
  // For context-target operations, also include every other project-
  // scope context node in the same project that has at least one
  // back-link (i.e. is "live" in the document tree). Cap at 25 so a
  // project with 100 context nodes doesn't blow the prompt.
  const { data: targetNode } = await supabase
    .from('nodes')
    .select('id, node_category, project_id')
    .eq('id', nodeId)
    .maybeSingle()
  if (targetNode?.node_category === 'context' && targetNode.project_id) {
    // Two-step: fetch all project-scope context node IDs, then for each,
    // check if there's at least one back-link. Avoids the typed-join
    // inference issues with the embedded select.
    const { data: candidateSiblings } = await supabase
      .from('nodes')
      .select('id')
      .eq('project_id', targetNode.project_id)
      .eq('node_category', 'context')
      .neq('id', nodeId)
      .limit(50)
    const candidateIds = (candidateSiblings ?? []).map((s) => s.id)
    let siblingIds: string[] = []
    if (candidateIds.length > 0) {
      const { data: liveLinks } = await supabase
        .from('node_context_links')
        .select('target_node_id')
        .in('target_node_id', candidateIds)
      const liveSet = new Set((liveLinks ?? []).map((r) => r.target_node_id))
      siblingIds = candidateIds.filter((id) => liveSet.has(id)).slice(0, 25)
    }
    targetIds = Array.from(new Set([...targetIds, ...siblingIds]))
  }

  if (targetIds.length === 0) return []

  // Step 3 — fetch the context node bodies.
  const { data: contextNodes, error: ctxErr } = await supabase
    .from('nodes')
    .select('id, name, node_type, node_category, depth, parent_id, summary, prose, notes, metadata')
    .in('id', targetIds)
  if (ctxErr) throw new Error(`fetchLinkedContextNodes (targets) failed: ${ctxErr.message}`)

  return (contextNodes ?? []) as NodeForAssembly[]
}

interface CommentRow {
  id: string
  comment_type: string
  content: string
  author_label: string
  author_type: string
}

async function fetchUnresolvedComments(
  supabase: Client,
  nodeId: string,
  profile: AssemblerProfile,
): Promise<CommentRow[]> {
  if (profile.context_rules?.['include_unresolved_comments'] === false) return []

  const { data, error } = await supabase
    .from('node_comments')
    .select('id, comment_type, content, author_label, author_type')
    .eq('node_id', nodeId)
    .eq('resolved', false)
    .order('created_at', { ascending: true })
  if (error) throw new Error(`fetchUnresolvedComments failed: ${error.message}`)
  return (data ?? []) as CommentRow[]
}

// ---------------------------------------------------------------------------
// Formatters — each one scans + escapes + wraps in <user_data>
// ---------------------------------------------------------------------------

function scanAndWrap(value: string, fieldName: string, nodeId: string): string {
  if (!value) return ''
  const scan = scanContent(value)
  logScanMatches(scan, { fieldName, nodeId })
  if (hasHighSeverityMatch(scan)) {
    throw new InjectionDetectedError(fieldName)
  }
  return escapeXml(value)
}

function formatAncestorChain(ancestors: NodeForAssembly[], nodeId: string): string {
  if (ancestors.length === 0) return ''
  const blocks = ancestors.map((a) => {
    const name = scanAndWrap(a.name ?? '', `ancestor.name`, nodeId)
    const summary = scanAndWrap(extractPlainText(a.summary), `ancestor.summary`, nodeId)
    return `
<ancestor type="${escapeXml(a.node_type)}" id="${a.id}">
  <name>${name}</name>
  <user_data>${summary}</user_data>
</ancestor>`
  })
  return `\n<ancestors>${blocks.join('')}\n</ancestors>`
}

function formatContextNodes(contextNodes: NodeForAssembly[], nodeId: string): string {
  // Filter out style-guide nodes — those go in formatStyleGuide
  const nonStyleGuide = contextNodes.filter(
    (n) => n.node_type !== 'style_guide',
  )
  if (nonStyleGuide.length === 0) return ''
  const blocks = nonStyleGuide.map((c) => {
    const name = scanAndWrap(c.name ?? '', `context_node.name`, nodeId)
    const summary = scanAndWrap(extractPlainText(c.summary), `context_node.summary`, nodeId)
    const metadataJson = c.metadata ? JSON.stringify(c.metadata) : '{}'
    const metadataEscaped = scanAndWrap(metadataJson, `context_node.metadata`, nodeId)
    return `
<context_node type="${escapeXml(c.node_type)}" id="${c.id}">
  <name>${name}</name>
  <summary><user_data>${summary}</user_data></summary>
  <metadata><user_data>${metadataEscaped}</user_data></metadata>
</context_node>`
  })
  return `\n<context_nodes>${blocks.join('')}\n</context_nodes>`
}

function formatBookSynopsis(book: NodeForAssembly | null, nodeId: string): string {
  if (!book) return ''
  const name = scanAndWrap(book.name ?? '', `book.name`, nodeId)
  const summary = scanAndWrap(extractPlainText(book.summary), `book.summary`, nodeId)
  if (!summary) return ''
  return `
<book_synopsis id="${book.id}">
  <name>${name}</name>
  <user_data>${summary}</user_data>
</book_synopsis>`
}

function formatStyleGuide(contextNodes: NodeForAssembly[], nodeId: string): string {
  const styleGuide = contextNodes.find((n) => n.node_type === 'style_guide')
  if (!styleGuide) return ''
  const summary = scanAndWrap(extractPlainText(styleGuide.summary), `style_guide.summary`, nodeId)
  return `
<style_guide id="${styleGuide.id}">
  <user_data>${summary}</user_data>
</style_guide>`
}

function formatCurrentNode(node: NodeForAssembly, nodeId: string): string {
  const name = scanAndWrap(node.name ?? '', `current_node.name`, nodeId)
  const summary = scanAndWrap(extractPlainText(node.summary), `current_node.summary`, nodeId)
  const prose = scanAndWrap(extractPlainText(node.prose), `current_node.prose`, nodeId)
  const notes = scanAndWrap(extractPlainText(node.notes), `current_node.notes`, nodeId)
  return `
<current_node type="${escapeXml(node.node_type)}" id="${node.id}">
  <name>${name}</name>
  <summary><user_data>${summary}</user_data></summary>
  <prose><user_data>${prose}</user_data></prose>
  <notes><user_data>${notes}</user_data></notes>
</current_node>`
}

function formatComments(comments: CommentRow[], nodeId: string): string {
  if (comments.length === 0) return ''
  const blocks = comments.map((c) => {
    const content = scanAndWrap(c.content, `comment.content`, nodeId)
    return `
<editorial_comment id="${c.id}" type="${escapeXml(c.comment_type)}" author="${escapeXml(c.author_type)}">
  <user_data>${content}</user_data>
</editorial_comment>`
  })
  return `\n<editorial_comments>${blocks.join('')}\n</editorial_comments>`
}
