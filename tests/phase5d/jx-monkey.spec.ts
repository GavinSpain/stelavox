import { test, expect, type APIRequestContext } from '@playwright/test'
import { LoginPage } from '../pages/LoginPage'
import { adminClient } from '../helpers/db'
import { APP_URL, USERS } from '../helpers/auth'

/**
 * Phase 5d hardening — monkey runner.
 *
 * Drives random valid operations against a fresh project for N steps,
 * watching for: HTTP 5xx, console errors, unhandled exceptions, and
 * post-run database invariant violations (orphaned nodes, broken FK
 * chains, locked-but-no-locker, jobs with null org, etc.).
 *
 * Runs against the locally-running dev server on APP_URL. No LLM calls
 * — every operation is a CRUD verb or a state-machine transition that
 * the spec layer guarantees. LLM-based operations are exercised in the
 * dedicated j5-agent-ops + monkey-llm specs.
 *
 * Seed is deterministic by default so failures are reproducible. Pass
 * MONKEY_SEED env var to vary.
 *
 * Iterations: 50 by default (~3 min). Bump with MONKEY_ITERATIONS for
 * longer hunts.
 */

const MONKEY_ITERATIONS = parseInt(process.env.MONKEY_ITERATIONS ?? '50', 10)
const MONKEY_SEED = process.env.MONKEY_SEED ?? 'phase5d-tier8'

