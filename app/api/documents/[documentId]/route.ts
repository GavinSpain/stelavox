import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { err } from '@/lib/api/errors'
import { isValidUuid } from '@/lib/validation/uuid'
import { documentPatchSchema } from '@/lib/validation/documents'
import { getDocument, updateDocument, deleteDocument } from '@/lib/data/documents'

interface Context { params: Promise<{ documentId: string }> }

export async function GET(_request: NextRequest, { params }: Context) {
  try {
    const { documentId } = await params
    if (!isValidUuid(documentId)) return err.invalidUuid()

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return err.unauthorised()

    const { data } = await getDocument(supabase, documentId)
    if (!data) return err.notFound()

    return NextResponse.json({ document: data })
  } catch {
    return err.internal()
  }
}

export async function PATCH(request: NextRequest, { params }: Context) {
  try {
    const { documentId } = await params
    if (!isValidUuid(documentId)) return err.invalidUuid()

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return err.unauthorised()

    let body: unknown
    try { body = await request.json() } catch { return err.invalidJson() }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return err.missingBody()
    if (Object.keys(body as object).length === 0) return err.emptyUpdate()

    const parsed = documentPatchSchema.safeParse(body)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      if (issue?.path[0] === 'name') return err.invalidName()
      if (issue?.path[0] === 'description') return err.invalidDescription()
      if (issue?.path[0] === 'status') return err.invalidStatus()
      if (issue?.path[0] === 'authors') return err.invalidAuthors()
      if (issue?.code === 'unrecognized_keys') return err.unknownField(String(issue.keys?.[0] ?? ''))
      return err.invalidName()
    }

    const { data: existing } = await getDocument(supabase, documentId)
    if (!existing) return err.notFound()

    const { data, error } = await updateDocument(supabase, documentId, parsed.data)
    if (error) return err.internal()

    return NextResponse.json({ document: data })
  } catch {
    return err.internal()
  }
}

export async function DELETE(request: NextRequest, { params }: Context) {
  try {
    const { documentId } = await params
    if (!isValidUuid(documentId)) return err.invalidUuid()

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return err.unauthorised()

    const bodyText = await request.text()
    if (bodyText.trim()) return err.unexpectedBody()

    const { data: existing } = await getDocument(supabase, documentId)
    if (!existing) return err.notFound()

    const { error } = await deleteDocument(supabase, documentId)
    if (error) return err.internal()

    return NextResponse.json({ deleted: true, document_id: documentId })
  } catch {
    return err.internal()
  }
}
