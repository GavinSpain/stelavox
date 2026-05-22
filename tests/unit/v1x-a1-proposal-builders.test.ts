/**
 * V1.x-A.1 — proposalBuilder unit tests (Brief + Profile).
 */

import { describe, expect, it } from 'vitest'

import { buildBriefProposal } from '@/lib/brief/proposalBuilder'
import { buildProfileAmendmentProposal } from '@/lib/profile/proposalBuilder'

const VALID_BRIEF = {
  goal_text: 'Create chapters and scenes for act 2.',
  stages: [
    {
      order: 1,
      title: 'Expand Act 2 into chapters',
      trigger_type: 'manual',
      trigger_config: {},
      workflow: {
        title: 'Expand Act 2',
        steps: [
          {
            operation_type: 'expand',
            target_node_id: '11111111-1111-4111-8111-111111111111',
            description: 'Expand Act 2 into chapters.',
            estimated_duration_seconds: 90,
            parameters: {},
          },
        ],
      },
    },
    {
      order: 2,
      title: 'Expand chapters into scenes',
      trigger_type: 'after_stage',
      trigger_config: { after_stage_order: 1 },
      // 2026-05-21 simplification — stage 2 uses prompt instead of
      // workflow (targets unknown until stage 1 creates the chapters).
      prompt: 'Expand the new chapters into scenes',
    },
  ],
}

