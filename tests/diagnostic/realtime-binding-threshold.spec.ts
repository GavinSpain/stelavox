/**
 * Diagnostic: find at what binding-count / configuration the multiplexed
 * channel breaks. Pure Node-side test — no browser involved.
 *
 * Run: npx playwright test tests/diagnostic/realtime-binding-threshold.spec.ts --reporter=list --workers=1 --retries=0
 */

import { test } from '@playwright/test'
import { createClient, type RealtimeChannel } from '@supabase/supabase-js'
import { adminClient } from '../helpers/db'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

const ORG_SCOPED = [
  'nodes',
  'agent_jobs',
  'briefs',
  'export_jobs',
  'project_profiles',
] as const

const UNFILTERED = [
  'brief_stages',
  'conversation_messages',
  'director_turns',
  'profile_amendments',
  'organisations',
  'workflows',
  'workflow_steps',
] as const

interface TestRow {
  table: string
  id: string
  organisation_id: string | null
}

async function getUserOrgIdAndSession(): Promise<{ orgId: string; accessToken: string }> {
  // Use the local dev user — author@stelavox.local — who owns Shadow
  // Protocol and has populated rows in every realtime topic. The
  // generic `USERS.A` fixture user has an empty org, which produces
  // false negatives in this diagnostic (no rows to UPDATE => no events
  // to receive).
  const anon = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data: signIn, error: signInErr } = await anon.auth.signInWithPassword({
    email: 'author@stelavox.local',
    password: 'Test1234!Test1234!',
  })
  if (signInErr || !signIn?.session) throw new Error(`signin failed: ${signInErr?.message}`)
  const accessToken = signIn.session.access_token
  const userId = signIn.user!.id

  // Resolve org via service-role client.
  const admin = adminClient()
  const { data } = await admin
    .from('organisation_members')
    .select('organisation_id')
    .eq('user_id', userId)
    .single()
  if (!data?.organisation_id) throw new Error('no org for test user')
  return { orgId: data.organisation_id, accessToken }
}

async function setupTestRows(orgId: string): Promise<TestRow[]> {
  const admin = adminClient()
  const out: TestRow[] = []
  // For each topic, find a row that the user (whose org is `orgId`) is
  // RLS-allowed to see. Nested-RLS tables require following the chain
  // (brief_stages → briefs.organisation_id, conversation_messages →
  // documents.organisation_id, etc.).
  for (const table of [...ORG_SCOPED, ...UNFILTERED]) {
    let id: string | null = null
    if ((ORG_SCOPED as readonly string[]).includes(table)) {
      const { data } = await admin
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .from(table as any)
        .select('id')
        .eq('organisation_id', orgId)
        .limit(1)
        .maybeSingle<{ id: string }>()
      id = data?.id ?? null
    } else if (table === 'brief_stages') {
      const { data } = await admin
        .from('brief_stages')
        .select('id, briefs!inner(organisation_id)')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .eq('briefs.organisation_id' as any, orgId)
        .limit(1)
        .maybeSingle<{ id: string }>()
      id = data?.id ?? null
    } else if (table === 'conversation_messages') {
      const { data } = await admin
        .from('conversation_messages')
        .select('id, conversations!inner(documents!inner(organisation_id))')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .eq('conversations.documents.organisation_id' as any, orgId)
        .limit(1)
        .maybeSingle<{ id: string }>()
      id = data?.id ?? null
    } else if (table === 'director_turns') {
      const { data } = await admin
        .from('director_turns')
        .select('id, conversations!inner(documents!inner(organisation_id))')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .eq('conversations.documents.organisation_id' as any, orgId)
        .limit(1)
        .maybeSingle<{ id: string }>()
      id = data?.id ?? null
    } else if (table === 'profile_amendments') {
      const { data } = await admin
        .from('profile_amendments')
        .select('id, project_profiles!inner(organisation_id)')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .eq('project_profiles.organisation_id' as any, orgId)
        .limit(1)
        .maybeSingle<{ id: string }>()
      id = data?.id ?? null
    } else if (table === 'organisations') {
      // The user IS a member of orgId, so they can see this org's row.
      const { data } = await admin
        .from('organisations')
        .select('id')
        .eq('id', orgId)
        .limit(1)
        .maybeSingle<{ id: string }>()
      id = data?.id ?? null
    } else if (table === 'workflows' || table === 'workflow_steps') {
      // workflows IS org-scoped despite isOrgScoped returning false in
      // the production code. Pick a row from the user's org.
      if (table === 'workflows') {
        const { data } = await admin
          .from('workflows')
          .select('id')
          .eq('organisation_id', orgId)
          .limit(1)
          .maybeSingle<{ id: string }>()
        id = data?.id ?? null
      } else {
        // workflow_steps → workflows.organisation_id
        const { data } = await admin
          .from('workflow_steps')
          .select('id, workflows!inner(organisation_id)')
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .eq('workflows.organisation_id' as any, orgId)
          .limit(1)
          .maybeSingle<{ id: string }>()
        id = data?.id ?? null
      }
    }
    if (id) out.push({ table, id, organisation_id: null })
  }
  return out
}

interface BindingDef {
  table: string
  filter?: string
}

/**
 * Open a channel with the given bindings, wait for SUBSCRIBED, then
 * resolve with the receiver function that the caller can poll after
 * firing UPDATEs. Caller calls dispose() to cleanly tear down.
 */
