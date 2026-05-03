import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { err } from '@/lib/api/errors'
import { projectPostSchema } from '@/lib/validation/projects'
import { getOrgId, createProject, listProjects } from '@/lib/data/projects'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return err.unauthorised()

    const orgId = await getOrgId(supabase)
    if (!orgId) return err.noOrganisation()

    const contentType = request.headers.get('content-type') ?? ''
    if (!contentType.includes('application/json')) return err.invalidJson()

    let body: unknown
    try { body = await request.json() } catch { return err.invalidJson() }
    if (body === null || body === undefined || body === '') return err.missingBody()

    const parsed = projectPostSchema.safeParse(body)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      if (issue?.path[0] === 'name') return err.invalidName()
      if (issue?.path[0] === 'description') return err.invalidDescription()
      if (issue?.path[0] === 'default_document_type') return err.invalidDocumentType()
      if (issue?.code === 'unrecognized_keys') return err.unknownField(String(issue.keys?.[0] ?? ''))
      return err.invalidName()
    }

    const { data, error } = await createProject(supabase, orgId, parsed.data)
    if (error) return err.internal()

    return NextResponse.json({ project: data }, { status: 201 })
  } catch {
    return err.internal()
  }
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return err.unauthorised()

    const orgId = await getOrgId(supabase)
    if (!orgId) return err.noOrganisation()

    const { searchParams } = new URL(request.url)
    for (const key of searchParams.keys()) {
      if (key !== 'status') return err.unknownParam()
    }
    if (searchParams.has('status')) return err.unknownParam()

    const { data, error } = await listProjects(supabase)
    if (error) return err.internal()

    return NextResponse.json({ projects: data ?? [] })
  } catch {
    return err.internal()
  }
}
