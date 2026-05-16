import 'server-only'

/**
 * V1.x-F.3 — refine_accept synthetic probe.
 *
 * Source: stelavox_v1x_f_build_checklist_v1_1.md §3 +
 *         lib/admin/probes/runner.ts (replaces V1.x-E.2 stub).
 *
 * Exercises the refine pipeline end-to-end against the probe-fixture
 * leaf scene seeded by scripts/seed-probe-fixtures.ts. Flow:
 *   1. Look up probe org / document / refine target from
 *      platform_config.
 *   2. Snapshot the target node's prose + summary + version +
 *      content_revision before the probe.
 *   3. Insert agent_jobs row + invoke runAgentJob() inline.
 *   4. Read the resulting job + node row.
 *   5. Restore the node to its pre-probe state + delete the probe job
 *      row so the probe is idempotent.
 *
 * V1 scope note: the probe exercises the LLM call + parse + result
 * persistence (runAgentJob path) but deliberately does NOT call
 * accept_agent_job — the accept path is well-tested via the integration
 * surfaces already and adding accept here would require restoring
 * node_versions rows + the version-bump on cleanup. Exercising the
 * version-bump path is queued for V2 polish. The probe's name (refine_
 * accept) reflects what it covers when the V2 path lands, but for V1
 * the probe specifically verifies the refine-completion path is
 * functional end-to-end.
 */

import { runAgentJob } from '@/lib/agent/runner'
import { getConfig } from '@/lib/config/platform-config'
import { createServiceRoleClient } from '@/lib/supabase/service'

import type { ProbeRunResult } from './runner'

const PROBE_TRIGGER_TAG = 'synthetic_probe:refine_accept'

async function readFixturePointer(key: string): Promise<string | null> {
  try {
    const v = await getConfig<string>(key)
    return typeof v === 'string' && v.length > 0 ? v : null
  } catch {
    return null
  }
}

export async function runRefineAcceptProbe(): Promise<ProbeRunResult> {
  const svc = createServiceRoleClient()

  const orgId = await readFixturePointer('probe.fixture.organisation_id')
  const documentId = await readFixturePointer('probe.fixture.document_id')
  const targetNodeId = await readFixturePointer('probe.fixture.refine_target_node_id')
  if (!orgId || !documentId || !targetNodeId) {
    return fixturesMissing(
      'refine_accept probe missing fixture pointer(s) in platform_config — run scripts/seed-probe-fixtures.ts first.',
    )
  }

  // Snapshot the target. Restore these fields on cleanup so the probe
  // is idempotent across runs.
  const { data: target } = await svc
    .from('nodes')
    .select(
      'id, node_type, version, content_revision, prose, summary, organisation_id, document_id, locked',
    )
    .eq('id', targetNodeId)
    .maybeSingle()
  if (!target || target.organisation_id !== orgId || target.document_id !== documentId) {
    return fixturesMissing('refine_target_node_id resolves outside the probe org/document')
  }

  const snapshot = {
    prose: target.prose,
    summary: target.summary,
    version: target.version,
    content_revision: target.content_revision,
    locked: target.locked,
  }

  // Resolve the refine profile for this node_type.
  const { data: profile } = await svc
    .from('agent_profiles')
    .select('id, model_id, max_tokens, operation_type, node_type')
    .eq('is_system_profile', true)
    .eq('operation_type', 'refine')
    .eq('node_type', target.node_type)
    .maybeSingle()
  if (!profile) {
    return failedSetup('no_system_refine_profile_for_target_node_type', {
      node_type: target.node_type,
    })
  }

  const startedAt = Date.now()
  const { data: jobRow, error: insertErr } = await svc
    .from('agent_jobs')
    .insert({
      organisation_id: orgId,
      node_id: targetNodeId,
      document_id: documentId,
      profile_id: profile.id,
      operation_type: 'refine',
      operation_class: 'single_node',
      status: 'pending',
      triggered_by: PROBE_TRIGGER_TAG,
      target_node_version_at_capture: target.version,
      context_snapshot: {
        dynamic: {
          agent_instruction:
            'Synthetic probe refine — tighten cadence; preserve the original meaning.',
          target_field: 'prose',
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

  await runAgentJob(jobId)
  const durationMs = Date.now() - startedAt

  const { data: finalJob } = await svc
    .from('agent_jobs')
    .select(
      'id, status, result_text, tokens_input_total, tokens_output_total, cost_credits, failure_class, error_message',
    )
    .eq('id', jobId)
    .single()

  const succeeded =
    finalJob?.status === 'completed' &&
    typeof finalJob.result_text === 'string' &&
    finalJob.result_text.length > 0

  // Restore the node to its pre-probe state. Even if the runner only
  // wrote to result_text on agent_jobs (refine does not commit to the
  // node until accept_agent_job), restoring here is defensive against
  // any side-effects from future runner changes.
  await svc
    .from('nodes')
    .update({
      prose: snapshot.prose,
      summary: snapshot.summary,
      version: snapshot.version,
      content_revision: snapshot.content_revision,
      locked: snapshot.locked,
    })
    .eq('id', targetNodeId)
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
      error_message: finalJob?.error_message ?? 'refine probe completed without result_text',
      metadata: { final_status: finalJob?.status ?? null },
    }
  }

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
    metadata: {
      result_text_length: typeof finalJob.result_text === 'string' ? finalJob.result_text.length : 0,
    },
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
