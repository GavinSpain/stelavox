// Spec: stelavox_phase5_api_contract_v1_0.md v1.2 §3.13 (POST resolve)
//       stelavox_phase5_test_plan_v1_0.md TC-A-48 / TC-A-49
//       stelavox_phase5_build_checklist_v1_0.md T-10.4

import { NextRequest, NextResponse } from 'next/server'

import { err } from '@/lib/api/errors'
import { createClient } from '@/lib/supabase/server'
import { isValidUuid } from '@/lib/validation/uuid'

interface Context { params: Promise<{ commentId: string }> }

const COMMENT_SELECT = `
  id, node_id, parent_comment_id, author_type, author_label, agent_job_id,
  comment_type, content, resolved, resolved_at, resolved_by, created_at
`.trim()

export async function POST(_request: NextRequest, { params }: Context) {
  const { commentId } = await params
  if (!isValidUuid(commentId)) return err.invalidUuid()

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return err.unauthorised()

  const { data: comment } = await supabase
    .from('node_comments')
    .select('id, resolved')
    .eq('id', commentId)
    .maybeSingle()
  if (!comment) return err.notFound()

  // Idempotent on already-resolved
  if (comment.resolved) {
    const { data } = await supabase.from('node_comments').select(COMMENT_SELECT).eq('id', commentId).single()
    return NextResponse.json(data)
  }

  const { data: updated, error: updateErr } = await supabase
    .from('node_comments')
    .update({
      resolved: true,
      resolved_at: new Date().toISOString(),
      resolved_by: user.id,
    })
    .eq('id', commentId)
    .select(COMMENT_SELECT)
    .single()
  if (updateErr || !updated) return err.internal()
  return NextResponse.json(updated)
}
