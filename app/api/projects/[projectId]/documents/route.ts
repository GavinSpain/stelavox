import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { err } from '@/lib/api/errors'
import { isValidUuid } from '@/lib/validation/uuid'
import { documentPostSchema } from '@/lib/validation/documents'
import { getOrgId, getProject } from '@/lib/data/projects'
import { createDocumentWithLayerStack, listDocuments } from '@/lib/data/documents'

interface Context { params: Promise<{ projectId: string }> }

const VALID_STATUSES = new Set(['active', 'archived', 'published'])

export async function POST(request: NextRequest, { params }: Context) {
  try {
    const { projectId } = await params
    if (!isValidUuid(projectId)) return err.invalidUuid()

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return err.unauthorised()

    const orgId = await getOrgId(supabase)
    if (!orgId) return err.noOrganisation()

    const { data: project } = await getProject(supabase, projectId)
    if (!project) return err.notFound('project_not_found')

    const contentType = request.headers.get('content-type') ?? ''
    if (!contentType.includes('application/json')) return err.invalidJson()

    let body: unknown
    try { body = await request.json() } catch { return err.invalidJson() }
    if (!body) return err.missingBody()

    const parsed = documentPostSchema.safeParse(body)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      if (issue?.path[0] === 'name') return err.invalidName()
      if (issue?.path[0] === 'description') return err.invalidDescription()
      if (issue?.path[0] === 'document_type') return err.invalidDocumentType()
      if (issue?.path[0] === 'authors') return err.invalidAuthors()
      if (issue?.code === 'unrecognized_keys') return err.unknownField(String(issue.keys?.[0] ?? ''))
      return err.invalidName()
    }

    const { data: rpcResult, error: rpcError } = await createDocumentWithLayerStack(supabase, {
      project_id:      projectId,
      organisation_id: orgId,
      name:            parsed.data.name,
      description:     parsed.data.description ?? null,
      document_type:   parsed.data.document_type,
      authors:         parsed.data.authors ?? [],
    })

    if (rpcError) {
      if (rpcError.message?.includes('missing_template')) return err.missingTemplate()
      return err.internal()
    }

    const result = rpcResult as { document: unknown; layer_stack: unknown }
    return NextResponse.json({ document: result.document, layer_stack: result.layer_stack }, { status: 201 })
  } catch {
    return err.internal()
  }
}

export async function GET(request: NextRequest, { params }: Context) {
  try {
    const { projectId } = await params
    if (!isValidUuid(projectId)) return err.invalidUuid()

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return err.unauthorised()

    const { searchParams } = new URL(request.url)
    for (const key of searchParams.keys()) {
      if (key !== 'status') return err.unknownParam()
    }
    const statusParam = searchParams.get('status')
    if (statusParam && !VALID_STATUSES.has(statusParam)) return err.invalidStatus()

    await getOrgId(supabase) // org existence check

    const { data: project } = await getProject(supabase, projectId)
    if (!project) return err.notFound('project_not_found')

    const { data, error } = await listDocuments(supabase, projectId, statusParam ?? undefined)
    if (error) return err.internal()

    return NextResponse.json({ documents: data ?? [] })
  } catch {
    return err.internal()
  }
}
