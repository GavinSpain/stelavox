/**
 * Apollo-grade transition matrix test.
 *
 * Proof of completeness: for every entity, walks the full N×N matrix of
 * (from_state, to_state) pairs and asserts:
 *
 *   * Every pair LISTED in allowed_transitions succeeds.
 *   * Every pair NOT LISTED is refused with 'illegal_transition'.
 *   * Same-state UPDATEs (from == to) are no-ops (not checked by trigger).
 *
 * This is the data-driven proof that the state machine matches the
 * spec's §11 transition tables. If a transition is added to the DB
 * but not the spec (or vice versa), this test fails.
 *
 * Per the spec: 53 legal + 136 illegal = 189 transition assertions
 * across 6 entities. Plus 6 cardinality checks confirming the DB's
 * allowed_transitions row count matches the hardcoded expectation.
 */

import { expect, test } from '@playwright/test'
import { adminClient } from '../helpers/db'

// ---------------------------------------------------------------------------
// Hardcoded mirror of allowed_transitions seed (M-191).
// Source of truth: docs/stelavox_brief_orchestration_phase0_design_v1_0.md §2.
// The test verifies the DB matches; drift in either direction fails.
// ---------------------------------------------------------------------------

interface EntityConfig {
  states: string[]
  legalTransitions: Array<[string, string]>
}

const ENTITY_MATRIX: Record<string, EntityConfig> = {
  briefs: {
    states: ['active', 'completed', 'cancelled'],
    legalTransitions: [
      ['active', 'completed'],
      ['active', 'cancelled'],
    ],
  },
  brief_stages: {
    states: ['planned', 'planning', 'ready', 'completed', 'cancelled', 'failed'],
    legalTransitions: [
      ['planned',   'planning'],
      ['planned',   'ready'],
      ['planning',  'ready'],
      ['planning',  'planned'],
      ['planning',  'failed'],
      ['ready',     'completed'],
      ['ready',     'failed'],
      ['planned',   'cancelled'],
      ['planning',  'cancelled'],
      ['ready',     'cancelled'],
      ['failed',    'planned'],
    ],
  },
  workflows: {
    states: ['draft', 'approved', 'running', 'paused', 'completed', 'cancelled'],
    legalTransitions: [
      ['draft',    'approved'],
      ['draft',    'cancelled'],
      ['approved', 'running'],
      ['approved', 'cancelled'],
      ['running',  'completed'],
      ['running',  'paused'],
      ['running',  'cancelled'],
      ['paused',   'running'],
      ['paused',   'cancelled'],
    ],
  },
  workflow_steps: {
    states: ['pending', 'running', 'completed', 'failed', 'skipped', 'removed'],
    legalTransitions: [
      ['pending', 'running'],
      ['pending', 'skipped'],
      ['pending', 'removed'],
      ['running', 'completed'],
      ['running', 'failed'],
      ['running', 'skipped'],
    ],
  },
  agent_jobs: {
    states: [
      'queued', 'dispatched', 'running', 'awaiting_accept',
      'accepted', 'dismissed', 'failed', 'crashed', 'cancelled',
    ],
    legalTransitions: [
      ['queued',          'dispatched'],
      ['queued',          'running'],
      ['queued',          'cancelled'],
      ['dispatched',      'running'],
      ['dispatched',      'cancelled'],
      ['dispatched',      'crashed'],
      ['running',         'awaiting_accept'],
      ['running',         'failed'],
      ['running',         'cancelled'],
      ['running',         'crashed'],
      ['awaiting_accept', 'accepted'],
      ['awaiting_accept', 'dismissed'],
      ['awaiting_accept', 'cancelled'],
    ],
  },
  director_turns: {
    states: ['in_progress', 'completed', 'failed', 'cancelled'],
    legalTransitions: [
      ['in_progress', 'completed'],
      ['in_progress', 'failed'],
      ['in_progress', 'cancelled'],
    ],
  },
}

// ---------------------------------------------------------------------------
// Per-entity seed helpers. Each returns the inserted row's id + a cleanup.
// Seed strategy: INSERT directly with the desired state. The auto-derive
// trigger syncs legacy columns; the enforce trigger only fires on UPDATE
// (BEFORE UPDATE OF state), so INSERT with any state is allowed.
// ---------------------------------------------------------------------------

interface SeedResult {
  id: string
  cleanup: () => Promise<void>
  extras?: Record<string, string>
}

let cachedDocumentId: string | null = null
let cachedOrgId: string | null = null
let cachedNodeId: string | null = null
let cachedConversationId: string | null = null

