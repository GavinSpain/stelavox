import { NextResponse } from 'next/server'

export function apiError(status: number, error: string, message?: string): NextResponse {
  return NextResponse.json({ error, ...(message ? { message } : {}) }, { status })
}

export const err = {
  unauthorised:        () => apiError(401, 'unauthorised'),
  noOrganisation:      () => apiError(403, 'no_organisation'),
  notFound:            (msg = 'not_found') => apiError(404, msg),
  invalidUuid:         () => apiError(400, 'invalid_uuid'),
  invalidJson:         () => apiError(400, 'invalid_json'),
  missingBody:         () => apiError(400, 'missing_body'),
  emptyUpdate:         () => apiError(400, 'empty_update'),
  unexpectedBody:      () => apiError(400, 'unexpected_body'),
  unknownField:        (field: string) => apiError(400, 'unknown_field', `Unknown field: ${field}`),
  invalidName:         () => apiError(400, 'invalid_name'),
  invalidDescription:  () => apiError(400, 'invalid_description'),
  invalidDocumentType: () => apiError(400, 'invalid_document_type'),
  invalidStatus:       () => apiError(400, 'invalid_status'),
  invalidAuthors:      () => apiError(400, 'invalid_authors'),
  unknownParam:        () => apiError(400, 'unknown_param'),
  missingTemplate:     () => apiError(500, 'missing_template'),
  internal:            () => apiError(500, 'internal_error'),

  // Phase 2 nodes — POST/GET (T-3.3)
  missingParentId:           () => apiError(400, 'missing_parent_id'),
  invalidNodeType:           () => apiError(400, 'invalid_node_type'),
  invalidCategory:           () => apiError(400, 'invalid_category'),
  invalidShortDescription:   () => apiError(400, 'invalid_short_description'),
  invalidAgentInstruction:   () => apiError(400, 'invalid_agent_instruction'),
  invalidWordCountTarget:    () => apiError(400, 'invalid_word_count_target'),
  invalidSummary:            () => apiError(400, 'invalid_summary'),
  invalidProse:              () => apiError(400, 'invalid_prose'),
  invalidNotes:              () => apiError(400, 'invalid_notes'),
  invalidMetadata:           () => apiError(400, 'invalid_metadata'),
  invalidParent:             () => apiError(422, 'invalid_parent'),
  layerViolation:            () => apiError(422, 'layer_violation'),
  maxDepthExceeded:          () => apiError(422, 'max_depth_exceeded'),
  parentLocked:              () => apiError(423, 'parent_locked'),

  // Phase 2 nodes — PATCH/DELETE single (T-3.4)
  invalidLocked:             () => apiError(400, 'invalid_locked'),
  invalidLockReason:         () => apiError(400, 'invalid_lock_reason'),
  cannotDeleteRoot:          () => apiError(422, 'cannot_delete_root'),
  nodeLocked:                () => apiError(423, 'node_locked'),

  // Phase 2 nodes — PATCH /move (T-3.5)
  invalidPosition:           () => apiError(400, 'invalid_position'),
  cycleDetected:             () => apiError(422, 'cycle_detected'),

  // Phase 3 nodes — version history (T-5.5..T-5.6)
  invalidQuery:              () => apiError(400, 'invalid_query'),
  invalidVersionNumber:      () => apiError(400, 'invalid_version_number'),
  versionNotFound:           () => apiError(404, 'version_not_found'),

  // Phase 3 nodes — PATCH optimistic concurrency (T-4.4)
  invalidExpectedVersion:    () => apiError(400, 'invalid_expected_version'),
  versionConflict:           (current: unknown, expected: number, found: number) =>
    NextResponse.json(
      {
        error: 'version_conflict',
        message: `Node was modified by another writer; expected version ${expected}, found ${found}.`,
        current,
      },
      { status: 409 },
    ),

  // Phase 4 — context-node CRUD + linking (T-3.2)
  invalidScope:              () => apiError(400, 'invalid_scope'),
  scopeDocumentMismatch:     () => apiError(400, 'scope_document_mismatch'),
  documentNotInProject:      () => apiError(400, 'document_not_in_project'),
  invalidLinkSource:         () => apiError(400, 'invalid_link_source'),
  invalidLinkTarget:         () => apiError(400, 'invalid_link_target'),
  linkCrossProject:          () => apiError(400, 'link_cross_project'),
  linkCrossDocument:         () => apiError(400, 'link_cross_document'),
  invalidMoveTarget:         () => apiError(400, 'invalid_move_target'),
  linkAlreadyExists:         (link: unknown) =>
    NextResponse.json(
      {
        error: 'link_already_exists',
        message: 'Link already exists between these nodes.',
        link,
      },
      { status: 409 },
    ),
  cannotDeleteWithBackLinks: (count: number) =>
    NextResponse.json(
      {
        error: 'cannot_delete_with_back_links',
        message: `Context node has ${count} incoming links. Pass ?force=true to cascade.`,
        back_links_count: count,
      },
      { status: 409 },
    ),
  linkNotFound:              () => apiError(404, 'link_not_found'),
  contextNodeNotFound:       () => apiError(404, 'context_node_not_found'),
  documentNotFound:          () => apiError(404, 'document_not_found'),
  projectNotFound:           () => apiError(404, 'project_not_found'),

  // Phase 5 — agent system (API Contract v1.2 §2.3)
  tokenBudgetExceeded:           () => apiError(402, 'token_budget_exceeded'),
  injectionBlocked:              () => apiError(422, 'injection_blocked'),
  outputSchemaInvalid:           () => apiError(422, 'output_schema_invalid'),
  llmProviderError:              () => apiError(503, 'llm_provider_error'),
  canaryLeakDetected:            () => apiError(422, 'canary_leak_detected'),
  agentJobInProgress:            () => apiError(409, 'agent_job_in_progress'),
  agentJobNotInProgress:         () => apiError(409, 'agent_job_not_in_progress'),
  agentJobAlreadyTerminal:       (status: string) =>
    NextResponse.json(
      { error: 'agent_job_already_terminal', current_status: status },
      { status: 409 },
    ),
  notALeafNode:                  () => apiError(400, 'not_a_leaf_node'),
  invalidTargetField:            () => apiError(400, 'invalid_target_field'),
  invalidOperationForNodeType:   () => apiError(400, 'invalid_operation_for_node_type'),
  targetVersionMismatch:         (current: number, captured: number) =>
    NextResponse.json(
      { error: 'target_version_mismatch', current_version: current, captured_version: captured },
      { status: 409 },
    ),
  commentThreadTooDeep:          () => apiError(400, 'comment_thread_too_deep'),
  commentNotInNode:              () => apiError(400, 'comment_not_in_node'),
  notCommentAuthor:              () => apiError(403, 'not_comment_author'),
  cannotEditAgentComment:        () => apiError(400, 'cannot_edit_agent_comment'),
  agentProfileNotFound:          () => apiError(404, 'agent_profile_not_found'),
  profileOperationMismatch:      () => apiError(400, 'profile_operation_mismatch'),
  invalidTargetLayerCount:       () => apiError(400, 'invalid_target_layer_count'),
  invalidProseTargetWords:       () => apiError(400, 'invalid_prose_target_words'),
  invalidRefinementInstruction:  () => apiError(400, 'invalid_refinement_instruction'),
  refineEmptyField:              () => apiError(400, 'refine_empty_field'),
  invalidCommentType:            () => apiError(400, 'invalid_comment_type'),
  invalidContent:                () => apiError(400, 'invalid_content'),
}
