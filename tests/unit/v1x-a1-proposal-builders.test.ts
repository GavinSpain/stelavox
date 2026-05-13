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
      workflow: null,
    },
  ],
}

describe('buildBriefProposal', () => {
  it('builds a valid multi-stage proposal', () => {
    const result = buildBriefProposal(VALID_BRIEF)
    expect(result.goal_text).toBe(VALID_BRIEF.goal_text)
    expect(result.stages).toHaveLength(2)
    expect(result.stages[0].workflow).not.toBeNull()
    expect(result.stages[1].workflow).toBeNull()
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

  it('rejects stage 1 with null workflow', () => {
    const bad = {
      ...VALID_BRIEF,
      stages: [
        { order: 1, title: 'X', trigger_type: 'manual', trigger_config: {}, workflow: null },
      ],
    }
    expect(() => buildBriefProposal(bad)).toThrow(/first_stage_workflow_required/)
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