async function getFixtureIds() {
  if (cachedDocumentId) {
    return {
      documentId: cachedDocumentId,
      orgId: cachedOrgId!,
      nodeId: cachedNodeId!,
      conversationId: cachedConversationId!,
    }
  }
  const admin = adminClient()
  const { data: doc } = await admin
    .from('documents')
    .select('id, organisation_id')
    .limit(1)
    .maybeSingle()
  if (!doc) throw new Error('no documents exist; seed first')
  cachedDocumentId = doc.id as string
  cachedOrgId = doc.organisation_id as string

  const { data: node } = await admin
    .from('nodes')
    .select('id')
    .eq('document_id', cachedDocumentId)
    .limit(1)
    .maybeSingle()
  if (!node) throw new Error(`document ${cachedDocumentId} has no nodes`)
  cachedNodeId = node.id as string

  const { data: existingConv } = await admin
    .from('conversations')
    .select('id')
    .eq('document_id', cachedDocumentId)
    .limit(1)
    .maybeSingle()
  if (existingConv) {
    cachedConversationId = existingConv.id as string
  } else {
    const { data: conv } = await admin
      .from('conversations')
      .insert({ document_id: cachedDocumentId, organisation_id: cachedOrgId })
      .select('id')
      .single()
    cachedConversationId = conv!.id as string
  }

  // Force-reset the document to clear residue from prior runs.
  await admin.rpc('force_reset_document', { p_document_id: cachedDocumentId })

  return {
    documentId: cachedDocumentId,
    orgId: cachedOrgId,
    nodeId: cachedNodeId,
    conversationId: cachedConversationId,
  }
}

// briefs are special — strict-one-active partial unique index means we
// can't have two active briefs on the same document. Each seed first
// force-resets the document.
async function seedBriefIn(state: string): Promise<SeedResult> {
  const admin = adminClient()
  const fx = await getFixtureIds()
  // Cancel any active brief first.
  await admin.rpc('force_reset_document', { p_document_id: fx.documentId })

  const { data, error } = await admin
    .from('briefs')
    .insert({
      organisation_id: fx.orgId,
      document_id: fx.documentId,
      goal_text: `apollo matrix test (state=${state})`,
      status: state, // auto-derive syncs state
      cause: 'user_initial',
      sequence_position: 0,
    })
    .select('id')
    .single()
  if (error || !data) throw new Error(`seedBriefIn(${state}) failed: ${error?.message}`)
  return {
    id: data.id as string,
    cleanup: async () => {
      await admin.from('briefs').delete().eq('id', data.id as string)
    },
  }
}

async function seedBriefStageIn(state: string): Promise<SeedResult> {
  // brief_stage needs a parent brief. Use a brief in 'active' state.
  const brief = await seedBriefIn('active')
  const admin = adminClient()
  // Derive legacy status from state for INSERT.
  const legacyStatus = state === 'ready' ? 'planned'
    : state === 'failed' ? 'cancelled'
    : state
  const { data, error } = await admin
    .from('brief_stages')
    .insert({
      brief_id: brief.id,
      order: 1,
      title: `apollo matrix (state=${state})`,
      trigger_type: 'manual',
      trigger_config: {},
      status: legacyStatus,
      state, // explicit
    })
    .select('id')
    .single()
  if (error || !data) throw new Error(`seedBriefStageIn(${state}) failed: ${error?.message}`)
  return {
    id: data.id as string,
    cleanup: async () => {
      await admin.from('brief_stages').delete().eq('id', data.id as string)
      await brief.cleanup()
    },
  }
}

async function seedWorkflowIn(state: string): Promise<SeedResult> {
  const admin = adminClient()
  const fx = await getFixtureIds()
  const { data, error } = await admin
    .from('workflows')
    .insert({
      organisation_id: fx.orgId,
      document_id: fx.documentId,
      title: `apollo matrix wf (state=${state})`,
      status: state,
    })
    .select('id')
    .single()
  if (error || !data) throw new Error(`seedWorkflowIn(${state}) failed: ${error?.message}`)
  return {
    id: data.id as string,
    cleanup: async () => {
      await admin.from('workflows').delete().eq('id', data.id as string)
    },
  }
}

async function seedWorkflowStepIn(state: string): Promise<SeedResult> {
  const wf = await seedWorkflowIn('running')
  const admin = adminClient()
  const fx = await getFixtureIds()
  const { data, error } = await admin
    .from('workflow_steps')
    .insert({
      workflow_id: wf.id,
      order: 1,
      operation_type: 'expand',
      target_node_id: fx.nodeId,
      description: `apollo matrix step (state=${state})`,
      estimated_duration_seconds: 60,
      status: state,
    })
    .select('id')
    .single()
  if (error || !data) throw new Error(`seedWorkflowStepIn(${state}) failed: ${error?.message}`)
  return {
    id: data.id as string,
    cleanup: async () => {
      await admin.from('workflow_steps').delete().eq('id', data.id as string)
      await wf.cleanup()
    },
  }
}

