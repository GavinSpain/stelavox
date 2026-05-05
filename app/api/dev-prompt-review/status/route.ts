import { NextRequest, NextResponse } from 'next/server'
import { readdir, readFile } from 'fs/promises'
import { join } from 'path'

import { createServiceRoleClient } from '@/lib/supabase/service'

export async function GET(request: NextRequest) {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'not_in_production' }, { status: 403 })
  }

  const projectId = request.nextUrl.searchParams.get('project_id')
  if (!projectId) return NextResponse.json({ error: 'project_id required' }, { status: 400 })

  const supabase = createServiceRoleClient()

  const { data: docs } = await supabase
    .from('documents').select('id').eq('project_id', projectId).limit(1).maybeSingle()
  if (!docs) return NextResponse.json({ error: 'project_not_found' }, { status: 404 })

  const { data: jobs } = await supabase
    .from('agent_jobs').select('status, operation_type, profile_id, cost_usd, tokens_input, tokens_output, error_message')
    .eq('document_id', docs.id)

  // Also include jobs for this project's context nodes (not document-scoped)
  const { data: ctxNodes } = await supabase
    .from('nodes').select('id').eq('project_id', projectId).eq('node_category', 'context')
  const ctxIds = (ctxNodes ?? []).map((n) => n.id)
  let ctxJobs: typeof jobs = []
  if (ctxIds.length > 0) {
    const { data: cj } = await supabase
      .from('agent_jobs').select('status, operation_type, profile_id, cost_usd, tokens_input, tokens_output, error_message')
      .in('node_id', ctxIds)
    ctxJobs = cj ?? []
  }

  const all = [...(jobs ?? []), ...ctxJobs]
  const total = all.length
  const completed = all.filter((j) => j.status === 'accepted' || j.status === 'completed' || j.status === 'failed').length
  const failed = all.filter((j) => j.status === 'failed').length
  const totalCost = all.reduce((s, j) => s + (j.cost_usd ?? 0), 0)
  const totalIn = all.reduce((s, j) => s + (j.tokens_input ?? 0), 0)
  const totalOut = all.reduce((s, j) => s + (j.tokens_output ?? 0), 0)

  // Look for the latest report
  let latestReport: string | null = null
  let reportContent: string | null = null
  try {
    const files = await readdir('test-reports')
    const reports = files.filter((f) => f.startsWith('prompt-review-')).sort().reverse()
    if (reports[0]) {
      latestReport = `test-reports/${reports[0]}`
      reportContent = await readFile(join('test-reports', reports[0]), 'utf-8')
    }
  } catch {
    // test-reports/ may not exist yet
  }

  return NextResponse.json({
    project_id: projectId,
    progress: { total, completed, failed, in_progress: total - completed },
    cost_usd: parseFloat(totalCost.toFixed(6)),
    tokens: { input: totalIn, output: totalOut, total: totalIn + totalOut },
    all_done: total >= 14 && completed >= 14,  // 14 cases per the harness
    latest_report_path: latestReport,
    latest_report_content: reportContent ? reportContent.slice(0, 50000) : null,
  })
}
