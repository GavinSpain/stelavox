// Spec: stelavox_phase5_api_contract_v1_0.md v1.2 §3.10 (POST), §3.11 (GET)
//       stelavox_phase5_test_plan_v1_0.md TC-A-39..TC-A-44
//       stelavox_phase5_build_checklist_v1_0.md T-10.1, T-10.2

import { NextRequest, NextResponse } from 'next/server'

import { err } from '@/lib/api/errors'
import { getNode } from '@/lib/data/nodes'
import {
  hasHighSeverityMatch,
  logScanMatches,
  scanContent,
} from '@/lib/security/injection-scanner'
import { createClient } from '@/lib/supabase/server'
import { commentCreateBodySchema } from '@/lib/validation/agent-operations'
import { isValidUuid } from '@/lib/validation/uuid'

interface Context { params: Promise<{ nodeId: string }> }

const COMMENT_SELECT = `
  id, node_id, parent_comment_id, author_type, author_label, agent_job_id,
  comment_type, content, resolved, resolved_at, resolved_by, created_at
`.trim()

// ─── POST — create comment ────────────────────────────────────────────────

export async function POST(request: NextRequest, { params }: Context) {
  const { nodeId } = await params
  if (!isValidUuid(nodeId)) return err.invalidUuid()

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return err.unauthorised()

  const ct = request.headers.get('content-type') ?? ''
  if (!ct.includes('application/json')) return err.invalidJson()

  let body: unknown
  try { body = await request.json() } catch { return err.invalidJson() }
  if (!body) return err.missingBody()

  const parsed = commentCreateBodySchema.safeParse(body)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    if (issue?.code === 'unrecognized_keys') {
      const keys = (issue as { keys?: unknown[] }).keys
      return err.unknownField(String(keys?.[0] ?? ''))
    }
    if (issue?.path?.[0] === 'comment_type') return err.invalidCommentType()
    if (issue?.path?.[0] === 'content') return err.invalidContent()
    if (issue?.path?.[0] === 'parent_comment_id') return err.invalidUuid()
    return err.invalidUuid()
  }
  const data = parsed.data

  // Injection scan on content (per §3.10 step 6)
  const scan = scanContent(data.content)
  logScanMatches(scan, { fieldName: 'comment.content', nodeId, userId: user.id })
  if (hasHighSeverityMatch(scan)) return err.injectionBlocked()

  // Target node exists, is visible
  const { data: node } = await getNode(supabase, nodeId)
  if (!node) return err.notFound()

  // Depth-1 enforcement (G-5)
  if (data.parent_comment_id) {
    const { data: parent } = await supabase
      .from('node_comments')
      .select('id, node_id, parent_comment_id')
      .eq('id', data.parent_comment_id)
      .maybeSingle()
    if (!parent) return err.commentNotInNode()
    if (parent.node_id !== nodeId) return err.commentNotInNode()
    if (parent.parent_comment_id !== null) return err.commentThreadTooDeep()
  }

  // Phase 6 D-A: comments are EXCLUDED from the lock domain. Adding a
  // comment is a sibling-artefact write, not a write on the node's
  // content / structure / status / tree position. Locked nodes still
  // accept comments. (Editorial discussion shouldn't be blocked by a
  // protective lock.)

  // INSERT
  const { data: created, error: insertErr } = await supabase
    .from('node_comments')
    .insert({
      node_id: nodeId,
      organisation_id: node.organisation_id,
      parent_comment_id: data.parent_comment_id ?? null,
      author_type: 'human',
      author_label: user.id,
      comment_type: data.comment_type,
      content: data.content,
      resolved: false,
    })
    .select(COMMENT_SELECT)
    .single()
  if (insertErr || !created) {
    console.error('[comments POST] insert error', insertErr)
    return err.internal()
  }

  return NextResponse.json(created, { status: 201 })
}

// ─── GET — list comments on a node ────────────────────────────────────────

export async function GET(_request: NextRequest, { params }: Context) {
  const { nodeId } = await params
  if (!isValidUuid(nodeId)) return err.invalidUuid()

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return err.unauthorised()

  const { data: node } = await getNode(supabase, nodeId)
  if (!node) return err.notFound()

  const { data, error } = await supabase
    .from('node_comments')
    .select(COMMENT_SELECT)
    .eq('node_id', nodeId)
    .order('created_at', { ascending: true })
  if (error) {
    console.error('[comments GET] error', error)
    return err.internal()
  }

  return NextResponse.json({ comments: data ?? [], total: data?.length ?? 0 })
}
