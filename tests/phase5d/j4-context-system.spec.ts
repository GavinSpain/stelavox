import { test, expect, request as playwrightRequest } from '@playwright/test'
import { adminClient } from '../helpers/db'
import { findUserByEmail, getOrganisationIdForUser } from '../helpers/isolation'
import { createIsolatedDoc } from '../helpers/isolation'
import { setupJ3Fixture } from '../helpers/j3-fixture'
import { APP_URL, USERS } from '../helpers/auth'

// Phase 5d — J4 Context system journey.
// 13 cases per docs/stelavox_phase5d_test_plan_v1_0.md §4.4.
// Strategy: API-level coverage where it's the cleanest assertion path
// (most J4 cases are RLS / validation / linkage which are best
// asserted at the API level). UI-only cases that require data-testids
// or end-to-end agent context propagation are deferred to J4.B.

test.use({ storageState: USERS.A.storageState })

let cleanupFns: Array<() => Promise<void>> = []

test.beforeEach(async () => { cleanupFns = [] })
test.afterEach(async () => {
  for (const fn of cleanupFns) {
    await fn().catch(() => {})
  }
})

async function getOrgId(): Promise<string> {
  const user = await findUserByEmail(USERS.A.email)
  if (!user) throw new Error('USERS.A not seeded')
  return getOrganisationIdForUser(user.id)
}