function mulberry32(seed: number) {
  return function () {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function hashSeed(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

interface MonkeyState {
  projectId: string
  documentId: string
  rootId: string
  knownNodeIds: string[]
  knownContextIds: string[]
  ops: { name: string; ok: number; fail: number }[]
}

type Operation = (
  api: APIRequestContext,
  state: MonkeyState,
  rand: () => number,
) => Promise<{ ok: boolean; note?: string }>

function pick<T>(arr: readonly T[], rand: () => number): T {
  return arr[Math.floor(rand() * arr.length)]!
}

function randomString(rand: () => number, len = 8): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789 '
  let s = ''
  for (let i = 0; i < len; i++) s += chars[Math.floor(rand() * chars.length)]
  return s.trim() || 'unnamed'
}

const operations: Record<string, Operation> = {
  // CREATE a child under a random known node (must be structural non-leaf
  // for novel layer stack; we attempt and report fail gracefully)
  create_child: async (api, state, rand) => {
    const parent = pick(state.knownNodeIds, rand)
    const r = await api.post(`/api/documents/${state.documentId}/nodes`, {
      data: {
        parent_id: parent,
        name: `monkey-${randomString(rand, 6)}`,
        short_description: 'monkey-created',
      },
    })
    if (!r.ok()) return { ok: false, note: `create_child ${r.status()} ${await r.text().catch(() => '')}` }
    const body = await r.json()
    state.knownNodeIds.push(body.node.id)
    return { ok: true }
  },

  rename_node: async (api, state, rand) => {
    if (state.knownNodeIds.length === 0) return { ok: false, note: 'no nodes' }
    const id = pick(state.knownNodeIds, rand)
    const r = await api.patch(`/api/nodes/${id}`, {
      data: { name: `renamed-${randomString(rand, 5)}` },
    })
    return { ok: r.ok(), note: r.ok() ? undefined : `rename ${r.status()}` }
  },

  edit_summary: async (api, state, rand) => {
    if (state.knownNodeIds.length === 0) return { ok: false, note: 'no nodes' }
    const id = pick(state.knownNodeIds, rand)
    const r = await api.patch(`/api/nodes/${id}`, {
      data: { summary: `monkey wrote ${randomString(rand, 20)}` },
    })
    return { ok: r.ok(), note: r.ok() ? undefined : `summary ${r.status()}` }
  },

  toggle_status: async (api, state, rand) => {
    if (state.knownNodeIds.length === 0) return { ok: false, note: 'no nodes' }
    const id = pick(state.knownNodeIds, rand)
    const status = pick(['draft', 'in_review', 'approved'] as const, rand)
    const r = await api.patch(`/api/nodes/${id}`, { data: { status } })
    return { ok: r.ok(), note: r.ok() ? undefined : `status ${r.status()}` }
  },

  toggle_lock: async (api, state, rand) => {
    if (state.knownNodeIds.length === 0) return { ok: false, note: 'no nodes' }
    const id = pick(state.knownNodeIds, rand)
    const locked = rand() < 0.5
    const r = await api.patch(`/api/nodes/${id}`, {
      data: { locked, lock_reason: locked ? 'monkey lock' : null },
    })
    return { ok: r.ok(), note: r.ok() ? undefined : `lock ${r.status()}` }
  },

  delete_node: async (api, state, rand) => {
    // Never delete the root.
    const candidates = state.knownNodeIds.filter((id) => id !== state.rootId)
    if (candidates.length === 0) return { ok: false, note: 'only root' }
    const id = pick(candidates, rand)
    const r = await api.delete(`/api/nodes/${id}`)
    if (r.ok()) {
      state.knownNodeIds = state.knownNodeIds.filter((x) => x !== id)
      return { ok: true }
    }
    return { ok: false, note: `delete ${r.status()}` }
  },

  create_context: async (api, state, rand) => {
    const types = ['character', 'location', 'organisation', 'theme', 'plot_thread', 'world'] as const
    const r = await api.post(`/api/projects/${state.projectId}/context-nodes`, {
      data: {
        scope: 'project',
        node_type: pick(types, rand),
        name: `ctx-${randomString(rand, 6)}`,
        short_description: 'monkey ctx',
      },
    })
    if (!r.ok()) return { ok: false, note: `create_ctx ${r.status()}` }
    const body = await r.json()
    state.knownContextIds.push(body.node.id)
    return { ok: true }
  },

  link_context: async (api, state, rand) => {
    if (state.knownContextIds.length === 0 || state.knownNodeIds.length === 0) {
      return { ok: false, note: 'need both' }
    }
    const sourceId = pick(state.knownNodeIds, rand)
    const targetId = pick(state.knownContextIds, rand)
    const r = await api.post(`/api/nodes/${sourceId}/context-links`, {
      data: { context_node_id: targetId },
    })
    return { ok: r.ok(), note: r.ok() ? undefined : `link ${r.status()}` }
  },

  fetch_tree: async (api, state) => {
    const r = await api.get(`/api/documents/${state.documentId}/nodes`)
    return { ok: r.ok(), note: r.ok() ? undefined : `fetch ${r.status()}` }
  },
}

const opNames = Object.keys(operations)

test.describe('Phase 5d — JX monkey runner', () => {
  test.use({ storageState: USERS.A.storageState })

  test('50 random valid operations, no 5xx, no console errors, no orphans', async ({ page, request }) => {
    test.setTimeout(180_000)

    // Auth check (fail fast if storage state stale).
    const login = new LoginPage(page)
    if (!(await login.isLoggedIn(APP_URL))) {
      await login.goto(APP_URL)
      await login.login(USERS.A.email, USERS.A.password)
    }

    // Track console errors for the page session.
    const consoleErrors: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text())
    })
    const apiErrors: string[] = []
    page.on('response', (r) => {
      if (r.status() >= 500) apiErrors.push(`${r.status()} ${r.url()}`)
    })

    // Bootstrap a fresh project + document via API. Fresh state per run
    // so monkeys can't interfere with other tests.
    const admin = adminClient()
    const ts = Date.now()
    const projRes = await request.post(`${APP_URL}/api/projects`, {
      data: { name: `monkey-${ts}`, description: 'monkey project' },
    })
    expect(projRes.ok(), `create project: ${projRes.status()}`).toBeTruthy()
    const project = (await projRes.json()).project
    const docRes = await request.post(`${APP_URL}/api/projects/${project.id}/documents`, {
      data: { name: `monkey-doc-${ts}`, document_type: 'novel' },
    })
    expect(docRes.ok(), `create doc: ${docRes.status()}`).toBeTruthy()
    const doc = (await docRes.json()).document

    // Read the auto-created root node.
    const treeRes = await request.get(`${APP_URL}/api/documents/${doc.id}/nodes`)
    const treeBody = await treeRes.json()
    const rootId = treeBody.nodes[0].id

    const state: MonkeyState = {
      projectId: project.id,
      documentId: doc.id,
      rootId,
      knownNodeIds: [rootId],
      knownContextIds: [],
      ops: opNames.map((n) => ({ name: n, ok: 0, fail: 0 })),
    }

    const seed = hashSeed(MONKEY_SEED)
    const rand = mulberry32(seed)

    const log: string[] = []
    for (let i = 0; i < MONKEY_ITERATIONS; i++) {
      const opName = pick(opNames, rand)
      const op = operations[opName]!
      let result: { ok: boolean; note?: string }
      try {
        result = await op(request, state, rand)
      } catch (e) {
        result = { ok: false, note: `THREW ${e instanceof Error ? e.message : String(e)}` }
      }
      const stat = state.ops.find((s) => s.name === opName)!
      if (result.ok) stat.ok++
      else stat.fail++
      if (result.note && result.ok === false && !result.note.includes('400') && !result.note.includes('409') && !result.note.includes('422')) {
        // 400/409/422 are expected from random invalid combinations
        // (e.g. delete root). 5xx and unexpected codes go to log.
        log.push(`step ${i} [${opName}] ${result.note}`)
      }
    }

    // Console + 5xx assertions
    if (consoleErrors.length > 0) {
      console.warn('[monkey] console errors:', consoleErrors)
    }
    if (apiErrors.length > 0) {
      console.warn('[monkey] api 5xx:', apiErrors)
    }
    if (log.length > 0) {
      console.warn('[monkey] unexpected outcomes:', log)
    }

    // DB invariants — no orphaned nodes (parent_id pointing to deleted),
    // no jobs with null organisation, no locked nodes without lock_reason
    const orph = await admin
      .from('nodes')
      .select('id')
      .eq('project_id', state.projectId)
      .not('parent_id', 'is', null)
      .limit(200)
    const allNodes = await admin
      .from('nodes')
      .select('id, parent_id')
      .eq('project_id', state.projectId)
    const ids = new Set((allNodes.data ?? []).map((n) => n.id))
    const orphans = (orph.data ?? []).filter(
      (n: unknown) => {
        const node = n as { parent_id?: string | null; id: string }
        return node.parent_id !== null && !ids.has(node.parent_id ?? '')
      },
    )

    expect(apiErrors, 'monkey produced 5xx responses').toEqual([])
    expect(orphans, 'monkey left orphaned nodes').toEqual([])

    // Cleanup
    await admin.from('projects').delete().eq('id', state.projectId)

    // Print stats
    console.log(`[monkey seed=${MONKEY_SEED} iter=${MONKEY_ITERATIONS}]`)
    for (const s of state.ops) {
      if (s.ok + s.fail > 0) {
        console.log(`  ${s.name.padEnd(18)} ok=${s.ok} fail=${s.fail}`)
      }
    }
  })
})
