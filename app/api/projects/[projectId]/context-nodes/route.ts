// Spec: stelavox_phase4_api_contract_v1_0.md §3.1 (POST), §3.2 (GET)
//       stelavox_phase4_test_plan_v1_0.md TC-A-01 to TC-A-14
//       stelavox_phase4_build_checklist_v1_0.md §3.3 T-3.1
//
// Two handlers for /api/projects/[projectId]/context-nodes:
//   POST — create a project- or document-scoped context node (§3.1)
//   GET  — paginated list filtered by scope/document_id/node_type (§3.2)
//
// Auth (RLS) is at the database layer — these handlers never filter
// by user_id.
//
// Phase 2's POST /api/documents/[id]/nodes is intentionally NOT
// extended for context creation (per API Contract §1.2). All context-
// creation goes through this project-level endpoint.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { err } from '@/lib/api/errors'
import { isValidUuid } from '@/lib/validation/uuid'
import { nodeContextPostSchema } from '@/lib/validation/nodes'
import { getProject } from '@/lib/data/projects'
import { getDocument } from '@/lib/data/documents'
import {
  createContextNode, listContextNodesByProject,
  decorateWithLeaf,
} from '@/lib/data/nodes'
import { CONTEXT_NODE_TYPES_V1, type ContextNodeType } from '@/lib/context/types'

interface Context { params: Promise<{ projectId: string }> }

// ─── POST ─────────────────────────────────────────────────────────────

export async function POST(request: NextRequest, { params }: Context) {
  try {
    const { projectId } = await params
    if (!isValidUuid(projectId)) return err.invalidUuid()

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return err.unauthorised()

    const contentType = request.headers.get('content-type') ?? ''
    if (!contentType.includes('application/json')) return err.invalidJson()

    let body: unknown
    try { body = await request.json() } catch { return err.invalidJson() }
    if (!body || (typeof body === 'object' && Object.keys(body as object).length === 0)) {
      return err.missingBody()
    }

    const parsed = nodeContextPostSchema.safeParse(body)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      if (issue?.code === 'unrecognized_keys') {
        const key = Array.isArray((issue as { keys?: unknown }).keys)
          ? String(((issue as { keys: unknown[] }).keys)[0] ?? '')
          : ''
        return err.unknownField(key)
      }
      const path0 = issue?.path[0]
      if (path0 === 'scope')             return err.invalidScope()
      if (path0 === 'document_id')       return err.invalidUuid()
      if (path0 === 'node_type')         return err.invalidNodeType()
      if (path0 === 'name')              return err.invalidName()
      if (path0 === 'short_description') return err.invalidShortDescription()
      if (path0 === 'summary')           return err.invalidSummary()
      if (path0 === 'notes')             return err.invalidNotes()
      if (path0 === 'metadata')          return err.invalidMetadata()
      if (path0 === 'tags')              return err.invalidName()  // tags share the name code-path
      return err.invalidName()
    }

    // Step 10: scope/document_id consistency.
    const data = parsed.data
    if (data.scope === 'document' && !data.document_id) return err.scopeDocumentMismatch()
    if (data.scope === 'project'  &&  data.document_id) return err.scopeDocumentMismatch()

    // Step 11: project exists and is visible.
    const { data: project } = await getProject(supabase, projectId)
    if (!project) return err.projectNotFound()

    // Step 12: if scope='document', document exists and is in this project.
    if (data.scope === 'document') {
      const { data: doc } = await getDocument(supabase, data.document_id!)
      if (!doc) return err.documentNotFound()
      if (doc.project_id !== projectId) return err.documentNotInProject()
    }

    // Step 13: insert.
    const { data: inserted, error: insertError } = await createContextNode(supabase, {
      organisation_id:   project.organisation_id,
      project_id:        projectId,
      scope:             data.scope,
      document_id:       data.document_id ?? null,
      node_type:         data.node_type,
      name:              data.name,
      short_description: data.short_description ?? null,
      summary:           data.summary ?? null,
      notes:             data.notes ?? null,
      metadata:          data.metadata ?? {},
      tags:              data.tags ?? [],
    })
    if (insertError || !inserted) return err.internal()

    // §2.12: every node response includes is_leaf. Context nodes are
    // structurally non-leaf (they don't live in any layer_stack); the
    // helper returns false when maxLayerIndex is null OR layer_index
    // doesn't match. For context nodes layer_index defaults to 0 — but
    // since maxLayerIndex is computed against a layer_stack the node
    // does NOT belong to (context has no stack), we pass null to force
    // is_leaf=false.
    return NextResponse.json(
      { node: decorateWithLeaf(inserted, null) },
      { status: 201 },
    )
  } catch {
    return err.internal()
  }
}

// ─── GET ──────────────────────────────────────────────────────────────

const VALID_SCOPES = new Set(['project', 'document'])

export async function GET(request: NextRequest, { params }: Context) {
  try {
    const { projectId } = await params
    if (!isValidUuid(projectId)) return err.invalidUuid()

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return err.unauthorised()

    const { searchParams } = new URL(request.url)

    // Reject unknown query params.
    const ALLOWED = new Set(['limit', 'offset', 'scope', 'document_id', 'node_type'])
    for (const key of searchParams.keys()) {
      if (!ALLOWED.has(key)) return err.unknownParam()
    }

    // Parse limit/offset.
    const limitStr  = searchParams.get('limit')
    const offsetStr = searchParams.get('offset')
    const limit  = limitStr  === null ? 100 : Number(limitStr)
    const offset = offsetStr === null ?   0 : Number(offsetStr)
    if (!Number.isInteger(limit)  || limit  < 1 || limit  > 200) return err.invalidQuery()
    if (!Number.isInteger(offset) || offset < 0)                 return err.invalidQuery()

    // Parse scope.
    const scopeParam = searchParams.get('scope')
    if (scopeParam !== null && !VALID_SCOPES.has(scopeParam)) return err.invalidQuery()
    const scope = scopeParam as 'project' | 'document' | null

    // Parse node_type.
    const nodeTypeParam = searchParams.get('node_type')
    if (nodeTypeParam !== null && !(CONTEXT_NODE_TYPES_V1 as readonly string[]).includes(nodeTypeParam)) {
      return err.invalidQuery()
    }
    const nodeType = nodeTypeParam as ContextNodeType | null

    // Parse document_id (if supplied: valid UUID + the document exists in this project).
    const documentIdParam = searchParams.get('document_id')
    if (documentIdParam !== null) {
      if (!isValidUuid(documentIdParam)) return err.invalidQuery()
    }

    // Project exists and is visible.
    const { data: project } = await getProject(supabase, projectId)
    if (!project) return err.projectNotFound()

    // If document_id is supplied, verify it belongs to this project.
    if (documentIdParam !== null) {
      const { data: doc } = await getDocument(supabase, documentIdParam)
      if (!doc || doc.project_id !== projectId) return err.documentNotFound()
    }

    const { rows, total, error } = await listContextNodesByProject(
      supabase,
      projectId,
      {
        scope:      scope ?? undefined,
        documentId: documentIdParam ?? undefined,
        nodeType:   nodeType ?? undefined,
        limit, offset,
      },
    )
    if (error) return err.internal()

    // Decorate each row with is_leaf=false (context nodes are
    // structurally non-leaf — see POST comment above).
    const decorated = rows.map(row => decorateWithLeaf(row, null))

    return NextResponse.json({
      context_nodes: decorated,
      total,
      has_more: offset + rows.length < total,
    })
  } catch {
    return err.internal()
  }
}
