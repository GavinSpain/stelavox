import 'server-only'

/**
 * V1.x-F.3 — workflow_expand synthetic probe.
 *
 * Source: stelavox_v1x_f_build_checklist_v1_1.md §3 +
 *         lib/admin/probes/runner.ts (replaces V1.x-E.2 stub).
 *
 * Exercises the full expand pipeline end-to-end against probe-fixture
 * data seeded by scripts/seed-probe-fixtures.ts:
 *   1. Look up the probe org / document / expand target from
 *      platform_config (the seed script writes these pointers).
 *   2. Snapshot any pre-existing children of the target.
 *   3. Insert an agent_jobs row + invoke runAgentJob() inline (no
 *      dispatcher coupling — the probe wants synchronous outcome).
 *   4. Read the resulting job row; record tokens/cost/duration.
 *   5. Cleanup: delete any children created by this run + delete the
 *      probe job row so the probe is idempotent across re-runs.
 *
 * The probe returns `outcome='fail'` gracefully (no throw) when the
 * fixtures are absent — admin operators see a clear
 * `probe_fixtures_not_seeded` error message rather than an unhandled
 * exception.
 */

import { runAgentJob } from '@/lib/agent/runner'
import { getConfig } from '@/lib/config/platform-config'
import { createServiceRoleClient } from '@/lib/supabase/service'

import type { ProbeRunResult } from './runner'

const PROBE_TRIGGER_TAG = 'synthetic_probe:workflow_expand'

/** Tolerant config read — returns null when the key is absent. */
async function readFixturePointer(key: string): Promise<string | null> {
  try {
    const v = await getConfig<string>(key)
    return typeof v === 'string' && v.length > 0 ? v : null
  } catch {
    return null
  }
}