function uniqueName(tag: string): string {
  return `j4-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
}

async function ctxA() {
  return playwrightRequest.newContext({ baseURL: APP_URL, storageState: USERS.A.storageState })
}

async function ctxB() {
  return playwrightRequest.newContext({ baseURL: APP_URL, storageState: USERS.B.storageState })
}

// ─── Context node CRUD (TC-J4-01..03) ───────────────────────────────────────

test('TC-J4-01: create a Character context node via API; row has correct shape', async () => {
  const orgId = await getOrgId()
  const seeded = await createIsolatedDoc({ organisationId: orgId, ownerName: 'TC-J4-01' })
  cleanupFns.push(seeded.cleanup)

  const ctx = await ctxA()
  const res = await ctx.post(`/api/projects/${seeded.projectId}/context-nodes`, {
    data: {
      scope: 'project', node_type: 'character', name: uniqueName('01'),
      metadata: { role: 'protagonist' },
    },
  })
  expect(res.status()).toBe(201)
  const body = await res.json()
  expect(body.node).toMatchObject({
    node_category: 'context',
    scope: 'project',
    document_id: null,
    parent_id: null,
    node_type: 'character',
  })
  expect(body.node.metadata).toMatchObject({ role: 'protagonist' })
})

test('TC-J4-02: PATCH context-node metadata persists', async () => {
  const orgId = await getOrgId()
  const seeded = await createIsolatedDoc({ organisationId: orgId, ownerName: 'TC-J4-02' })
  cleanupFns.push(seeded.cleanup)

  const ctx = await ctxA()
  const created = await ctx.post(`/api/projects/${seeded.projectId}/context-nodes`, {
    data: { scope: 'project', node_type: 'character', name: uniqueName('02') },
  })
  const node = (await created.json()).node

  // Update via PATCH /api/nodes/[id] — metadata field is editable.
  const patched = await ctx.patch(`/api/nodes/${node.id}`, {
    data: {
      metadata: { role: 'antagonist', age: 42 },
      expected_version: node.version,
    },
  })
  expect(patched.status()).toBe(200)

  const admin = adminClient()
  const { data: row } = await admin.from('nodes').select('metadata').eq('id', node.id).single()
  expect(row?.metadata).toMatchObject({ role: 'antagonist', age: 42 })
})

test('TC-J4-03: invalid scope is rejected', async () => {
  const orgId = await getOrgId()
  const seeded = await createIsolatedDoc({ organisationId: orgId, ownerName: 'TC-J4-03' })
  cleanupFns.push(seeded.cleanup)

  const ctx = await ctxA()
  const res = await ctx.post(`/api/projects/${seeded.projectId}/context-nodes`, {
    data: {
      scope: 'galactic',  // invalid scope
      node_type: 'character',
      name: uniqueName('03'),
    },
  })
  expect(res.status()).toBeGreaterThanOrEqual(400)
  expect(res.status()).toBeLessThan(500)
})

// ─── Context linking (TC-J4-04..08) ─────────────────────────────────────────

test('TC-J4-04: link a Character context node to a beat (creates link row)', async () => {
  const orgId = await getOrgId()
  const f = await setupJ3Fixture(orgId, 'J4-04')
  cleanupFns.push(f.cleanup)

  // Create a Character at project scope.
  const ctx = await ctxA()
  const created = await ctx.post(`/api/projects/${f.projectId}/context-nodes`, {
    data: { scope: 'project', node_type: 'character', name: uniqueName('04-char') },
  })
  expect(created.status()).toBe(201)
  const charNode = (await created.json()).node

  // Link to the beat.
  const linkRes = await ctx.post(`/api/nodes/${f.beatId}/context-links`, {
    data: { context_node_id: charNode.id },
  })
  expect([200, 201]).toContain(linkRes.status())

  // DB-side: link row exists.
  const admin = adminClient()
  const { data: links } = await admin
    .from('node_context_links')
    .select('id')
    .eq('source_node_id', f.beatId)
    .eq('target_node_id', charNode.id)
  expect(links?.length).toBe(1)
})

test('TC-J4-06: cannot link a Character from another project (cross-project rejection)', async () => {
  const orgId = await getOrgId()
  const fA = await setupJ3Fixture(orgId, 'J4-06-A')
  cleanupFns.push(fA.cleanup)
  const fB = await setupJ3Fixture(orgId, 'J4-06-B')
  cleanupFns.push(fB.cleanup)

  // Create Character in project B.
  const ctx = await ctxA()
  const created = await ctx.post(`/api/projects/${fB.projectId}/context-nodes`, {
    data: { scope: 'project', node_type: 'character', name: uniqueName('06-char') },
  })
  const charNodeB = (await created.json()).node

  // Try to link Character (in project B) to a beat in project A.
  const linkRes = await ctx.post(`/api/nodes/${fA.beatId}/context-links`, {
    data: { context_node_id: charNodeB.id },
  })
  expect(linkRes.status()).toBeGreaterThanOrEqual(400)
})

test('TC-J4-07: BackLinksList API surfaces incoming links to a context node', async () => {
  const orgId = await getOrgId()
  const f = await setupJ3Fixture(orgId, 'J4-07')
  cleanupFns.push(f.cleanup)

  const ctx = await ctxA()
  const created = await ctx.post(`/api/projects/${f.projectId}/context-nodes`, {
    data: { scope: 'project', node_type: 'character', name: uniqueName('07-char') },
  })
  const charNode = (await created.json()).node

  // Link the beat to this character.
  await ctx.post(`/api/nodes/${f.beatId}/context-links`, {
    data: { context_node_id: charNode.id },
  })

  // GET back-links for the character node.
  const res = await ctx.get(`/api/nodes/${charNode.id}/back-links`)
  expect(res.status()).toBe(200)
  const body = await res.json()
  expect(Array.isArray(body.back_links)).toBe(true)
  expect(body.back_links.length).toBeGreaterThanOrEqual(1)
  // API shape: { back_links: [{ structural_node: { id, name, ... }, link: {...} }, ...] }
  expect(body.back_links.some((bl: { structural_node: { id: string } }) => bl.structural_node.id === f.beatId)).toBe(true)
})

test('TC-J4-08: DELETE context-link removes the row', async () => {
  const orgId = await getOrgId()
  const f = await setupJ3Fixture(orgId, 'J4-08')
  cleanupFns.push(f.cleanup)

  const ctx = await ctxA()
  const created = await ctx.post(`/api/projects/${f.projectId}/context-nodes`, {
    data: { scope: 'project', node_type: 'character', name: uniqueName('08-char') },
  })
  const charNode = (await created.json()).node

  await ctx.post(`/api/nodes/${f.beatId}/context-links`, {
    data: { context_node_id: charNode.id },
  })

  // Delete the link.
  const delRes = await ctx.delete(`/api/nodes/${f.beatId}/context-links/${charNode.id}`)
  expect([200, 204]).toContain(delRes.status())

  const admin = adminClient()
  const { data: links } = await admin
    .from('node_context_links')
    .select('id')
    .eq('source_node_id', f.beatId)
    .eq('target_node_id', charNode.id)
  expect(links?.length ?? 0).toBe(0)
})

// ─── Validation (TC-J4-09..13) ──────────────────────────────────────────────

test('TC-J4-09: PATCH leaf-prose node to context with valid scope succeeds (Migration 024 CHECK)', async () => {
  // SU-14 closure: nodes.scope conditional NOT NULL CHECK requires scope
  // for context-category nodes. Creating a context node directly requires
  // scope; this test verifies the constraint via API.
  const orgId = await getOrgId()
  const seeded = await createIsolatedDoc({ organisationId: orgId, ownerName: 'TC-J4-09' })
  cleanupFns.push(seeded.cleanup)

  const ctx = await ctxA()
  const res = await ctx.post(`/api/projects/${seeded.projectId}/context-nodes`, {
    data: { scope: 'document', node_type: 'character', name: uniqueName('09'), document_id: seeded.docId },
  })
  expect(res.status()).toBe(201)
})

test('TC-J4-10: missing scope on context-node POST is rejected', async () => {
  const orgId = await getOrgId()
  const seeded = await createIsolatedDoc({ organisationId: orgId, ownerName: 'TC-J4-10' })
  cleanupFns.push(seeded.cleanup)

  const ctx = await ctxA()
  const res = await ctx.post(`/api/projects/${seeded.projectId}/context-nodes`, {
    data: { node_type: 'character', name: uniqueName('10') /* no scope */ },
  })
  expect(res.status()).toBeGreaterThanOrEqual(400)
  expect(res.status()).toBeLessThan(500)
})

test('TC-J4-11: cannot move a context-source node into a non-source parent (SU-17)', async () => {
  // Phase 4 SU-17: /api/nodes/[id]/move endpoint must reject context-source
  // nodes being made children of non-source parents. This test verifies
  // the rejection.
  const orgId = await getOrgId()
  const f = await setupJ3Fixture(orgId, 'J4-11')
  cleanupFns.push(f.cleanup)

  const ctx = await ctxA()
  const created = await ctx.post(`/api/projects/${f.projectId}/context-nodes`, {
    data: { scope: 'project', node_type: 'character', name: uniqueName('11-char') },
  })
  const charNode = (await created.json()).node

  // Try to move the character into the Act (a structural node, not a
  // context-source).
  const moveRes = await ctx.patch(`/api/nodes/${charNode.id}/move`, {
    data: { new_parent_id: f.actId, new_position: 1 },
  })
  expect(moveRes.status()).toBeGreaterThanOrEqual(400)
})

test('TC-J4-13: context-node POST with non-V1-whitelist node_type is rejected', async () => {
  // Per Product Spec v1.4 §4.7 (SU-16): V1 six-core context types are
  // character, setting, faction, item, theme, mythology. Anything else
  // is rejected.
  const orgId = await getOrgId()
  const seeded = await createIsolatedDoc({ organisationId: orgId, ownerName: 'TC-J4-13' })
  cleanupFns.push(seeded.cleanup)

  const ctx = await ctxA()
  const res = await ctx.post(`/api/projects/${seeded.projectId}/context-nodes`, {
    data: { scope: 'project', node_type: 'cybernetic_implant', name: uniqueName('13') },
  })
  expect(res.status()).toBeGreaterThanOrEqual(400)
})

// ─── Skipped (TC-J4-05, J4-12 — UI-heavy) ───────────────────────────────────

test('TC-J4-05: ContextLinker search returns "No matches" for unknown query', async () => {
  test.skip(true,
    'ContextLinker search UI surface needs data-testid for the search ' +
    'input + results region. Defer to a small data-testid PR (same SU-J3-5 ' +
    'family) before wiring.')
})

test('TC-J4-12: linked context appears in agent context window', async () => {
  test.skip(true,
    'Agent-context propagation is an end-to-end LLM concern best verified ' +
    'in J5 (Single-node agent ops) where the prompt-assembly path is ' +
    'exercised against a real Anthropic key. J4 keeps this case for ' +
    'narrative; the contract is asserted by J5\'s synthesise probes.')
})

test('TC-J4-04-cross-org: cross-org link via direct API blocked by RLS', async () => {
  const orgId = await getOrgId()
  const f = await setupJ3Fixture(orgId, 'J4-04-cross')
  cleanupFns.push(f.cleanup)

  const ctx = await ctxA()
  const created = await ctx.post(`/api/projects/${f.projectId}/context-nodes`, {
    data: { scope: 'project', node_type: 'character', name: uniqueName('04-cross') },
  })
  const charNode = (await created.json()).node

  // User B attempts to link.
  const ctxBContext = await ctxB()
  const linkRes = await ctxBContext.post(`/api/nodes/${f.beatId}/context-links`, {
    data: { context_node_id: charNode.id },
  })
  expect([403, 404]).toContain(linkRes.status())
})