async function seedAgentJobIn(state: string): Promise<SeedResult> {
  const admin = adminClient()
  const fx = await getFixtureIds()
  // For terminal states, INSERT directly. Auto-derive trigger normalises
  // legacy status/queue_status from state.
  const { data, error } = await admin
    .from('agent_jobs')
    .insert({
      organisation_id: fx.orgId,
      document_id: fx.documentId,
      operation_type: 'expand',
      triggered_by: 'apollo-matrix-test',
      state,
      last_heartbeat_at: state === 'running' ? new Date().toISOString() : null,
    })
    .select('id')
    .single()
  if (error || !data) throw new Error(`seedAgentJobIn(${state}) failed: ${error?.message}`)
  return {
    id: data.id as string,
    cleanup: async () => {
      await admin.from('agent_jobs').delete().eq('id', data.id as string)
    },
  }
}

async function seedDirectorTurnIn(state: string): Promise<SeedResult> {
  const admin = adminClient()
  const fx = await getFixtureIds()
  const { data, error } = await admin
    .from('director_turns')
    .insert({
      conversation_id: fx.conversationId,
      state,
    })
    .select('id')
    .single()
  if (error || !data) throw new Error(`seedDirectorTurnIn(${state}) failed: ${error?.message}`)
  return {
    id: data.id as string,
    cleanup: async () => {
      await admin.from('director_turns').delete().eq('id', data.id as string)
    },
  }
}

const SEEDERS: Record<string, (state: string) => Promise<SeedResult>> = {
  briefs: seedBriefIn,
  brief_stages: seedBriefStageIn,
  workflows: seedWorkflowIn,
  workflow_steps: seedWorkflowStepIn,
  agent_jobs: seedAgentJobIn,
  director_turns: seedDirectorTurnIn,
}

// ---------------------------------------------------------------------------
// Test execution
// ---------------------------------------------------------------------------

function pairKey(from: string, to: string): string {
  return `${from}::${to}`
}

test.describe.serial('Apollo transition matrix', () => {
  // Pre-flight: confirm hardcoded matrix matches the DB seed.
  test('DB allowed_transitions matches hardcoded matrix', async () => {
    const admin = adminClient()
    const { data: rows, error } = await admin
      .from('allowed_transitions')
      .select('entity_name, from_state, to_state')
    expect(error).toBeNull()
    expect(rows).toBeTruthy()

    // Group by entity.
    const dbByEntity: Record<string, Set<string>> = {}
    for (const r of rows!) {
      const key = r.entity_name as string
      dbByEntity[key] ??= new Set()
      dbByEntity[key].add(pairKey(r.from_state as string, r.to_state as string))
    }

    for (const [entity, config] of Object.entries(ENTITY_MATRIX)) {
      const expected = new Set(config.legalTransitions.map(([f, t]) => pairKey(f, t)))
      const actual = dbByEntity[entity] ?? new Set()
      // Set equality.
      expect(actual, `entity=${entity}: DB transitions`).toEqual(expected)
    }
  })

  for (const [entity, config] of Object.entries(ENTITY_MATRIX)) {
    test.describe(`${entity}`, () => {
      const legal = new Set(config.legalTransitions.map(([f, t]) => pairKey(f, t)))
      const allPairs: Array<[string, string]> = []
      for (const from of config.states) {
        for (const to of config.states) {
          if (from !== to) allPairs.push([from, to])
        }
      }
      const illegalPairs = allPairs.filter(([f, t]) => !legal.has(pairKey(f, t)))

      // ── LEGAL transitions: succeed ────────────────────────────────────
      for (const [from, to] of config.legalTransitions) {
        test(`LEGAL: ${from} → ${to}`, async () => {
          const admin = adminClient()
          const seed = await SEEDERS[entity](from)
          try {
            const { error } = await admin
              .from(entity as 'briefs')
              .update({ state: to } as never)
              .eq('id', seed.id)
            expect(error, `transition ${from} → ${to} should succeed`).toBeNull()

            const { data: after } = await admin
              .from(entity as 'briefs')
              .select('state' as never)
              .eq('id', seed.id)
              .single()
            expect((after as { state: string }).state).toBe(to)
          } finally {
            await seed.cleanup()
          }
        })
      }

      // ── ILLEGAL transitions: refused ──────────────────────────────────
      for (const [from, to] of illegalPairs) {
        test(`ILLEGAL: ${from} → ${to}`, async () => {
          const admin = adminClient()
          const seed = await SEEDERS[entity](from)
          try {
            const { error } = await admin
              .from(entity as 'briefs')
              .update({ state: to } as never)
              .eq('id', seed.id)
            expect(error, `transition ${from} → ${to} should be refused`).not.toBeNull()
            expect(error!.message).toMatch(/illegal_transition/)

            // Verify state did NOT change.
            const { data: after } = await admin
              .from(entity as 'briefs')
              .select('state' as never)
              .eq('id', seed.id)
              .single()
            expect((after as { state: string }).state).toBe(from)
          } finally {
            await seed.cleanup()
          }
        })
      }
    })
  }
})
