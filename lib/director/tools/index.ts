/**
 * Director — tool registry.
 *
 * Source: stelavox_phase5b_api_contract_v1_0.md §1, §2.11 invariants I-2/I-7.
 *         stelavox_technical_architecture_v1_9.md §8.3.
 * Build Checklist: T-4 (read tools) + T-5 (write tools).
 *
 * The TOOL_REGISTRY is filtered by director_configs.tool_suite at session
 * start (TA §8.3) — Phase 5b loads the v1.0 production config which
 * registers 13 tools (7 read + 6 write). create_document_operation_step
 * is intentionally NOT in this registry per the Phase 5b carve-out.
 *
 * B6.1 (round-3 audit F-81): input_schema is generated from the Zod
 * schema in lib/director/schemas.ts via `toolInputSchemaFor(name)`.
 * Pre-fix the input_schema was hand-written JSON Schema and could
 * drift from the Zod schema silently — fixing one didn't propagate
 * to the other. Single source of truth now: ToolInputSchemas.
 */

import 'server-only'

import type {
  DirectorToolDefinition,
  DirectorSession,
  ToolResult,
} from '@/lib/director/types'
import {
  execAssessDownstreamImpact,
  execFindContextReferences,
  execFindNodeByName,
  execGetBriefState,
  execGetConversationHistory,
  execGetDocumentState,
  execGetNode,
  execGetNodeTree,
  execGetNodesByLayer,
  execGetProjectProfile,
  execGetSubtreeContent,
  execGetWorkflowHistory,
} from '@/lib/director/tools/read'
import {
  execCancelBrief,
  execCreateCommentStep,
  execCreateContextStep,
  execCreateExpandStep,
  execCreateNodeReorderStep,
  execCreateRefineStep,
  execCreateSynthesiseStep,
  execProposeBrief,
  execProposeBriefAmendment,
  execProposeProfileAmendment,
  execReportCapabilityLimit,
} from '@/lib/director/tools/write'
import { toolInputSchemaFor } from '@/lib/director/tool-schema'

// ---------------------------------------------------------------------------
// Read tool definitions
// ---------------------------------------------------------------------------

