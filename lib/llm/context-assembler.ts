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
  const formattedCurrentNode = formatCurrentNode(node, nodeId)
  const formattedComments = formatComments(comments, nodeId)

  const stableRaw = [
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

async function fetchLinkedContextNodes(
  supabase: Client,
  nodeId: string,
  profile: AssemblerProfile,
): Promise<NodeForAssembly[]> {
  if (profile.context_rules?.['include_linked_contexts'] === false) return []

  // Direct links from this node, plus ancestor-inherited links.
  // For V1, fetch via direct query; cleaner than relying on the Phase 4
  // route's complex inherited-link computation. The Edge Function is
  // service-role so RLS isn't filtering here; trust the link targets.
  const { data: directLinks, error: directErr } = await supabase
    .from('node_context_links')
    .select('target_node_id')
    .eq('source_node_id', nodeId)
  if (directErr) throw new Error(`fetchLinkedContextNodes failed: ${directErr.message}`)

  const targetIds = (directLinks ?? []).map((row) => row.target_node_id)
  if (targetIds.length === 0) return []

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