describe('buildBriefProposal', () => {
  it('builds a valid multi-stage proposal', () => {
    const result = buildBriefProposal(VALID_BRIEF)
    expect(result.goal_text).toBe(VALID_BRIEF.goal_text)
    expect(result.stages).toHaveLength(2)
    expect(result.stages[0].workflow).not.toBeNull()
    expect(result.stages[0].prompt).toBeNull()
    expect(result.stages[1].workflow).toBeNull()
    expect(result.stages[1].prompt).toBe('Expand the new chapters into scenes')
  })

  it('builds a trivial n=1 Brief', () => {
    const trivial = {
      goal_text: 'Refine this scene.',
      stages: [
        {
          order: 1,
          title: 'Refine',
          trigger_type: 'manual',
          trigger_config: {},
          workflow: {
            title: 'Refine scene',
            steps: [
              {
                operation_type: 'refine',
                target_node_id: '11111111-1111-4111-8111-111111111111',
                description: 'Tighten reflection.',
                estimated_duration_seconds: 45,
                parameters: { target_field: 'summary', instruction: 'Tighter.' },
              },
            ],
          },
        },
      ],
    }
    const result = buildBriefProposal(trivial)
    expect(result.stages).toHaveLength(1)
  })

  it('rejects missing goal_text', () => {
    expect(() => buildBriefProposal({ ...VALID_BRIEF, goal_text: '' })).toThrow()
  })

  it('rejects a stage with NEITHER workflow nor prompt (XOR violation)', () => {
    const bad = {
      ...VALID_BRIEF,
      stages: [
        { order: 1, title: 'X', trigger_type: 'manual', trigger_config: {} },
      ],
    }
    // 2026-05-21 simplification — the XOR refine on StageInputSchema
    // requires exactly one of (workflow, prompt). Neither = Zod error
    // pointing at the workflow path.
    expect(() => buildBriefProposal(bad)).toThrow(/exactly one of workflow or prompt|workflow/i)
  })

  it('rejects a stage with BOTH workflow and prompt (XOR violation)', () => {
    const bad = {
      ...VALID_BRIEF,
      stages: [
        {
          order: 1,
          title: 'X',
          trigger_type: 'manual',
          trigger_config: {},
          workflow: VALID_BRIEF.stages[0].workflow,
          prompt: 'also has a prompt',
        },
      ],
    }
    expect(() => buildBriefProposal(bad)).toThrow(/exactly one of workflow or prompt|workflow/i)
  })

  it('accepts a stage with prompt only (stage 1 prompt-deferred)', () => {
    const promptOnly = {
      goal_text: 'Figure out scope from current state',
      stages: [
        {
          order: 1,
          title: 'Plan after reading',
          trigger_type: 'manual',
          trigger_config: {},
          prompt: 'Read the document and decide what to do next.',
        },
      ],
    }
    const result = buildBriefProposal(promptOnly)
    expect(result.stages[0].workflow).toBeNull()
    expect(result.stages[0].prompt).toBe('Read the document and decide what to do next.')
  })

  it('rejects duplicate stage orders', () => {
    const bad = {
      ...VALID_BRIEF,
      stages: [
        VALID_BRIEF.stages[0],
        { ...VALID_BRIEF.stages[0], title: 'Y' },
      ],
    }
    expect(() => buildBriefProposal(bad)).toThrow(/duplicate_stage_order/)
  })

  it('rejects after_stage refs to non-existent stages', () => {
    const bad = {
      ...VALID_BRIEF,
      stages: [
        VALID_BRIEF.stages[0],
        { ...VALID_BRIEF.stages[1], trigger_config: { after_stage_order: 99 } },
      ],
    }
    expect(() => buildBriefProposal(bad)).toThrow(/dangling_after_stage_ref/)
  })

  it('rejects forward after_stage refs', () => {
    const bad = {
      ...VALID_BRIEF,
      stages: [
        { ...VALID_BRIEF.stages[0], trigger_type: 'after_stage', trigger_config: { after_stage_order: 2 } },
        VALID_BRIEF.stages[1],
      ],
    }
    expect(() => buildBriefProposal(bad)).toThrow(/forward_after_stage_ref/)
  })

  // 2026-05-22 — round-trip regression. proposalBuilder writes
  // workflow=null OR prompt=null for the unset side of each stage,
  // but BriefProposalV1xA1Schema (the schema consumed by the iteration-
  // runner's brief_proposal event yield + the UI's parseMessageProposals
  // parser) was declared .optional() (accepts undefined-only). A
  // built artefact round-tripped through safeParse FAILED silently,
  // so a perfectly-good propose_brief tool call never surfaced as a
  // BriefProposalCard. Bug filed 2026-05-22 from user-driven test.
  // Fix: schema accepts nullable + truthy XOR refine. This test pins
  // the round-trip so the drift can't recur.
  it('proposalBuilder output round-trips through BriefProposalV1xA1Schema (Bug #1 regression)', async () => {
    const { BriefProposalV1xA1Schema } = await import('@/lib/director/schemas')
    const built = buildBriefProposal(VALID_BRIEF)
    // Sanity check: the build sets workflow=null on stage 2 (the
    // prompt-deferred one) and prompt=null on stage 1 (the workflow-
    // bound one). These nulls used to fail safeParse silently.
    expect(built.stages[0].workflow).not.toBeNull()
    expect(built.stages[0].prompt).toBeNull()
    expect(built.stages[1].workflow).toBeNull()
    expect(built.stages[1].prompt).not.toBeNull()
    // The actual contract: round-trip succeeds.
    const r = BriefProposalV1xA1Schema.safeParse(built)
    expect(r.success, JSON.stringify(r)).toBe(true)
  })

  it('proposalBuilder output for single-stage prompt-only brief round-trips through schema', async () => {
    const { BriefProposalV1xA1Schema } = await import('@/lib/director/schemas')
    const promptOnly = {
      goal_text: 'Figure out scope from current state',
      stages: [
        {
          order: 1,
          title: 'Plan after reading',
          trigger_type: 'manual',
          trigger_config: {},
          prompt: 'Read the document and decide what to do next.',
        },
      ],
    }
    const built = buildBriefProposal(promptOnly)
    const r = BriefProposalV1xA1Schema.safeParse(built)
    expect(r.success, JSON.stringify(r)).toBe(true)
  })
})

describe('buildProfileAmendmentProposal', () => {
  it('builds a valid update_voice amendment', () => {
    const result = buildProfileAmendmentProposal({
      amendment_type: 'update_voice',
      target_path: 'preferences.voice',
      after: 'cold and clinical',
      reason: 'Author requested.',
    })
    expect(result.amendment_type).toBe('update_voice')
    expect(result.after).toBe('cold and clinical')
  })

  it('builds a valid update_goal_text amendment (no target_path)', () => {
    const result = buildProfileAmendmentProposal({
      amendment_type: 'update_goal_text',
      after: 'A refined project goal description.',
      reason: 'Author refined intent.',
    })
    expect(result.amendment_type).toBe('update_goal_text')
    expect(result.target_path).toBeUndefined()
  })

  it('rejects non-update_goal_text amendments without target_path', () => {
    expect(() =>
      buildProfileAmendmentProposal({
        amendment_type: 'add_constraint',
        after: ['no contractions'],
        reason: 'New rule.',
      }),
    ).toThrow(/target_path_required/)
  })

  it('rejects invalid amendment_type', () => {
    expect(() =>
      buildProfileAmendmentProposal({
        amendment_type: 'insert_stage',
        target_path: 'stages',
        after: { title: 'Foo' },
        reason: 'Out of scope.',
      }),
    ).toThrow()
  })
})
