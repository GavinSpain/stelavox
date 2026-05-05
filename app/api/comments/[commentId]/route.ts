// Spec: stelavox_phase5_api_contract_v1_0.md v1.2 §3.12 (PATCH), §3.14 (DELETE)
//       stelavox_phase5_test_plan_v1_0.md TC-A-45..TC-A-47, TC-A-50..TC-A-53
//       stelavox_phase5_build_checklist_v1_0.md T-10.3, T-10.5

import { NextRequest, NextResponse } from 'next/server'

import { err } from '@/lib/api/errors'
import {
  hasHighSeverityMatch,
  logScanMatches,
  scanContent,
} from '@/lib/security/injection-scanner'
import { createClient } from '@/lib/supabase/server'
import { commentPatchBodySchema } from '@/lib/validation/agent-operations'
import { isValidUuid } from '@/lib/validation/uuid'

interface Context { params: Promise<{ commentId: string }> }

const COMMENT_SELECT = `
  id, node_id, parent_comment_id, author_type, author_label, agent_job_id,
  comment_type, content, resolved, resolved_at, resolved_by, created_at
`.trim()

// ─── PATCH — edit own comment content ─────────────────────────────────────

export async function PATCH(request: NextRequest, { params }: Context) {
  const { commentId } = await params
  if (!isValidUuid(commentId)) return err.invalidUuid()

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return err.unauthorised()

  const ct = request.headers.get('content-type') ?? ''
  if (!ct.includes('application/json')) return err.invalidJson()

  let body: unknown
  try { body = await request.json() } catch { return err.invalidJson() }
  if (!body) return err.missingBody()

  const parsed = commentPatchBodySchema.safeParse(body)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    if (issue?.code === 'unrecognized_keys') {
      const keys = (issue as { keys?: unknown[] }).keys
      return err.unknownField(String(keys?.[0] ?? ''))
    }
    return err.invalidContent()
  }

  const scan = scanContent(parsed.data.content)
  logScanMatches(scan, { fieldName: 'comment.content', userId: user.id })
  if (hasHighSeverityMatch(scan)) return err.injectionBlocked()

  // Comment exists + visible
  const { data: comment } = await supabase
    .from('node_comments')
    .select('id, author_type, author_label, node_id')
    .eq('id', commentId)
    .maybeSingle()
  if (!comment) return err.notFound()

  // Cannot edit agent comment
  if (comment.author_type !== 'human') return err.cannotEditAgentComment()

  // Author check
  if (comment.author_label !== user.id) return err.notCommentAuthor()

  const { data: updated, error: updateErr } = await supabase
    .from('node_comments')
    .update({ content: parsed.data.content })
    .eq('id', commentId)
    .select(COMMENT_SELECT)
    .single()
  if (updateErr || !updated) return err.internal()
  return NextResponse.json(updated)
}

// ─── DELETE — author or org owner ─────────────────────────────────────────

export async function DELETE(_request: NextRequest, { params }: Context) {
  const { commentId } = await params
  if (!isValidUuid(commentId)) return err.invalidUuid()

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return err.unauthorised()

  const { data: comment } = await supabase
    .from('node_comments')
    .select('id, author_label, organisation_id')
    .eq('id', commentId)
    .maybeSingle()
  if (!comment) return err.notFound()

  // Author or org owner
  if (comment.author_label !== user.id) {
    const { data: membership } = await supabase
      .from('organisation_members')
      .select('role')
      .eq('organisation_id', comment.organisation_id)
      .eq('user_id', user.id)
      .maybeSingle()
    if (!membership || membership.role !== 'owner') return err.notCommentAuthor()
  }

  // Count children for response (cascades via Migration 026 FK)
  const { count: childCount } = await supabase
    .from('node_comments')
    .select('*', { count: 'exact', head: true })
    .eq('parent_comment_id', commentId)

  const { error: deleteErr } = await supabase
    .from('node_comments')
    .delete()
    .eq('id', commentId)
  if (deleteErr) return err.internal()

  return NextResponse.json({
    deleted: true,
    comment_id: commentId,
    child_comments_deleted: childCount ?? 0,
  })
}
