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
 * input_schema is hand-written JSON Schema (the format Anthropic's tool
 * API expects). It MUST stay in sync with lib/director/schemas.ts where
 * the same shapes live as Zod schemas for parameter validation.
 */

import 'server-only'

import type {
  DirectorToolDefinition,
  DirectorSession,
  ToolResult,
} from '@/lib/director/types'
import {
  execAssessDownstreamImpact,
  execGetConversationHistory,
  execGetDocumentState,
  execGetNode,
  execGetNodeTree,
  execGetNodesByLayer,
  execGetWorkflowHistory,
} from '@/lib/director/tools/read'
import {
  execCreateCommentStep,
  execCreateContextStep,
  execCreateExpandStep,
  execCreateNodeReorderStep,
  execCreateRefineStep,
  execCreateSynthesiseStep,
} from '@/lib/director/tools/write'

// ---------------------------------------------------------------------------
// Read tool definitions
// ---------------------------------------------------------------------------

const readTools: DirectorToolDefinition[] = [
  {
    name: 'get_document_state',
    kind: 'read',
    description:
      'Get the document\'s overall structure: layer stack, node counts by type, locked node IDs, root node id, total approximate word count. Use this first when orienting yourself to a project.',
    input_schema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'get_node',
    kind: 'read',
    description:
      'Get a single node\'s full detail: name, type, summary, prose, notes, metadata, ancestors, child count, linked context node IDs, locked status, version. Use after orienting via get_document_state to read individual nodes you intend to analyse or modify.',
    input_schema: {
      type: 'object',
      properties: { node_id: { type: 'string', format: 'uuid' } },
      required: ['node_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_nodes_by_layer',
    kind: 'read',
    description:
      'Get all nodes at a given layer (e.g. layer_index=2 for chapters in a typical novel). Optionally scope by parent_node_id to get only the children of a specific node. Useful for breadth-first exploration of structural layers.',
    input_schema: {
      type: 'object',
      properties: {
        layer_index: { type: 'integer', minimum: 0 },
        parent_node_id: { type: 'string', format: 'uuid' },
      },
      required: ['layer_index'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_node_tree',
    kind: 'read',
    description:
      'Get a recursive tree from a root_node_id, capped at max_depth. Returns nested {id, name, node_type, layer_index, locked, children}. Useful for understanding a subtree\'s shape without making one query per node.',
    input_schema: {
      type: 'object',
      properties: {
        root_node_id: { type: 'string', format: 'uuid' },
        max_depth: { type: 'integer', minimum: 1, maximum: 10 },
      },
      required: ['root_node_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'assess_downstream_impact',
    kind: 'read',
    description:
      'Given a node_id and a description of the change you\'re proposing, returns the list of descendant nodes that would potentially be affected, with locked-node identification. Use before composing a workflow to understand the blast radius.',
    input_schema: {
      type: 'object',
      properties: {
        node_id: { type: 'string', format: 'uuid' },
        change_description: { type: 'string', minLength: 1, maxLength: 2000 },
      },
      required: ['node_id', 'change_description'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_conversation_history',
    kind: 'read',
    description:
      'Get earlier messages in this conversation (paginated, oldest-first within page). Use when the user references prior decisions you don\'t remember. Defaults to the 20 most recent.',
    input_schema: {
      type: 'object',
      properties: {
        before_sequence: { type: 'integer', minimum: 1 },
        limit: { type: 'integer', minimum: 1, maximum: 50 },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_workflow_history',
    kind: 'read',
    description:
      'Get the most recent workflows for this document (any status). Optionally filter by status. Use when the user asks about prior plans or wants to know what you\'ve done before.',
    input_schema: {
      type: 'object',
      properties: {
        status_filter: {
          type: 'string',
          enum: ['draft', 'approved', 'running', 'paused', 'completed', 'cancelled'],
        },
        limit: { type: 'integer', minimum: 1, maximum: 20 },
      },
      additionalProperties: false,
    },
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
    input_schema: {
      type: 'object',
      properties: {
        target_node_id: { type: 'string', format: 'uuid' },
        child_count_target: { type: 'integer', minimum: 1, maximum: 20 },
        description: { type: 'string', minLength: 1, maxLength: 2000 },
        estimated_duration_seconds: { type: 'integer', minimum: 0 },
      },
      required: ['target_node_id', 'description', 'estimated_duration_seconds'],
      additionalProperties: false,
    },
  },
  {
    name: 'create_synthesise_step',
    kind: 'write',
    description:
      'Propose a step that runs the synthesise agent on a leaf node — generates prose from the node\'s summary + linked context. Returns a workflow step proposal; nothing executes until approved.',
    input_schema: {
      type: 'object',
      properties: {
        target_node_id: { type: 'string', format: 'uuid' },
        description: { type: 'string', minLength: 1, maxLength: 2000 },
        estimated_duration_seconds: { type: 'integer', minimum: 0 },
      },
      required: ['target_node_id', 'description', 'estimated_duration_seconds'],
      additionalProperties: false,
    },
  },
  {
    name: 'create_refine_step',
    kind: 'write',
    description:
      'Propose a step that runs the refine agent on a single field of a node (summary | prose | notes | metadata) with a specific instruction. Returns a workflow step proposal; nothing executes until approved.',
    input_schema: {
      type: 'object',
      properties: {
        target_node_id: { type: 'string', format: 'uuid' },
        target_field: {
          type: 'string',
          enum: ['summary', 'prose', 'notes', 'metadata'],
        },
        instruction: { type: 'string', minLength: 1, maxLength: 2000 },
        description: { type: 'string', minLength: 1, maxLength: 2000 },
        estimated_duration_seconds: { type: 'integer', minimum: 0 },
      },
      required: [
        'target_node_id',
        'target_field',
        'instruction',
        'description',
        'estimated_duration_seconds',
      ],
      additionalProperties: false,
    },
  },
  {
    name: 'create_context_step',
    kind: 'write',
    description:
      'Propose a step that generates a context node\'s content from scratch or from a partial seed. context_type must be one of the V1 core types. Returns a workflow step proposal; nothing executes until approved.',
    input_schema: {
      type: 'object',
      properties: {
        target_node_id: { type: 'string', format: 'uuid' },
        context_type: {
          type: 'string',
          enum: [
            'character',
            'location',
            'organisation',
            'theme',
            'plot_thread',
            'world',
          ],
        },
        seed_content: { type: 'string', maxLength: 10000 },
        description: { type: 'string', minLength: 1, maxLength: 2000 },
        estimated_duration_seconds: { type: 'integer', minimum: 0 },
      },
      required: [
        'target_node_id',
        'context_type',
        'description',
        'estimated_duration_seconds',
      ],
      additionalProperties: false,
    },
  },
  {
    name: 'create_comment_step',
    kind: 'write',
    description:
      'Propose a step that posts an editorial comment on a node — useful for surfacing concerns or notes to the author without modifying content. Comments are admitted on locked nodes. Returns a workflow step proposal; nothing executes until approved.',
    input_schema: {
      type: 'object',
      properties: {
        target_node_id: { type: 'string', format: 'uuid' },
        comment_type: { type: 'string', enum: ['instruction', 'note'] },
        content: { type: 'string', minLength: 1, maxLength: 5000 },
        description: { type: 'string', minLength: 1, maxLength: 2000 },
        estimated_duration_seconds: { type: 'integer', minimum: 0 },
      },
      required: [
        'target_node_id',
        'comment_type',
        'content',
        'description',
        'estimated_duration_seconds',
      ],
      additionalProperties: false,
    },
  },
  {
    name: 'create_node_reorder_step',
    kind: 'write',
    description:
      'Propose a step that reorders a node within its current parent (or moves it to a new parent if parent_id is provided). new_order is 1-indexed (Phase 2 convention). Returns a workflow step proposal; nothing executes until approved.',
    input_schema: {
      type: 'object',
      properties: {
        target_node_id: { type: 'string', format: 'uuid' },
        new_order: { type: 'integer', minimum: 1 },
        parent_id: { type: 'string', format: 'uuid' },
        description: { type: 'string', minLength: 1, maxLength: 2000 },
        estimated_duration_seconds: { type: 'integer', minimum: 0 },
      },
      required: [
        'target_node_id',
        'new_order',
        'description',
        'estimated_duration_seconds',
      ],
      additionalProperties: false,
    },
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
  get_document_state: execGetDocumentState as ToolExecutor,
  get_node: execGetNode as ToolExecutor,
  get_nodes_by_layer: execGetNodesByLayer as ToolExecutor,
  get_node_tree: execGetNodeTree as ToolExecutor,
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