async function openChannel(
  accessToken: string,
  channelName: string,
  bindings: BindingDef[],
): Promise<{
  received: Array<{ table: string; eventType: string; id: string }>
  dispose: () => Promise<void>
  channel: RealtimeChannel
}> {
  const client = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  await client.auth.setSession({ access_token: accessToken, refresh_token: '' })
  client.realtime.setAuth(accessToken)

  const received: Array<{ table: string; eventType: string; id: string }> = []
  let ch = client.channel(channelName)
  for (const b of bindings) {
    const filter: Record<string, string> = {
      event: '*',
      schema: 'public',
      table: b.table,
    }
    if (b.filter) filter.filter = b.filter
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ch = (ch as any).on('postgres_changes', filter, (payload: { new?: { id?: string }; old?: { id?: string }; eventType?: string }) => {
      received.push({
        table: b.table,
        eventType: payload.eventType ?? '?',
        id: (payload.new?.id ?? payload.old?.id ?? '?').slice(0, 8),
      })
    })
  }
  await new Promise<void>((resolve, reject) => {
    ch.subscribe((status) => {
      if (status === 'SUBSCRIBED') resolve()
      else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        reject(new Error(`channel ${channelName} ${status}`))
      }
    })
    setTimeout(() => reject(new Error(`channel ${channelName} subscribe timeout`)), 10000)
  })

  return {
    received,
    channel: ch,
    dispose: async () => {
      await client.removeChannel(ch)
    },
  }
}

/** Fire a no-op UPDATE on every (table,id) listed.
 *  Uses raw SQL via supabase db query so the update is guaranteed to
 *  work regardless of which timestamp column the table has (some tables
 *  have `updated_at`, some `last_active_at`, etc.). */
async function fireUpdates(rows: TestRow[]) {
  for (const row of rows) {
    // `SET id = id` is a self-update that PostgreSQL still emits as a
    // WAL UPDATE event (it doesn't optimise these away).
    const sql = `UPDATE public.${row.table} SET id = id WHERE id = '${row.id}';`
    const { execSync } = await import('node:child_process')
    try {
      execSync(`supabase db query "${sql}"`, { stdio: 'pipe' })
    } catch (e) {
      // eslint-disable-next-line no-console
      console.log(`[fireUpdates] FAILED on ${row.table}: ${(e as Error).message?.slice(0, 100)}`)
    }
  }
}

test.describe('realtime binding threshold diagnosis', () => {
  let orgId: string
  let accessToken: string
  let rows: TestRow[]

  test.beforeAll(async () => {
    const session = await getUserOrgIdAndSession()
    orgId = session.orgId
    accessToken = session.accessToken
    rows = await setupTestRows(orgId)
    console.log(`[setup] orgId=${orgId.slice(0, 8)} rows=${rows.length} for [${rows.map((r) => r.table).join(', ')}]`)
  })

  /** Build cases as an ordered list so we get a coherent narrative. */
  function cases(): Array<{ name: string; bindings: () => BindingDef[]; targetTables: () => string[] }> {
    return [
      {
        name: '1 binding — filtered, org-scoped (export_jobs)',
        bindings: () => [{ table: 'export_jobs', filter: `organisation_id=eq.${orgId}` }],
        targetTables: () => ['export_jobs'],
      },
      {
        name: '1 binding — unfiltered (brief_stages)',
        bindings: () => [{ table: 'brief_stages' }],
        targetTables: () => ['brief_stages'],
      },
      {
        name: '2 bindings — both filtered',
        bindings: () => [
          { table: 'export_jobs', filter: `organisation_id=eq.${orgId}` },
          { table: 'briefs', filter: `organisation_id=eq.${orgId}` },
        ],
        targetTables: () => ['export_jobs', 'briefs'],
      },
      {
        name: '5 bindings — all filtered (org-scoped)',
        bindings: () => ORG_SCOPED.map((t) => ({ table: t, filter: `organisation_id=eq.${orgId}` })),
        targetTables: () => [...ORG_SCOPED],
      },
      {
        name: '7 bindings — all unfiltered',
        bindings: () => UNFILTERED.map((t) => ({ table: t })),
        targetTables: () => [...UNFILTERED],
      },
      {
        name: '12 bindings — mixed (PRODUCTION shape)',
        bindings: () => [
          ...ORG_SCOPED.map((t) => ({ table: t, filter: `organisation_id=eq.${orgId}` })),
          ...UNFILTERED.map((t) => ({ table: t })),
        ],
        targetTables: () => [...ORG_SCOPED, ...UNFILTERED],
      },
    ]
  }

  for (const tc of cases()) {
    test(tc.name, async () => {
      const bindings = tc.bindings()
      const targetTables = tc.targetTables()
      const targetRows = rows.filter((r) => targetTables.includes(r.table))
      const channelName = `diag-${Math.random().toString(36).slice(2)}`

      const probe = await openChannel(accessToken, channelName, bindings)
      // Give the broker a moment after SUBSCRIBED to register bindings server-side.
      await new Promise((r) => setTimeout(r, 1500))
      // Fire UPDATEs one at a time with a small gap to avoid racing the broker.
      for (const row of targetRows) {
        await fireUpdates([row])
        await new Promise((r) => setTimeout(r, 250))
      }
      // Wait generously for all events to flow back.
      await new Promise((r) => setTimeout(r, 4000))
      await probe.dispose()

      const summary = probe.received
        .map((e) => `${e.table}/${e.eventType}/${e.id}`)
        .join(', ')
      const count = probe.received.length
      console.log(`[result] "${tc.name}": ${count}/${targetTables.length} events — ${summary || '(none)'}`)
    })
  }
})
