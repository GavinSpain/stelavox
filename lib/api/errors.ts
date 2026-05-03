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
}
