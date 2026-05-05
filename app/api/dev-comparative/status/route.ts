// Comparative-build status reporter — counts jobs per document and reports
// per-book progress + total cost. Used by the operator (and the agent
// supervising the build) to know when the chain is complete.

import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/service'

export async function GET(request: NextRequest) {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'not_in_production' }, { status: 403 })
  }

  const projectId = request.nextUrl.searchParams.get('project_id')
  if (!projectId) {
    return NextResponse.json({ error: 'project_id required' }, { status: 400 })
  }

  const supabase = createServiceRoleClient()

  // List the 3 documents
  const { data: docs } = await supabase
    .from('documents')
    .select('id, name')
    .eq('project_id', projectId)
    .order('created_at', { ascending: true })

  if (!docs || docs.length === 0) {
    return NextResponse.json({ error: 'project_not_found_or_empty' }, { status: 404 })
  }

  const perDoc = await Promise.all(
    docs.map(async (doc) => {
      const { data: jobs } = await supabase
        .from('agent_jobs')
        .select('status, operation_type, model_id, cost_usd, tokens_input, tokens_output, error_message')
        .eq('document_id', doc.id)
        .order('created_at', { ascending: true })

      const all = jobs ?? []
      const accepted = all.filter((j) => j.status === 'accepted')
      const failed = all.filter((j) => j.status === 'failed')
      const inProgress = all.filter((j) => j.status === 'pending' || j.status === 'running' || j.status === 'completed')

      const totalCost = all.reduce((sum, j) => sum + (j.cost_usd ?? 0), 0)
      const totalIn = all.reduce((sum, j) => sum + (j.tokens_input ?? 0), 0)
      const totalOut = all.reduce((sum, j) => sum + (j.tokens_output ?? 0), 0)

      const expanded = accepted.filter((j) => j.operation_type === 'expand').length
      const synthesised = accepted.filter((j) => j.operation_type === 'synthesise').length

      return {
        document: doc.name,
        document_id: doc.id,
        model: all[0]?.model_id ?? null,
        accepted: accepted.length,
        failed: failed.length,
        in_progress: inProgress.length,
        operations: { expand_accepted: expanded, synthesise_accepted: synthesised },
        cost_usd: parseFloat(totalCost.toFixed(6)),
        tokens: { input: totalIn, output: totalOut, total: totalIn + totalOut },
        recent_errors: failed.slice(-3).map((j) => j.error_message),
      }
    }),
  )

  const grandTotal = perDoc.reduce((sum, d) => sum + d.cost_usd, 0)
  const allDone = perDoc.every((d) => d.in_progress === 0 && d.operations.synthesise_accepted >= 1 && d.operations.expand_accepted >= 4)

  return NextResponse.json({
    project_id: projectId,
    all_done: allDone,
    grand_total_usd: parseFloat(grandTotal.toFixed(6)),
    per_document: perDoc,
  })
}