const readTools: DirectorToolDefinition[] = [
  {
    name: 'get_project_profile',
    kind: 'read',
    description:
      "Get the Project Profile — the persistent identity of this document: optional project-level goal_text, preferences (voice rules, constraints, decisions, named entities), and recent amendments. The Profile lives for the document's whole life. Call this first on every substantive planning turn.",
    input_schema: toolInputSchemaFor('get_project_profile'),
  },
  {
    name: 'get_brief_state',
    kind: 'read',
    description:
      "Get the document's Brief queue: {active, queue}. `active` is the currently-running Brief (or null if none) — full goal_text, current_stage, full stage list with statuses and trigger config. `queue` is an ordered list of approved-but-waiting Briefs (lite shape — goal_text + sequence_position + stage_count) sorted by sequence_position. At most one ACTIVE Brief per document; new approved Briefs queue behind it and auto-promote when the active one completes or is cancelled. Call this immediately after get_project_profile to decide whether the user's request extends the active Brief, queues a new one, or warrants a cancel_brief proposal first.",
    input_schema: toolInputSchemaFor('get_brief_state'),
  },
  {
    name: 'get_document_state',
    kind: 'read',
    description:
      "Get the document's overall structure: layer stack, node counts by type, locked node IDs, root node id, total approximate word count, and per-layer progress (expand counters with the next un-expanded canonical position; for leaf layers, synthesise counters with the next un-synthesised canonical position). Use the progress.by_layer field as the authoritative starting point for multi-workflow batch continuation — do not derive batch start positions from conversation history. Use this tool first when orienting yourself to a project.",
    input_schema: toolInputSchemaFor('get_document_state'),
  },
  {
    name: 'get_node',
    kind: 'read',
    description:
      'Get a single node\'s full detail: name, type, summary, prose, notes, metadata, ancestors, child count, linked context node IDs, locked status, version. Use after orienting via get_document_state to read individual nodes you intend to analyse or modify.',
    input_schema: toolInputSchemaFor('get_node'),
  },
  {
    name: 'get_nodes_by_layer',
    kind: 'read',
    description:
      'Get all nodes at a given layer (e.g. layer_index=2 for chapters in a typical novel). Optionally scope by parent_node_id to get only the children of a specific node. Useful for breadth-first exploration of structural layers.',
    input_schema: toolInputSchemaFor('get_nodes_by_layer'),
  },
  {
    name: 'find_node_by_name',
    kind: 'read',
    description:
      'Find nodes by name (case-insensitive substring match) across ALL layers. Returns each match with its full ancestor path (e.g. "Shadow Protocol > Act One > Salvage > The Bonding > The Visions") so you can disambiguate definitively without guessing. Use this FIRST whenever the user names a node and you don\'t already have its id from iteration_state.user_message.mentioned_node_ids. Ranks exact-match > prefix > substring; capped at 20 results. Optional node_type or layer_index filters narrow the search.',
    input_schema: toolInputSchemaFor('find_node_by_name'),
  },
  {
    name: 'get_node_tree',
    kind: 'read',
    description:
      'Get a recursive tree from a root_node_id, capped at max_depth. Returns nested {id, name, node_type, layer_index, locked, children}. Useful for understanding a subtree\'s shape without making one query per node. Returns SHAPE ONLY — no prose, no summary. If you need content for many nodes, use get_subtree_content instead.',
    input_schema: toolInputSchemaFor('get_node_tree'),
  },
  {
    name: 'get_subtree_content',
    kind: 'read',
    description:
      'Bulk content read across a subtree. Returns descendants of root_node_id (plus the root) in one call, each with summary_text + prose_text + has_summary + has_prose + status + word_count_actual + word_count_target + locked. Use this whenever you need to read / audit / summarise / aggregate content across many nodes (e.g. "do all beats in chapter 1 have prose?", "review the dialogue across scenes 5-10", "total word count of chapter 3"). Defaults: max_nodes=50 (ceiling 200), include_prose=true, include_summary=true. Set include_prose=false when you only need completion flags (cheaper response). Optional layer_index filter narrows to a single layer (e.g. only beats). Returns truncated:true when the cap is hit — narrow the root_node_id if so. Prefer this over N get_node calls.',
    input_schema: toolInputSchemaFor('get_subtree_content'),
  },
  {
    name: 'find_context_references',
    kind: 'read',
    description:
      'Find every structural node that references a given context node. Use to answer "where does character X appear?", "which scenes reference the World setting?", "what uses this theme node?". Returns each referencing node with its ancestor path so it\'s self-describing. Capped at max_results (default 50, ceiling 200) with truncated:true when the cap is hit.',
    input_schema: toolInputSchemaFor('find_context_references'),
  },
  {
    name: 'assess_downstream_impact',
    kind: 'read',
    description:
      'Given a node_id and a description of the change you\'re proposing, returns the list of descendant nodes that would potentially be affected, with locked-node identification. Use before composing a workflow to understand the blast radius.',
    input_schema: toolInputSchemaFor('assess_downstream_impact'),
  },
  {
    name: 'get_conversation_history',
    kind: 'read',
    description:
      'Get earlier messages in this conversation (paginated, oldest-first within page). Use when the user references prior decisions you don\'t remember. Defaults to the 20 most recent.',
    input_schema: toolInputSchemaFor('get_conversation_history'),
  },
  {
    name: 'get_workflow_history',
    kind: 'read',
    description:
      'Get the most recent workflows for this document (any status). Optionally filter by status. Use when the user asks about prior plans or wants to know what you\'ve done before.',
    input_schema: toolInputSchemaFor('get_workflow_history'),
  },
]

// ---------------------------------------------------------------------------
// Write tool definitions
// ---------------------------------------------------------------------------

