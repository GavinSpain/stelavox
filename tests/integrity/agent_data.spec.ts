// Phase 5 data integrity / Zod schema tests.
// Spec: stelavox_phase5_test_plan_v1_0.md v1.1 §7
//       TC-D-01, D-02, D-06, D-09, D-11, D-12, D-15, D-16
//
// Pure-logic tests (Zod schema validation, plainTextToTiptap edge cases)
// plus DB constraint checks via service-role admin client.

import { test, expect } from '@playwright/test'
import { adminClient } from '../helpers/db'
import { ExpandOutputSchema } from '../../lib/llm/schemas/expand'
import { SynthesiseOutputSchema } from '../../lib/llm/schemas/synthesise'
import { GenerateContextOutputSchema } from '../../lib/llm/schemas/generate-context'
import { plainTextToTiptap } from '../../lib/agent/prose-to-tiptap'

test.describe('Phase 5 — TC-D data integrity', () => {
  test('TC-D-01 — agent_jobs status enum admits all 7 V1 values', async () => {
    const admin = adminClient()
    const { data: org } = await admin.from('organisations').select('id').limit(1).single()
    const orgId = org!.id
    const { data: users } = await admin.auth.admin.listUsers({ perPage: 5 })
    const userId = users.users[0].id

    const statuses = ['pending', 'running', 'completed', 'accepted', 'dismissed', 'cancelled', 'failed']
    const inserted: string[] = []
    try {
      for (const status of statuses) {
        const { data, error } = await admin.from('agent_jobs').insert({
          organisation_id: orgId,
          operation_type: 'expand',
          operation_class: 'single_node',
          status,
          triggered_by: userId,
        }).select('id').single()
        expect(error, `status=${status}`).toBeNull()
        if (data?.id) inserted.push(data.id)
      }
    } finally {
      if (inserted.length) {
        await admin.from('agent_jobs').delete().in('id', inserted)
      }
    }
  })

  test('TC-D-02 — agent_jobs status enum rejects unknown value', async () => {
    const admin = adminClient()
    const { data: org } = await admin.from('organisations').select('id').limit(1).single()
    const { data: users } = await admin.auth.admin.listUsers({ perPage: 5 })
    const { error } = await admin.from('agent_jobs').insert({
      organisation_id: org!.id,
      operation_type: 'expand',
      operation_class: 'single_node',
      status: 'in_review',  // a node-status value, not agent-status
      triggered_by: users.users[0].id,
    })
    expect(error).toBeTruthy()
    // Postgres CHECK constraint violation
    expect(error?.message ?? '').toMatch(/agent_jobs_status_check|invalid input value/i)
  })

  test('TC-D-06 — Migration 027 seeds at least 17 system profiles', async () => {
    const { count } = await adminClient()
      .from('agent_profiles').select('*', { count: 'exact', head: true })
      .eq('is_system_profile', true)
    expect(count ?? 0).toBeGreaterThanOrEqual(17)
  })

  test('TC-D-09 — Zod rejects malformed expand output (missing position)', async () => {
    const result = ExpandOutputSchema.safeParse([{ summary: 'hello', short_description: 'a' }])
    expect(result.success).toBe(false)
    if (!result.success) {
      const positionIssue = result.error.issues.find(i => i.path.includes('position'))
      expect(positionIssue).toBeDefined()
    }
  })

  test('TC-D-11 — Zod rejects synthesise empty string', async () => {
    expect(SynthesiseOutputSchema.safeParse('').success).toBe(false)
    expect(SynthesiseOutputSchema.safeParse('   ').success).toBe(true)  // whitespace IS length 3
    expect(SynthesiseOutputSchema.safeParse('hello world').success).toBe(true)
  })

  test('TC-D-12 — Zod rejects generate-context missing summary', async () => {
    const result = GenerateContextOutputSchema.safeParse({ metadata: {} })
    expect(result.success).toBe(false)
  })

  test('TC-D-15 — plainTextToTiptap edge cases', async () => {
    // Empty string
    const empty = plainTextToTiptap('')
    expect(empty.type).toBe('doc')
    expect(empty.content).toEqual([{ type: 'paragraph' }])

    // Single paragraph
    const single = plainTextToTiptap('Hello world.')
    expect(single.content).toHaveLength(1)
    expect(single.content[0].type).toBe('paragraph')
    expect(single.content[0].content?.[0].text).toBe('Hello world.')

    // Two paragraphs separated by blank line
    const two = plainTextToTiptap('First.\n\nSecond.')
    expect(two.content).toHaveLength(2)
    expect(two.content[0].content?.[0].text).toBe('First.')
    expect(two.content[1].content?.[0].text).toBe('Second.')

    // Multiple blank lines collapse to single split
    const collapsed = plainTextToTiptap('A.\n\n\n\nB.')
    expect(collapsed.content).toHaveLength(2)

    // Leading/trailing whitespace trimmed
    const trimmed = plainTextToTiptap('  \n  Hello.  \n  ')
    expect(trimmed.content).toHaveLength(1)
    expect(trimmed.content[0].content?.[0].text).toBe('Hello.')

    // CRLF handled the same as LF
    const crlf = plainTextToTiptap('First.\r\n\r\nSecond.')
    expect(crlf.content).toHaveLength(2)
  })

  test('TC-D-16 — Migration 027 prompts all contain the SECURITY FRAME', async () => {
    const { data, error } = await adminClient()
      .from('agent_profiles').select('name, system_prompt')
      .eq('is_system_profile', true)
    expect(error).toBeNull()
    expect(data?.length).toBeGreaterThanOrEqual(17)
    // Every system prompt must include user-data security framing.
    for (const row of data ?? []) {
      expect(
        row.system_prompt.includes('user_data') ||
        row.system_prompt.toLowerCase().includes('user-provided'),
        `profile ${row.name} missing security frame`,
      ).toBe(true)
      // No raw placeholder remaining
      expect(row.system_prompt).not.toContain('[SECURITY FRAME — see §4]')
    }
  })
})
