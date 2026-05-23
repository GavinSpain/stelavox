/**
 * Regression — every stage field that brief_stages persists must be
 * present in the JSONB payload acceptBrief sends to the accept_brief
 * RPC.
 *
 * Surfaced 2026-05-22 by user test: stage 1 completed; stage 2
 * (workflow:null + prompt set) never triggered. Root cause: the
 * acceptBrief rpcWrapper stripped `prompt` from the per-stage object
 * before calling the RPC. accept_brief saw NULL prompt; the push-model
 * evaluator skipped the stage forever (defence-in-depth NULL-prompt
 * check).
 *
 * The risk this test pins: the proposalBuilder + accept_brief schema
 * shapes drift over time (M-183 + M-189 added the prompt column; later
 * migrations may add more), and the in-between mapper in rpcWrappers.ts
 * silently drops anything new because the mapping is explicit.
 *
 * Strategy: spy on supabase.rpc, assert the per-stage object contains
 * every key from a known-good BriefProposal stage shape. If a new
 * stage field is added downstream and the mapper isn't updated, this
 * test fails fast.
 */

import { describe, expect, it, vi } from 'vitest'

import { acceptBrief } from '@/lib/brief/rpcWrappers'
import type { BriefProposal } from '@/lib/brief/types'

const STAGE_FIELDS_REQUIRED_IN_RPC_PAYLOAD = [
  'order',
  'title',
  'description',
  'trigger_type',
  'trigger_config',
  // 2026-05-22 — added when M-183 introduced brief_stages.prompt.
  // accept_brief reads v_stage->>'prompt' from the JSONB; if the
  // mapper drops it, prompt-deferred stages land with NULL prompt and
  // the push-model evaluator refuses to fire them.
  'prompt',
] as const

function fakeSupabase(captured: { payload?: unknown }) {
  return {
    rpc: vi.fn(async (_name: string, args: { p_stages: unknown }) => {
      captured.payload = args.p_stages
      return {
        data: {
          brief: { id: 'fake-brief' },
          stages: [],
          initial_status: 'active',
          queue_position: 0,
        },
        error: null,
      }
    }),
  } as unknown as Parameters<typeof acceptBrief>[0]
}

describe('acceptBrief — RPC payload completeness', () => {
  it('includes every persisted stage field in the p_stages JSONB', async () => {
    const captured: { payload?: unknown } = {}
    const supabase = fakeSupabase(captured)

    const proposal: BriefProposal = {
      goal_text: 'Test goal',
      stages: [
        {
          order: 1,
          title: 'Stage 1 workflow',
          description: 'Stage 1 desc',
          trigger_type: 'manual',
          trigger_config: {},
          workflow: {
            title: 'Stage 1 wf',
            steps: [
              {
                operation_type: 'expand',
                target_node_id: '00000000-0000-0000-0000-000000000001',
                description: 'expand',
                estimated_duration_seconds: 60,
                parameters: { child_count_target: 3 },
              },
            ],
          },
          prompt: null,
        },
        {
          order: 2,
          title: 'Stage 2 prompt-deferred',
          description: 'Stage 2 desc',
          trigger_type: 'after_stage',
          trigger_config: { after_stage_order: 1 },
          workflow: null,
          prompt: 'Plan and execute synthesise for stage 1 outputs',
        },
      ],
    }

    await acceptBrief(supabase, '00000000-0000-0000-0000-0000000000aa', proposal)

    expect(Array.isArray(captured.payload)).toBe(true)
    const stages = captured.payload as Array<Record<string, unknown>>
    expect(stages).toHaveLength(2)

    for (const stage of stages) {
      for (const field of STAGE_FIELDS_REQUIRED_IN_RPC_PAYLOAD) {
        expect(stage, `stage missing field ${field}: ${JSON.stringify(stage)}`)
          .toHaveProperty(field)
      }
    }
  })

  it('preserves the prompt value verbatim (no truncation, no escape drift)', async () => {
    const captured: { payload?: unknown } = {}
    const supabase = fakeSupabase(captured)

    const longPrompt =
      'Synthesise prose for each beat. ' +
      'Target ~1200 words. ' +
      "Maintain the character's perspective and the claustrophobic tone."

    const proposal: BriefProposal = {
      goal_text: 'Goal',
      stages: [
        {
          order: 1,
          title: 'Workflow stage',
          description: '',
          trigger_type: 'manual',
          trigger_config: {},
          workflow: {
            title: 'wf',
            steps: [
              {
                operation_type: 'expand',
                target_node_id: '00000000-0000-0000-0000-000000000001',
                description: 'x',
                estimated_duration_seconds: 60,
                parameters: { child_count_target: 1 },
              },
            ],
          },
          prompt: null,
        },
        {
          order: 2,
          title: 'Prompt stage',
          description: '',
          trigger_type: 'after_stage',
          trigger_config: { after_stage_order: 1 },
          workflow: null,
          prompt: longPrompt,
        },
      ],
    }

    await acceptBrief(supabase, '00000000-0000-0000-0000-0000000000bb', proposal)

    const stages = captured.payload as Array<Record<string, unknown>>
    expect(stages[1].prompt).toBe(longPrompt)
  })

  it('passes null prompt when the stage is workflow-bound', async () => {
    const captured: { payload?: unknown } = {}
    const supabase = fakeSupabase(captured)

    const proposal: BriefProposal = {
      goal_text: 'Goal',
      stages: [
        {
          order: 1,
          title: 'Workflow only',
          description: '',
          trigger_type: 'manual',
          trigger_config: {},
          workflow: {
            title: 'wf',
            steps: [
              {
                operation_type: 'expand',
                target_node_id: '00000000-0000-0000-0000-000000000001',
                description: 'x',
                estimated_duration_seconds: 60,
                parameters: { child_count_target: 1 },
              },
            ],
          },
          prompt: null,
        },
      ],
    }

    await acceptBrief(supabase, '00000000-0000-0000-0000-0000000000cc', proposal)

    const stages = captured.payload as Array<Record<string, unknown>>
    expect(stages[0]).toHaveProperty('prompt')
    expect(stages[0].prompt).toBeNull()
  })
})