export async function runWorkflowExpandProbe(): Promise<ProbeRunResult> {
  const svc = createServiceRoleClient()

  const orgId = await readFixturePointer('probe.fixture.organisation_id')
  const documentId = await readFixturePointer('probe.fixture.document_id')
  const targetNodeId = await readFixturePointer('probe.fixture.expand_target_node_id')

  if (!orgId || !documentId || !targetNodeId) {
    return fixturesMissing(
      'workflow_expand probe missing fixture pointer(s) in platform_config — run scripts/seed-probe-fixtures.ts first.',
    )
  }

  // Snapshot the target + its existing children. Existing children are
  // preserved on cleanup; only the IDs created by this run are removed.
  const { data: target } = await svc
    .from('nodes')
    .select('id, node_type, version, organisation_id, document_id')
    .eq('id', targetNodeId)
    .maybeSingle()
  if (!target || target.organisation_id !== orgId || target.document_id !== documentId) {
    return fixturesMissing('expand_target_node_id resolves outside the probe org/document')
  }

  const { data: existingChildren } = await svc
    .from('nodes')
    .select('id')
    .eq('parent_id', targetNodeId)
  const preExistingChildIds = new Set((existingChildren ?? []).map((r: { id: string }) => r.id))

  // Resolve the expand profile for this node_type.
  const { data: profile } = await svc
    .from('agent_profiles')
    .select('id, model_id, max_tokens, operation_type, node_type')
    .eq('is_system_profile', true)
    .eq('operation_type', 'expand')
    .eq('node_type', target.node_type)
    .maybeSingle()
  if (!profile) {
    return failedSetup('no_system_expand_profile_for_target_node_type', {
      node_type: target.node_type,
    })
  }

  // Insert the job + invoke runner inline.
  const startedAt = Date.now()
  const { data: jobRow, error: insertErr } = await svc
    .from('agent_jobs')
    .insert({
      organisation_id: orgId,
      node_id: targetNodeId,
      document_id: documentId,
      profile_id: profile.id,
      operation_type: 'expand',
      operation_class: 'single_node',
      status: 'pending',
      triggered_by: PROBE_TRIGGER_TAG,
      target_node_version_at_capture: target.version,
      context_snapshot: {
        dynamic: {
          agent_instruction:
            'Synthetic probe expand — propose 3 brief child scenes for this chapter. Keep titles short.',
          target_layer_count: 1,
        },
      },
      created_at: new Date().toISOString(),
    })
    .select('id')
    .single()
  if (insertErr || !jobRow) {
    return failedSetup('probe_job_insert_failed', { error: insertErr?.message ?? 'unknown' })
  }
  const jobId = jobRow.id as string

  // Inline run — runAgentJob handles status transitions + LLM call +
  // result persistence. Any thrown error is captured by the outer
  // try/catch in runner.ts's runProbe.
  await runAgentJob(jobId)
  const durationMs = Date.now() - startedAt

  // Read final state.
  const { data: finalJob } = await svc
    .from('agent_jobs')
    .select(
      'id, status, result_child_nodes, tokens_input_total, tokens_output_total, cost_credits, failure_class, error_message',
    )
    .eq('id', jobId)
    .single()

  const succeeded =
    finalJob?.status === 'completed' &&
    Array.isArray(finalJob.result_child_nodes) &&
    finalJob.result_child_nodes.length > 0

  // Cleanup: delete any children created during this run (the runner
  // may have created node rows directly for some operations; for expand
  // the children are proposed in result_child_nodes and not committed
  // until accept_agent_job, but defensive cleanup handles both shapes).
  const { data: afterChildren } = await svc
    .from('nodes')
    .select('id')
    .eq('parent_id', targetNodeId)
  const newlyCreated = (afterChildren ?? [])
    .map((r: { id: string }) => r.id)
    .filter((id: string) => !preExistingChildIds.has(id))
  if (newlyCreated.length > 0) {
    await svc.from('nodes').delete().in('id', newlyCreated)
  }
  await svc.from('agent_jobs').delete().eq('id', jobId)

  if (!succeeded) {
    return {
      outcome: 'fail',
      duration_ms: durationMs,
      tokens_input: finalJob?.tokens_input_total ?? null,
      tokens_output: finalJob?.tokens_output_total ?? null,
      cost_credits: finalJob?.cost_credits == null ? null : Number(finalJob.cost_credits),
      agent_job_id: null,
      director_turn_id: null,
      failure_class: finalJob?.failure_class ?? 'E',
      error_message: finalJob?.error_message ?? 'expand probe completed without result_child_nodes',
      metadata: {
        final_status: finalJob?.status ?? null,
        proposed_children: Array.isArray(finalJob?.result_child_nodes)
          ? finalJob.result_child_nodes.length
          : 0,
      },
    }
  }

  const proposedCount = Array.isArray(finalJob.result_child_nodes)
    ? finalJob.result_child_nodes.length
    : 0

  return {
    outcome: 'pass',
    duration_ms: durationMs,
    tokens_input: finalJob.tokens_input_total ?? null,
    tokens_output: finalJob.tokens_output_total ?? null,
    cost_credits: finalJob.cost_credits == null ? null : Number(finalJob.cost_credits),
    agent_job_id: null,
    director_turn_id: null,
    failure_class: null,
    error_message: null,
    metadata: { proposed_children: proposedCount },
  }
}

function fixturesMissing(message: string): ProbeRunResult {
  return {
    outcome: 'fail',
    duration_ms: 0,
    tokens_input: null,
    tokens_output: null,
    cost_credits: null,
    agent_job_id: null,
    director_turn_id: null,
    failure_class: 'E',
    error_message: `probe_fixtures_not_seeded: ${message}`,
    metadata: { remediation: 'npm run script scripts/seed-probe-fixtures.ts' },
  }
}

function failedSetup(code: string, meta: Record<string, unknown>): ProbeRunResult {
  return {
    outcome: 'fail',
    duration_ms: 0,
    tokens_input: null,
    tokens_output: null,
    cost_credits: null,
    agent_job_id: null,
    director_turn_id: null,
    failure_class: 'E',
    error_message: code,
    metadata: meta,
  }
}