const writeTools: DirectorToolDefinition[] = [
  {
    name: 'create_expand_step',
    kind: 'write',
    description:
      'Propose a step that runs the expand agent on a structural node — generates child nodes one layer down. Returns a workflow step proposal; nothing executes until the author approves.',
    input_schema: toolInputSchemaFor('create_expand_step'),
  },
  {
    name: 'create_synthesise_step',
    kind: 'write',
    description:
      'Propose a step that runs the synthesise agent on a leaf node — generates prose from the node\'s summary + linked context. Returns a workflow step proposal; nothing executes until approved.',
    input_schema: toolInputSchemaFor('create_synthesise_step'),
  },
  {
    name: 'create_refine_step',
    kind: 'write',
    description:
      'Propose a step that runs the refine agent on a single field of a node (summary | prose | notes | metadata) with a specific instruction. Returns a workflow step proposal; nothing executes until approved.',
    input_schema: toolInputSchemaFor('create_refine_step'),
  },
  {
    name: 'create_context_step',
    kind: 'write',
    description:
      'Propose a step that generates a context node\'s content from scratch or from a partial seed. context_type must be one of the V1 core types. Returns a workflow step proposal; nothing executes until approved.',
    input_schema: toolInputSchemaFor('create_context_step'),
  },
  {
    name: 'create_comment_step',
    kind: 'write',
    description:
      'Propose a step that posts an editorial comment on a node — useful for surfacing concerns or notes to the author without modifying content. Comments are admitted on locked nodes. Returns a workflow step proposal; nothing executes until approved.',
    input_schema: toolInputSchemaFor('create_comment_step'),
  },
  {
    name: 'create_node_reorder_step',
    kind: 'write',
    description:
      'Propose a step that reorders a node within its current parent (or moves it to a new parent if parent_id is provided). new_order is 1-indexed (Phase 2 convention). Returns a workflow step proposal; nothing executes until approved.',
    input_schema: toolInputSchemaFor('create_node_reorder_step'),
  },
  {
    name: 'propose_brief',
    kind: 'write',
    description:
      "Propose a Brief — the operation plan for ANY unit of work the author has asked for. Required fields: goal_text (operation description) + stages (one or more). Stage 1's workflow must be fully specified (concrete steps with target_node_ids); stages 2..N may pass workflow:null (their workflows are planned just-in-time when their stage activates, typically because they depend on outputs from earlier stages). The trivial n=1 case (one stage with one workflow with one step) is just a degenerate Brief — propose it the same way as a multi-stage Brief. V1.x-B.1.1 admits multiple Briefs per document: if get_brief_state shows a non-null active Brief, the new Brief automatically queues behind it (sequence_position = next) and starts when the active one completes. To pivot away from the active Brief, propose cancel_brief on it first.",
    input_schema: toolInputSchemaFor('propose_brief'),
  },
  {
    name: 'propose_profile_amendment',
    kind: 'write',
    description:
      "Propose a delta change to the Project Profile — promote a durable voice rule / constraint / named decision / named entity / goal_text that the author stated in conversation. amendment_type ∈ {update_goal_text, update_voice, add_constraint, update_constraints, add_decision, update_decisions, update_named_entities, generic_preferences_set}. target_path is the dotted JSONB path (e.g. 'preferences.constraints'); omitted for update_goal_text. Nothing writes until the author approves the ProfileAmendmentCard.",
    input_schema: toolInputSchemaFor('propose_profile_amendment'),
  },
  {
    name: 'cancel_brief',
    kind: 'write',
    description:
      "V1.x-B.1.1 — propose cancellation of an active, queued, or planned Brief. Required: brief_id (the Brief to cancel) + reason (one sentence explaining why; surfaces in the cancel_cascade audit event). Destructive: cascade-cancels the Brief's non-terminal stages and any in-flight workflows; auto-promotes the next queued Brief if the cancelled one was active. Per H-08 this tool produces a proposal — the user approves via BriefCancellationProposalCard before the cancel_brief RPC fires. Use when: the user explicitly requests cancellation; the user pivots scope dramatically and you're about to propose a replacement (cancel first, then a new Brief on the user's next message); you recognise a stuck Brief the user is working around. NOT for pausing a workflow (that's the scheduler's Stop action — direct manipulation, not yours to propose) or for reordering the queue.",
    input_schema: toolInputSchemaFor('cancel_brief'),
  },
  {
    name: 'propose_brief_amendment',
    kind: 'write',
    description:
      "V1.x-B.3 — propose an in-flight modification to an active or planned Brief. Required: brief_id (the Brief to amend) + amendment_type (one of 'goal_text' | 'preferences' | 'add_stage' | 'modify_pending_stage' | 'remove_pending_stage') + after (the new shape; for goal_text: { goal_text: string }; for preferences: a partial object that deep-merges; for add_stage: full stage payload; for modify/remove_pending_stage: the stage UUID goes in target_path) + reason (one sentence). Already-running stages CANNOT be amended (only status='planned' stages); already-completed stages cannot be removed. The user approves via BriefAmendmentCard before apply_brief_amendment RPC fires. Use when: the user wants to extend an active Brief with another stage; the user wants to refine the goal_text or preferences on an in-flight Brief; the user wants to drop or modify a pending (not-yet-running) stage. NOT for cancelling a Brief (use cancel_brief) or for proposing a new Brief (use propose_brief).",
    input_schema: toolInputSchemaFor('propose_brief_amendment'),
  },
  {
    name: 'report_capability_limit',
    kind: 'write',
    description:
      "V1.x-F.1 — declare a capability boundary that prevents you from fulfilling the user's request in one go. Required: detected_limit (one of 'per_iteration_cap' | 'token_budget' | 'tool_count' | 'other') + suggested_alternative (the closest reformulation you CAN do — e.g. 'plan chapters 1-10 first, then continue in subsequent batches') + reason (one sentence explaining the limit). Call this BEFORE attempting partial execution; do NOT call propose_brief or propose_workflow for the over-capacity request after reporting the limit (wait for the user to reformulate). Surfaces as CapabilityLimitCard in the conversation thread; no DB write. Use when: the user requests more nodes than fit in one workflow (cap typically 30); a token estimate would exceed budget; required tool count exceeds your tool_suite; a multi-step batch protocol genuinely doesn't fit. NOT for failed validation (return the model's natural failure response) or for cancelling a Brief (use cancel_brief).",
    input_schema: toolInputSchemaFor('report_capability_limit'),
  },
]

