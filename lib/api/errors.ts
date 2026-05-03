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
}
