/**
 * Unit tests for the workflow_executor's auto-create-context-node logic
 * (SU-J11-2 / Option B fix; DR-051 work package D).
 *
 * Two layers:
 *
 *   1. Pure-function tests for deriveContextName (the name-derivation
 *      helper).
 *
 *   2. Integration tests against the local DB for the full
 *      auto-create+link+re-target path, driven through the exported
 *      `advanceWorkflow` entry point. The agent_job dispatch step at the
 *      end is fire-and-forget via Vercel waitUntil, so the runner never
 *      executes in the test environment; the auto-create artefacts
 *      (context node + node_context_links row + step re-targeting) run
 *      synchronously before that hand-off and survive.
 *
 * Closes the SU-J11-2 documentation gap: the Option B path has been live
 * since 2026-05-08 but had no automated verification at this layer.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient } from '@supabase/supabase-js'

import { deriveContextName, advanceWorkflow } from '@/lib/director/workflow-executor'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54331'
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const hasServiceKey = SERVICE_KEY !== ''
const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

describe('deriveContextName', () => {
  it('returns capitalized context type when seed_content is empty', () => {
    expect(deriveContextName('theme', '')).toBe('Theme')
    expect(deriveContextName('world', '')).toBe('World')
    expect(deriveContextName('character', '   ')).toBe('Character')
    expect(deriveContextName('plot_thread', '')).toBe('Plot_thread')
  })

  it('extracts first non-empty line from seed_content', () => {
    expect(deriveContextName('theme', 'Ambition and hubris\n\nDriving force')).toBe('Ambition and hubris')
    expect(deriveContextName('world', '\n\nHard physics\n\nMore detail')).toBe('Hard physics')
  })

  it('strips markdown header markers', () => {
    expect(deriveContextName('theme', '# Core Themes\n\nDetails')).toBe('Core Themes')
    expect(deriveContextName('theme', '### Theme Title\n\nMore')).toBe('Theme Title')
  })

  it('strips numeric list prefixes', () => {
    expect(deriveContextName('theme', '1. Ambition & Hubris\n2. Belonging')).toBe('Ambition & Hubris')
    expect(deriveContextName('world', '12. Logistics framework')).toBe('Logistics framework')
  })

  it('strips bullet list prefixes', () => {
    expect(deriveContextName('theme', '- Ambition\n- Belonging')).toBe('Ambition')
    expect(deriveContextName('world', '* Hard physics')).toBe('Hard physics')
  })

  it('strips trailing colons (heading style)', () => {
    expect(deriveContextName('world', 'HARD PHYSICS & LOGISTICS:\n\nDetails')).toBe('Hard Physics & Logistics')
  })

  it('title-cases purely ALL-CAPS first lines', () => {
    // "AMBITION AND HUBRIS" is fully uppercase → title-cases.
    expect(deriveContextName('theme', 'AMBITION AND HUBRIS')).toBe('Ambition And Hubris')
    // "CORE WORLD" with trailing colon — colon stripped, then title-cased.
    expect(deriveContextName('world', 'CORE WORLD:\n\nMars colonization')).toBe('Core World')
  })

  it('preserves mixed-case strings (no title-case-overreach)', () => {
    // Not all uppercase → not title-cased → return as-is.
    expect(deriveContextName('world', 'CORE WORLD: Mars colonization')).toBe('CORE WORLD: Mars colonization')
  })

  it('preserves mixed-case lines', () => {
    expect(deriveContextName('theme', 'Ambition and Hubris drive everything')).toBe('Ambition and Hubris drive everything')
  })

  it('truncates names longer than 80 chars', () => {
    const longLine = 'A very long opening sentence that runs on far past the typical name length we expect for a context node'
    const result = deriveContextName('theme', longLine)
    expect(result.length).toBeLessThanOrEqual(81) // 77 + '…'
    expect(result.endsWith('…')).toBe(true)
  })

  it('falls back to context type if first line is empty after stripping', () => {
    expect(deriveContextName('theme', '#\n\nMore')).toBe('Theme')
    expect(deriveContextName('world', '1.\n\nMore')).toBe('World')
  })

  it('handles the actual Mars-series seed_content (theme + world)', () => {
    // Real seed_content from cloud workflow db0874ed step 2
    const themeSeed =
      'This series explores six interlocking themes across 30–40 years:\n\n' +
      "1. AMBITION & HUBRIS: Humanity's drive to colonize space..."
    expect(deriveContextName('theme', themeSeed)).toBe('This series explores six interlocking themes across 30–40 years')

    // Real seed_content from cloud workflow db0874ed step 3
    const worldSeed = 'HARD PHYSICS & LOGISTICS:\n\n1. GRAVITY WELLS: Earth\'s gravity...'
    expect(deriveContextName('world', worldSeed)).toBe('Hard Physics & Logistics')
  })
})

// ----------------------------------------------------------------------
// DR-051 integration — advanceWorkflow's auto-create+link path.
//
// Verifies the SU-J11-2 Option B substrate end-to-end at the executor
// layer: a workflow_step with operation_type='generate_context' and a
// structural target_node_id triggers (a) context-node creation,
// (b) node_context_links insertion, (c) workflow_steps.target_node_id
// re-targeting. The downstream agent_job dispatch is fire-and-forget via
// Vercel waitUntil; the runner never executes in the test environment
// because waitUntil is a no-op outside Vercel.
// ----------------------------------------------------------------------

describe.skipIf(!hasServiceKey)('advanceWorkflow auto-create+link (DR-051)', () => {
  // Throwaway org for the whole suite — service-role insert bypasses
  // RLS so no auth user is needed. Cleaned up in afterAll.
  let testOrgId: string

  beforeAll(async () => {
    const stamp = Date.now()
    const { data: org, error } = await svc
      .from('organisations')
      .insert({
        name: `DR-051 test org ${stamp}`,
        slug: `dr051-${stamp}`,
        plan: 'trial',
      })
      .select('id')
      .single()
    if (error || !org) {
      throw new Error(`failed to seed test org: ${error?.message}`)
    }
    testOrgId = org.id
  })

  afterAll(async () => {
    if (testOrgId) {
      await svc.from('organisations').delete().eq('id', testOrgId)
    }
  })

  async function setupFixture(prefix: string): Promise<{
    projectId: string
    documentId: string
    rootNodeId: string
    actId: string
  }> {
    const { data: project } = await svc
      .from('projects')
      .insert({ organisation_id: testOrgId, name: `${prefix} project` })
      .select('id')
      .single()
    const { data: rpc } = await svc.rpc('create_document_with_layer_stack', {
      p_project_id: project!.id,
      p_organisation_id: testOrgId,
      p_name: `${prefix} doc`,
      p_description: null as unknown as string,
      p_document_type: 'novel',
      p_authors: [],
    })
    const setup = rpc as { document: { id: string }; root_node: { id: string } }
    // Add an Act so we have a meaningful structural target deeper than the document root.
    const { data: act } = await svc
      .from('nodes')
      .insert({
        organisation_id: testOrgId,
        project_id: project!.id,
        document_id: setup.document.id,
        parent_id: setup.root_node.id,
        node_category: 'structural',
        node_type: 'act',
        order: 1,
        depth: 1,
        layer_index: 1,
        name: `${prefix} Act 1`,
        status: 'draft',
        version: 1,
      })
      .select('id')
      .single()
    return {
      projectId: project!.id,
      documentId: setup.document.id,
      rootNodeId: setup.root_node.id,
      actId: act!.id,
    }
  }

  async function seedApprovedWorkflowWithGenerateContextStep(
    fix: { documentId: string; actId: string },
    parameters: Record<string, unknown>,
  ): Promise<{ workflowId: string; stepId: string }> {
    const { data: wf } = await svc
      .from('workflows')
      .insert({
        organisation_id: testOrgId,
        document_id: fix.documentId,
        conversation_id: null as unknown as string,
        title: 'DR-051 test',
        description: 'auto-create+link verification',
        impact_summary: 'creates one context node',
        status: 'approved',
        estimated_total_minutes: 1,
      })
      .select('id')
      .single()
    const { data: step } = await svc
      .from('workflow_steps')
      .insert({
        workflow_id: wf!.id,
        order: 1,
        operation_type: 'generate_context',
        target_node_id: fix.actId,
        parameters: parameters as never,
        description: 'Generate Theme context for the act',
        estimated_duration_seconds: 30,
        depends_on_step_orders: [],
        status: 'pending',
      })
      .select('id')
      .single()
    return { workflowId: wf!.id, stepId: step!.id }
  }

  async function cleanup(projectId: string): Promise<void> {
    await svc.from('projects').delete().eq('id', projectId)
  }

  it('creates context node + link + re-targets step when context_type + seed_content provided', async () => {
    const fix = await setupFixture('dr051-happy')
    try {
      const { workflowId, stepId } = await seedApprovedWorkflowWithGenerateContextStep(fix, {
        context_type: 'theme',
        seed_content: 'Ambition and Hubris\n\nThe protagonist over-reaches.',
      })

      await advanceWorkflow(workflowId)

      // (a) workflow_steps.target_node_id re-targeted away from actId.
      const { data: stepAfter } = await svc
        .from('workflow_steps')
        .select('target_node_id')
        .eq('id', stepId)
        .single()
      expect(stepAfter!.target_node_id).not.toBe(fix.actId)
      const newContextNodeId = stepAfter!.target_node_id!

      // (b) new node has correct context-node shape.
      const { data: ctxNode } = await svc
        .from('nodes')
        .select('id, node_category, node_type, scope, parent_id, name, document_id, project_id')
        .eq('id', newContextNodeId)
        .single()
      expect(ctxNode!.node_category).toBe('context')
      expect(ctxNode!.node_type).toBe('theme')
      expect(ctxNode!.scope).toBe('document')
      expect(ctxNode!.parent_id).toBeNull()
      expect(ctxNode!.document_id).toBe(fix.documentId)
      expect(ctxNode!.project_id).toBe(fix.projectId)
      // Name derived from seed_content's first non-empty line.
      expect(ctxNode!.name).toBe('Ambition and Hubris')

      // (c) node_context_links row connects structural target → new context node.
      const { data: link } = await svc
        .from('node_context_links')
        .select('source_node_id, target_node_id, link_type, organisation_id')
        .eq('source_node_id', fix.actId)
        .eq('target_node_id', newContextNodeId)
        .maybeSingle()
      expect(link).not.toBeNull()
      expect(link!.link_type).toBe('structural_to_context')
      expect(link!.organisation_id).toBe(testOrgId)
    } finally {
      await cleanup(fix.projectId)
    }
  })

  it('falls back to capitalised context_type as name when seed_content absent', async () => {
    const fix = await setupFixture('dr051-noSeed')
    try {
      const { workflowId, stepId } = await seedApprovedWorkflowWithGenerateContextStep(fix, {
        context_type: 'world',
        // no seed_content
      })

      await advanceWorkflow(workflowId)

      const { data: stepAfter } = await svc
        .from('workflow_steps')
        .select('target_node_id')
        .eq('id', stepId)
        .single()
      const newContextNodeId = stepAfter!.target_node_id!
      const { data: ctxNode } = await svc
        .from('nodes')
        .select('name, node_type, summary')
        .eq('id', newContextNodeId)
        .single()
      expect(ctxNode!.name).toBe('World')
      expect(ctxNode!.node_type).toBe('world')
      // summary stays null when no seed_content
      expect(ctxNode!.summary).toBeNull()
    } finally {
      await cleanup(fix.projectId)
    }
  })

  it('creates no auto-create artefacts when context_type absent', async () => {
    // The executor early-returns from the auto-create block when
    // context_type is missing, and attempts to transition the step to
    // 'failed' with reason 'generate_context_missing_context_type'.
    //
    // NOTE on the transition: post-M-205 (Apollo CAS sweep) the only
    // legal transition to workflow_steps.failed is from 'running' via
    // event 'job_terminal_failure'. The executor calls this event with
    // the step still in 'pending', so the CAS loses and the step keeps
    // its initial status. This is a latent bug in the executor — flagged
    // as a follow-up; not in DR-051 scope. The user-visible invariant
    // this test pins is the one DR-051 actually shipped: when
    // context_type is missing, NO context node is created and NO
    // node_context_links row is inserted.
    const fix = await setupFixture('dr051-noType')
    try {
      const { workflowId } = await seedApprovedWorkflowWithGenerateContextStep(fix, {
        // no context_type
        seed_content: 'irrelevant without context_type',
      })

      await advanceWorkflow(workflowId)

      // No context node created against this fixture's document.
      const { count: ctxCount } = await svc
        .from('nodes')
        .select('id', { count: 'exact', head: true })
        .eq('document_id', fix.documentId)
        .eq('node_category', 'context')
      expect(ctxCount).toBe(0)

      // No node_context_links row created against the structural target.
      const { count: linkCount } = await svc
        .from('node_context_links')
        .select('id', { count: 'exact', head: true })
        .eq('source_node_id', fix.actId)
      expect(linkCount).toBe(0)
    } finally {
      await cleanup(fix.projectId)
    }
  })
})
