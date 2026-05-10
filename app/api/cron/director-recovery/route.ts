/**
 * POST /api/cron/director-recovery — Vercel Cron recovery sweep.
 *
 * Source: stelavox_phase5b_api_contract_v1_0.md §3.13 / I-11 (v1.1).
 * Build Checklist: T-19.2.
 *
 * Runs every 60 seconds via vercel.json crons schedule. Detects:
 *   1. agent_jobs with status='running' whose last_heartbeat_at is
 *      older than agent.heartbeat_timeout_ms (default 120s) and which
 *      started >2 minutes ago → marked failed with
 *      error_message='heartbeat_timeout'.
 *   2. workflows with status='running' whose last_heartbeat_at is older
 *      than workflow.heartbeat_timeout_ms (default 300s) → marked
 *      paused with error_message='heartbeat_timeout'.
 *   3. conversation_messages with turn_state='interim' whose created_at
 *      is older than agent.heartbeat_timeout_ms → marked 'interrupted'.
 *      (F-196 round-3 audit fix: comment originally said 'updated_at'
 *      but conversation_messages has no updated_at column. The
 *      created_at filter sweeps interim rows by their dispatch age.
 *      A long-running streaming Director turn that produces text
 *      successfully for >timeout would still be flagged stuck — that's
 *      a known limitation. Pre-fix the comment lied; now it documents
 *      the actual behavior.)
 *
 * For each newly-failed agent_job whose triggered_by encodes a
 * workflow_step, calls advanceWorkflow() so the workflow transitions
 * cleanly.
 *
 * Auth: Authorization: Bearer <CRON_SECRET>. Vercel Cron sets this
 * automatically; route returns 401 otherwise.
 */

import 'server-only'

import { NextResponse, type NextRequest } from 'next/server'

import { getConfigInt } from '@/lib/config/platform-config'
import { advanceWorkflow } from '@/lib/director/workflow-executor'
import { createServiceRoleClient } from '@/lib/supabase/service'

export async function POST(req: NextRequest): Promise<Response> {
  // ---- Auth gate -------------------------------------------------------
  const authHeader = req.headers.get('authorization')
  const expected = process.env.CRON_SECRET
  if (!expected) {
    return NextResponse.json(
      { error: 'cron_secret_not_configured' },
      { status: 500 },
    )
  }
  if (authHeader !== `Bearer ${expected}`) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }

  const supabase = createServiceRoleClient()

  // ---- Load timeouts ---------------------------------------------------
  const jobTimeoutMs = await getConfigInt('agent.heartbeat_timeout_ms')
  const wfTimeoutMs = await getConfigInt('workflow.heartbeat_timeout_ms')
  const now = Date.now()
  const jobCutoff = new Date(now - jobTimeoutMs).toISOString()
  const wfCutoff = new Date(now - wfTimeoutMs).toISOString()
  // 2-minute grace window before a fresh job is eligible for sweep.
  const startedCutoff = new Date(now - 120_000).toISOString()

  // ---- 1. Orphaned agent_jobs -----------------------------------------
  // Two-step pattern so we can fan out advanceWorkflow() calls. SELECT
  // candidates first; UPDATE; then iterate triggered_by for workflow IDs.
  const { data: orphans } = await supabase
    .from('agent_jobs')
    .select('id, triggered_by, last_heartbeat_at, started_at')
    .eq('status', 'running')
    .lt('started_at', startedCutoff)
    .or(`last_heartbeat_at.is.null,last_heartbeat_at.lt.${jobCutoff}`)

  let agentJobsFailed = 0
  const workflowIdsToAdvance = new Set<string>()
  for (const job of orphans ?? []) {
    const { error } = await supabase
      .from('agent_jobs')
      .update({
        status: 'failed',
        error_message: 'heartbeat_timeout',
        completed_at: new Date().toISOString(),
      })
      .eq('id', job.id)
      .eq('status', 'running') // CAS — only update if still running
    if (!error) {
      agentJobsFailed++
      const tb = (job as { triggered_by: string | null }).triggered_by
      if (tb && tb.startsWith('workflow_step:')) {
        const parts = tb.split(':')
        if (parts.length >= 3) workflowIdsToAdvance.add(parts[2])
      }
    }
  }

  // ---- 2. Stalled workflows -------------------------------------------
  const { data: stalledWfs } = await supabase
    .from('workflows')
    .select('id')
    .eq('status', 'running')
    .or(`last_heartbeat_at.is.null,last_heartbeat_at.lt.${wfCutoff}`)

  let workflowsPaused = 0
  for (const wf of stalledWfs ?? []) {
    const { error } = await supabase
      .from('workflows')
      .update({
        status: 'paused',
        error_message: 'heartbeat_timeout',
      })
      .eq('id', wf.id)
      .eq('status', 'running')
    if (!error) workflowsPaused++
  }

  // ---- 3. Stuck interim assistant messages -----------------------------
  const { data: stuckInterims } = await supabase
    .from('conversation_messages')
    .select('id')
    .eq('turn_state', 'interim')
    .lt('created_at', jobCutoff)

  let conversationsInterrupted = 0
  for (const m of stuckInterims ?? []) {
    const { error } = await supabase
      .from('conversation_messages')
      .update({ turn_state: 'interrupted' })
      .eq('id', m.id)
      .eq('turn_state', 'interim')
    if (!error) conversationsInterrupted++
  }

  // ---- 4. advanceWorkflow for each newly-failed-step's workflow -------
  for (const wfId of workflowIdsToAdvance) {
    try {
      await advanceWorkflow(wfId)
    } catch (err) {
      console.error('[cron-recovery] advanceWorkflow failed', {
        workflow: wfId,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return NextResponse.json({
    agent_jobs_failed: agentJobsFailed,
    workflows_paused: workflowsPaused,
    conversations_interrupted: conversationsInterrupted,
    ran_at: new Date().toISOString(),
  })
}
