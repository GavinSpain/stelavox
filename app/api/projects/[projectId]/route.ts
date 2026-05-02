import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { err } from '@/lib/api/errors'
import { isValidUuid } from '@/lib/validation/uuid'
import { projectPatchSchema } from '@/lib/validation/projects'
import { getOrgId, getProject, updateProject, deleteProject } from '@/lib/data/projects'

interface Context { params: Promise<{ projectId: string }> }

export async function GET(_request: NextRequest, { params }: Context) {
  try {
    const { projectId } = await params
    if (!isValidUuid(projectId)) return err.invalidUuid()

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return err.unauthorised()

    const { data } = await getProject(supabase, projectId)
    if (!data) return err.notFound()

    return NextResponse.json({ project: data })
  } catch {
    return err.internal()
  }
}

export async function PATCH(request: NextRequest, { params }: Context) {
  try {
    const { projectId } = await params
    if (!isValidUuid(projectId)) return err.invalidUuid()

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return err.unauthorised()

    await getOrgId(supabase) // org existence check

    let body: unknown
    try { body = await request.json() } catch { return err.invalidJson() }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return err.missingBody()
    if (Object.keys(body as object).length === 0) return err.emptyUpdate()

    const parsed = projectPatchSchema.safeParse(body)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      if (issue?.path[0] === 'name') return err.invalidName()
      if (issue?.path[0] === 'description') return err.invalidDescription()
      if (issue?.path[0] === 'default_document_type') return err.invalidDocumentType()
      if (issue?.code === 'unrecognized_keys') return err.unknownField(String(issue.keys?.[0] ?? ''))
      return err.invalidName()
    }

    const { data: existing } = await getProject(supabase, projectId)
    if (!existing) return err.notFound()

    const { data, error } = await updateProject(supabase, projectId, parsed.data)
    if (error) return err.internal()

    return NextResponse.json({ project: data })
  } catch {
    return err.internal()
  }
}

export async function DELETE(request: NextRequest, { params }: Context) {
  try {
    const { projectId } = await params
    if (!isValidUuid(projectId)) return err.invalidUuid()

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return err.unauthorised()

    const bodyText = await request.text()
    if (bodyText.trim()) return err.unexpectedBody()

    const { data: existing } = await getProject(supabase, projectId)
    if (!existing) return err.notFound()

    const { error } = await deleteProject(supabase, projectId)
    if (error) return err.internal()

    return NextResponse.json({ deleted: true, project_id: projectId })
  } catch {
    return err.internal()
  }
}