// ---------------------------------------------------------------------------
// Combined registry
// ---------------------------------------------------------------------------

export const TOOL_REGISTRY: DirectorToolDefinition[] = [
  ...readTools,
  ...writeTools,
]

// Map tool name → executor for fast dispatch in the agentic loop.
type ToolExecutor = (
  args: Record<string, unknown>,
  session: DirectorSession,
) => Promise<ToolResult>

const TOOL_EXECUTORS: Record<string, ToolExecutor> = {
  // read
  get_project_profile: execGetProjectProfile as ToolExecutor,
  get_brief_state: execGetBriefState as ToolExecutor,
  get_document_state: execGetDocumentState as ToolExecutor,
  get_node: execGetNode as ToolExecutor,
  get_nodes_by_layer: execGetNodesByLayer as ToolExecutor,
  find_node_by_name: execFindNodeByName as ToolExecutor,
  get_node_tree: execGetNodeTree as ToolExecutor,
  get_subtree_content: execGetSubtreeContent as ToolExecutor,
  find_context_references: execFindContextReferences as ToolExecutor,
  assess_downstream_impact: execAssessDownstreamImpact as ToolExecutor,
  get_conversation_history: execGetConversationHistory as ToolExecutor,
  get_workflow_history: execGetWorkflowHistory as ToolExecutor,
  // write
  create_expand_step: execCreateExpandStep as ToolExecutor,
  create_synthesise_step: execCreateSynthesiseStep as ToolExecutor,
  create_refine_step: execCreateRefineStep as ToolExecutor,
  create_context_step: execCreateContextStep as ToolExecutor,
  create_comment_step: execCreateCommentStep as ToolExecutor,
  create_node_reorder_step: execCreateNodeReorderStep as ToolExecutor,
  propose_brief: execProposeBrief as ToolExecutor,
  propose_profile_amendment: execProposeProfileAmendment as ToolExecutor,
  cancel_brief: execCancelBrief as ToolExecutor,
  propose_brief_amendment: execProposeBriefAmendment as ToolExecutor,
  report_capability_limit: execReportCapabilityLimit as ToolExecutor,
}

export function getToolByName(name: string): DirectorToolDefinition | undefined {
  return TOOL_REGISTRY.find((t) => t.name === name)
}

export function getToolExecutor(name: string): ToolExecutor | undefined {
  return TOOL_EXECUTORS[name]
}

/** Filter the registry by a director_configs.tool_suite array. */
export function buildToolDefinitions(
  toolSuite: string[],
): DirectorToolDefinition[] {
  return TOOL_REGISTRY.filter((t) => toolSuite.includes(t.name))
}
