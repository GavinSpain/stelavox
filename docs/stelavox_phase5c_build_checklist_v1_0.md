# Stelavox — Phase 5c Build Checklist
## Version 1.0

> **Tier-B per-phase document.** Frozen for Phase 5c build. Companion to `stelavox_phase5c_api_contract_v1_0.md` and `stelavox_phase5c_test_plan_v1_0.md`. Lists every build task, every pre-build prerequisite, every phase-checkpoint criterion, and the risk register. Cross-cutting build conventions inherited from Phase 5b are not restated.

**Phase:** 5c — synthesise streaming via SSE.

---

## 1. Pre-build prerequisites

### PB-1 — Phase 5b is shipped and verified

Master at `b74de56` or later. All Phase 5b SU items closed (SU-37 through SU-48). Phase 5b Test Report v1.1 verdict = PASS. Cloud rollout complete on `stelavox-dev`.

```
git log --oneline | head -10
# Expect: b74de56 (or later) at top, with the Phase 5b verification merge commit ancestor
```

### PB-2 — Phase 5b corpus + methodology are usable

`fixtures/director-corpus/j5-novel/` and `docs/stelavox_director_eval_methodology_v1_0.md` are in place. The j5-novel fixture is needed for cross-model synthesise verification — the synthesise probes target unlocked beats in Act 1 with realistic synthesise instructions.

### PB-3 — Vitest + Playwright test runners both work

`npm run test:unit` runs the Vitest suite (added at SU-44 close-out). `npx playwright test` runs the Phase 5b smoke suite (`j5-fixture-smoke`, `j5-director-turn`, `j5-workflow-approve`). Both are required for Phase 5c verification.

### PB-4 — Local Supabase running on +10 ports

Same setup as Phase 5b. `supabase status` shows green; Migration 031 applied. No new migration required for Phase 5c.

### PB-5 — `stream()` provider stub still throws NotImplementedError

```
grep -n "NotImplementedError" lib/llm/providers/anthropic.ts
# Expect: line 96 (stream) throws — Phase 5c implements this
```

If `stream()` has been implemented since Phase 5b close-out, that's a separate change — pause and reconcile before Phase 5c proceeds.

### PB-6 — ANTHROPIC_API_KEY shell-env workaround applied

Per `reference_anthropic_key_shell_override.md`: the Windows shell may carry an empty `ANTHROPIC_API_KEY` env var that overrides `.env.local`. Phase 5c streaming verification requires real LLM calls; prepend `unset ANTHROPIC_API_KEY` to all dev / test invocations.

---

## 2. Phase Checkpoint Criteria

Phase 5c ships when **all** of the following pass:

### CK-1 — End-to-end "user clicks Synthesise" walk

Author opens an existing j5-novel beat (any unlocked leaf in Act 1), clicks Synthesise in the AgentTab, watches prose appear progressively in the streaming surface. Cancel button works mid-stream. Final prose lands cleanly on `agent_jobs.result_prose`; the AgentTab transitions to the accept / dismiss view; node version advances on accept.

Concrete acceptance: an `agent_jobs` row exists with `status='completed'`, `triggered_by='user'`, `tokens_input + tokens_output > 0`, `result_prose` populated; the SSE stream emitted at least 5 `text_delta` events plus the final `usage` + `agent_job_complete` + `done` envelope.

### CK-2 — Cancellation lands cleanly

Author clicks Synthesise, waits for the first delta to land in the typewriter surface, clicks Cancel. The Anthropic stream is aborted; the SSE connection closes; `agent_jobs.status='cancelled'` with `error_message='client_disconnect'`. No orphan agent_jobs in `running` state.

### CK-3 — Workflow-dispatched synthesise unaffected

A Director-approved workflow with a synthesise step continues to run via the existing background path. The workflow's ExecutionCard surfaces step progress via realtime on `agent_jobs`. The new `/api/agent/synthesise/stream` endpoint is **never** called from the workflow_executor. SU-48 catch-up still applies the result via `accept_agent_job`. Verified by re-running the Phase 5b TC-A-15 spec post-Phase-5c implementation.

### CK-4 — Locked-node respect at the streaming endpoint

A POST to `/api/agent/synthesise/stream` against a locked node returns `423 node_locked` before the stream opens. No agent_job row is created.

### CK-5 — Cross-org tool calls denied

A POST against a node in another organisation returns `403 forbidden` (or `404 node_not_found` per RLS shape). No agent_job row created. No LLM call.

### CK-6 — Concurrency: one running synthesise per node

A POST against a node that already has a running agent_job (from any source — direct synthesise, workflow step, anything) returns `409 agent_job_in_progress` before the stream opens. Same constraint as Phase 5 `POST /api/agent/jobs`.

### CK-7 — Heartbeat liveness

During a streaming synthesise, `agent_jobs.last_heartbeat_at` updates at least every 10 seconds. The Phase 5b recovery sweep (`/api/cron/director-recovery`) marks stalled streaming jobs `failed` with `error_message='heartbeat_timeout'`.

### CK-8 — Canary defence

A simulated canary leak (forced via mock or test-mode flag) terminates the stream with an SSE `error` event of code `canary_violation`. The agent_job is marked `failed` with `error_message='canary_leak'`.

### CK-9 — Substrate gates green

`npm run type-check` exit 0; `npm run lint` exit 0 (8 pre-existing baseline warnings); `npm run build` exit 0; `npm run test:unit` all PASS; full Playwright suite PASS minus the one pre-existing Character role-enum drift; `diff CLAUDE.md docs/CLAUDE_stelavox_project.md` empty.

### CK-10 — Cross-model synthesise verification on j5-novel

The j5-novel corpus is extended with synthesise probes (a new probe class in `probes.ts`) targeting specific beat nodes. Cross-model triple-baseline run confirms streaming works on Haiku 4.5 / Sonnet 4.6 / Opus 4.7 with no regressions. SU-46 (temperature deprecation) coverage extends to the new `stream()` method.

### CK-11 — Cloud rollout

The new `/api/agent/synthesise/stream` endpoint deploys to `stelavox-dev` (Vercel auto-deploy on master push). A cloud smoke probe — one streaming synthesise against the cloud — passes end-to-end. No schema migration is needed for Phase 5c.

### CK-12 — Component Spec amendment merged

`stelavox_component_specification_v2_8.md` → `v2_9.md` with §5.9 streaming subsection added. Critical Component Specifications row in CLAUDE.md updated to reference v2.9.

### CK-13 — Test Report v1.0 + close-out absorption

`stelavox_phase5c_test_report_v1_0.md` authored with verdict + per-CK pass/fail table. TA v2.1 → v2.2, Product Spec v1.7 → v1.8, Component Spec v2.8 → v2.9, CLAUDE.md v1.13 → v1.14 absorbed. Phase Plan §11 row 5c moves "MET" status. Director architecture deep review remains queued for V1.1+.

---

## 3. Tasks

### T-1 — `provider.stream()` implementation (Anthropic)

**File:** `lib/llm/providers/anthropic.ts`

Replace the NotImplementedError stub at line 96 with a full implementation. Mirror `streamWithTools` minus the tool-call branch:

- Build system blocks with `cache_control: ephemeral` per TA §7.3 (cache hit on second call ~56% input savings).
- Inject canary token in the system prompt body via `injectCanary()`.
- Skip `temperature` for Opus 4.7+ via the `modelAcceptsTemperature()` denylist (SU-46 carry-forward).
- Open the upstream stream via `this.client.messages.stream({...})` with no `tools` argument.
- Iterate the SDK event stream, yielding `LLMStreamChunk` values:
  - `content_block_delta` of type `text_delta` → yield `{ type: 'text', text }`
  - `message_delta` capturing `stop_reason` + running `output_tokens`
  - `message_stop` → yield `{ type: 'message_stop', usage, stopReason }`
- Run `scanForCanaryLeak()` on the accumulated text after every delta. Throw `SecurityViolationError` on detection.
- Honour cancellation: if the consumer breaks out of the iteration (or Node closes the underlying stream), the SDK's stream object is automatically aborted.

**No new types.** `LLMStreamChunk` already supports `text` / `message_stop` chunk types — they are reused from `streamWithTools`.

**Acceptance:** A simple Vitest unit test calls `provider.stream()` against a real Anthropic key (skipped without `ANTHROPIC_API_KEY`) and verifies at least one text chunk + a final message_stop chunk arrive in order.

### T-2 — Job lifecycle factoring

**File:** `lib/agent/job-lifecycle.ts` (new)

Extract the shared logic from `lib/agent/runner.ts:runAgentJob` into a module both `runAgentJob` and the new `runAgentJobInline` can compose from. Keep the existing `runAgentJob` byte-for-byte equivalent post-refactor.

Suggested exported shape:

- `loadJobContext(jobId, supabase)`: returns `{ job, profile, provider, modelId, prompt, targetNodeVersion }`. Resolves the job row, the agent profile, the provider via `getProvider`, and assembles the prompt via the existing prompt-assembler.
- `persistRunningStart(jobId, supabase)`: UPDATE `agent_jobs.status='running'`, `started_at=now()`.
- `persistFinalResult(jobId, supabase, result)`: UPDATE the result_* columns + `status='completed'` + `completed_at=now()` + `tokens_*` + `cost_usd`. The result shape is the same as today's terminal-state writes.
- `persistFailure(jobId, supabase, errorMessage)`: UPDATE `status='failed'`, `error_message`, `completed_at=now()`.
- `persistCancellation(jobId, supabase, reason)`: UPDATE `status='cancelled'`, `error_message=reason`, `completed_at=now()`.
- `notifyWorkflowIfStep(jobId, supabase)`: existing helper, re-exported here for the inline path. (Currently lives at `lib/agent/runner.ts:62`; lift here.)

**Acceptance:** `runAgentJob` after the refactor produces byte-for-byte the same DB transitions as before. The Phase 5b TC-A-15 test (`tests/director/j5-workflow-approve.spec.ts`) re-runs and PASSES — that test exercises the whole background path including SU-48 catch-up.

### T-3 — `runAgentJobInline()` for SSE

**File:** `lib/agent/runner.ts` (new export alongside existing `runAgentJob`)

A new generator function that runs synthesise inline and yields events suitable for the SSE route:

```typescript
export async function* runAgentJobInline(jobId: string): AsyncGenerator<InlineRunnerEvent>
```

Where `InlineRunnerEvent` is one of:
- `{ type: 'job_created', payload }`
- `{ type: 'text_delta', delta: string }`
- `{ type: 'usage', payload }`
- `{ type: 'job_complete', payload }`
- `{ type: 'error', error: string, message: string }`

Internally:

1. `loadJobContext(jobId, supabase)`
2. `persistRunningStart(...)`
3. yield `job_created`
4. Open `provider.stream(prompt)`. For each `text` chunk: append to result_prose accumulator, run canary scan, yield `text_delta`.
5. On `message_stop`: capture usage. Build the final `result_prose` Tiptap-JSON-stringified body. `persistFinalResult(...)`. yield `usage`. yield `job_complete`.
6. On error: `persistFailure(...)`. yield `error`. End generator.
7. On consumer abort (the for-await loop breaks): `persistCancellation(...)`. End generator.

**Acceptance:** Direct unit test calls `runAgentJobInline(jobId)` against a seeded job and a real Anthropic key (skipped without key). Verifies the yield sequence is `job_created` → ≥1 `text_delta` → `usage` → `job_complete`. agent_jobs row ends with `status='completed'` + populated `result_prose`.

### T-4 — `POST /api/agent/synthesise/stream` route

**File:** `app/api/agent/synthesise/stream/route.ts` (new)

The SSE wire surface. Runs validation in HTTP-error space (returning JSON 4xx for pre-stream failures), then opens an SSE response and pipes `runAgentJobInline()` events.

Structure (pseudocode):

```typescript
export async function POST(request: NextRequest) {
  // 1. Auth + body parse + validation (HTTP-error-space)
  const userClient = await createClient()
  const { data: { user } } = await userClient.auth.getUser()
  if (!user) return apiError(401, 'unauthenticated')
  const body = await request.json()
  const parsed = SynthesiseStreamRequestSchema.safeParse(body)
  if (!parsed.success) return apiError(422, 'validation_failed', parsed.error.message)

  // 2. Node visibility, leaf check, lock check, concurrency check
  // (returns appropriate 4xx codes per API Contract §3.1 validation order)

  // 3. Token-budget gate (Phase 5 H-07) — runs before the agent_job row is created
  await checkTokenBudget({...})

  // 4. INSERT agent_jobs row
  const { data: job } = await admin
    .from('agent_jobs')
    .insert({...})
    .select('id, ...').single()

  // 5. Open SSE response
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder()
      const send = (event: string, data: unknown) =>
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))

      const heartbeatInterval = setInterval(() => send('heartbeat', { ts: new Date().toISOString() }), 10_000)
      const dbHeartbeatInterval = setInterval(() => admin.from('agent_jobs').update({ last_heartbeat_at: new Date().toISOString() }).eq('id', job.id), 5_000)

      try {
        for await (const event of runAgentJobInline(job.id)) {
          if (request.signal.aborted) break
          send(event.type, event.payload)
        }
        send('done', {})
      } catch (err) {
        send('error', { error: 'internal_error', message: err.message })
      } finally {
        clearInterval(heartbeatInterval)
        clearInterval(dbHeartbeatInterval)
        controller.close()
      }
    },
    cancel() {
      // Client disconnected — runAgentJobInline already handles persistence
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store',
      'Connection': 'keep-alive',
    },
  })
}

export const maxDuration = 300  // 5 minutes — same as Director's message route
```

**Acceptance:** Manual test in dev: POST to the endpoint with a real session cookie, observe SSE events arriving via curl with `--no-buffer`. Then automated via the Playwright spec in T-9.

### T-5 — Synthesise stream-message client helper

**File:** `lib/agent/streamSynthesise.ts` (new)

Mirror of `lib/director/streamMessage.ts` but for the synthesise endpoint. Wraps `fetch` + `ReadableStream` parsing. Calls a callback for each recognised event. Returns a Promise that resolves on `done` or an error event, or rejects on transport failure.

Interface:

```typescript
export interface SynthesiseStreamRequest {
  nodeId: string
  profileId?: string
  agentInstruction?: string
  signal?: AbortSignal
}

export interface SynthesiseStreamHandlers {
  onJobCreated?:  (data: { agent_job_id: string; ... }) => void
  onTextDelta:    (delta: string) => void
  onUsage?:       (data: { tokens_input: number; ... }) => void
  onJobComplete:  (data: { agent_job_id: string; result_prose: string; ... }) => void
  onError?:       (data: { error: string; message: string }) => void
  onDone?:        () => void
}

export async function streamSynthesise(req, handlers): Promise<void>
```

The same SSE-block parser pattern (`parseSseBlock`) used in `lib/director/streamMessage.ts` is reused — the parser is generic. Consider extracting `parseSseBlock` into a shared `lib/sse/parse.ts` helper if it proves useful. Build Checklist T-5.1 covers that small extraction.

### T-6 — Synthesise streaming UI in AgentTab

**File:** `components/detail/AgentTab.tsx`

When the user clicks Synthesise on a leaf node:

1. Build the request body (node_id from props, profile_id from selection state, agent_instruction from the textarea).
2. Open the SSE connection via `streamSynthesise(...)`.
3. Maintain local state:
   - `streamingText` — accumulated deltas
   - `streamingStatus` — `'connecting' | 'streaming' | 'completed' | 'cancelled' | 'errored'`
   - `cancelHandle` — the `AbortController` for the SSE request
4. Render a streaming surface:
   - `'connecting'` — show "Connecting..." muted text
   - `'streaming'` — show the accumulated text in a typewriter view with a small "streaming…" indicator and a Cancel button
   - `'completed'` — show the existing accept / dismiss view with the full prose rendered
   - `'cancelled' | 'errored'` — clear the surface; show the standard error / cancelled message
5. On `onJobCreated`: store the agent_job_id in local state.
6. On `onTextDelta`: append to `streamingText`.
7. On `onJobComplete`: transition to the completed view; the existing `useActiveJobForNode` hook will pick up the agent_job from realtime and render the post-completion accept / dismiss surface.
8. Cancel button click: `cancelHandle.abort()` — closes the SSE connection.

**Component Spec amendment:** §5.9 in `stelavox_component_specification_v2_8.md` → v2_9 with the streaming surface description.

### T-7 — Workflow integration sanity check

**File:** `lib/director/workflow-executor.ts` — review only, no change expected

Confirm that the workflow_executor's `dispatchAgentJobForStep` continues to dispatch synthesise via the background `runAgentJob` path. No call to `runAgentJobInline` from the executor. The Phase 5b TC-A-15 test re-runs and PASSES post-Phase-5c.

### T-8 — j5-novel synthesise probe class

**File:** `fixtures/director-corpus/j5-novel/probes.ts`

Add a new probe class `synthesise` for Phase 5c verification:

```typescript
export const SYNTHESISE_PROBES = [
  {
    id: 'P-SYNTH-CH3-SC1-BT1',
    targetSlug: 'ch-3-sc-1-bt-1',
    instruction: 'Write the prose for this beat. Keep Voss\'s third-person-close voice and the literary-noir register.',
    summary: 'Synthesise prose for an unlocked beat in Chapter 3 Scene 1.',
  },
  // ... 2-3 more spread across Act 1 chapters
]
```

The probe runner (`scripts/run-director-probe.ts`) gets an extension to support synthesise probes — when `--probe-class synthesise` is passed, it opens the SSE connection (via `streamSynthesise`) and captures the streamed prose.

### T-9 — Functional smoke test

**File:** `tests/agent/synthesise-stream-smoke.spec.ts` (new)

Playwright spec exercising the user-clicks-Synthesise path end-to-end:

1. Login as `j5-walk@example.com`
2. Navigate to a beat node in Act 1
3. Open the AgentTab
4. Click Synthesise
5. Verify the streaming surface appears within 2 seconds
6. Wait for `agent_job_complete`
7. Verify the agent_jobs row is `status='completed'` with non-empty `result_prose` and tokens recorded
8. Verify the AgentTab transitioned to the accept / dismiss view

**Cost:** ~$0.01 per run on Haiku.

### T-10 — Cancellation test

**File:** `tests/agent/synthesise-stream-cancel.spec.ts` (new)

Playwright spec for cancellation:

1. Same setup as T-9
2. Click Synthesise
3. Wait for the first `text_delta` to land in the surface
4. Click Cancel
5. Verify the SSE connection closes
6. Verify `agent_jobs.status='cancelled'`, `error_message='client_disconnect'`

**Cost:** ~$0.005 per run.

### T-11 — Cross-model verification

Run the synthesise probe class on Haiku 4.5 / Sonnet 4.6 / Opus 4.7 via `run-director-comparison.ts` (extended to support synthesise probes per T-8). Score the outputs for V1 launch readiness — the goal is "the synthesise prose is on-brief, in-voice, and the streaming wire works end-to-end on all three models". No detection-rate scoring (synthesise isn't a detection task).

**Cost:** ~$0.20 across the three models for a few probes.

### T-12 — Cloud smoke

Apply the Phase 5c code to `stelavox-dev` via the master push (Vercel auto-deploy). Run one streaming synthesise probe against the cloud deployment using the same env-swap pattern Phase 5b used (local dev server pointed at cloud Supabase, OR the deployed Vercel URL once known). Verify the SSE wire works through Vercel's runtime.

**Cost:** ~$0.01.

### T-13 — Test Report v1.0 + close-out absorption

Author `stelavox_phase5c_test_report_v1_0.md` with the per-CK verdict table. Bump:
- `stelavox_technical_architecture_v2_1.md` → `v2_2.md` (changelog entry; §11 Phase 5c row to "MET")
- `stelavox_product_specification_v1_7.md` → `v1_8.md` (changelog only; user-facing surface unchanged)
- `stelavox_component_specification_v2_8.md` → `v2_9.md` (§5.9 streaming subsection)
- `CLAUDE.md` v1.13 → v1.14 (Spec Library re-points; mirror)

### T-14 — Commits + push

Three commits, in order:
1. **`Phase 5c substrate: provider.stream() + job-lifecycle factoring + runAgentJobInline + SSE endpoint`** — T-1 through T-4
2. **`Phase 5c UI: AgentTab streaming surface + streamSynthesise client helper + Component Spec v2.9`** — T-5, T-6, plus CS bump
3. **`Phase 5c verification: synthesise probe class + smoke + cancellation + cross-model + cloud + Test Report v1.0 + Tier-A absorption`** — T-8 through T-13

---

## 4. Risks

| Risk | Mitigation |
|---|---|
| **Vercel Edge runtime can't keep an SSE connection open for 60+ seconds.** | Mitigated by Phase 5b's same SSE pattern already running on the Director route. Vercel Node.js runtime with `maxDuration = 300` is the configuration. |
| **Anthropic SDK stream's `.abort()` doesn't actually halt billing.** | Documented behaviour: abort halts further token requests; tokens already streamed are still billed. Acceptable — cancellation halts most cost, not all. |
| **Client AbortController doesn't propagate to the request handler in Next.js dev.** | Phase 5b's Director SSE has the same dependency. Verified working in dev via `request.signal.aborted`. Cloud (Vercel) propagates correctly per Vercel docs. |
| **Heartbeat timer leaks on connection close.** | `try / finally` clears both timers in T-4's pseudocode. Tested in T-9. |
| **`provider.stream()` implementation drift from `streamWithTools`.** | Both share the security frame, canary, cache-control, and temperature handling. Build Checklist T-1 explicitly references `streamWithTools` as the structural template. |
| **Plain-text typewriter looks wrong inside a Tiptap-styled panel.** | Use the same typeface (Lora, prose-editor styling) for the typewriter surface so the visual transition at end-of-stream is seamless. Component Spec v2.9 amendment specifies. |
| **Background-running synthesise from workflow looks "frozen" because Phase 5c gives expectations of streaming.** | Documented: workflow-dispatched synthesise stays non-streaming for V1. The ExecutionCard surfaces job-level progress (status, tokens) via realtime. Phase 5c only changes the user-clicks path. |

---

## 5. SU registry

Pre-staged for Phase 5c → TA v2.2 / Product Spec v1.8 / Component Spec v2.9 close-out. Items raised during build:

| ID | Description | Owner | Disposition |
|---|---|---|---|
| (TBD) | (Open during build; tracked in Test Report v1.0 §SU) | | |

---

## 6. Changelog

**v1.0 — 2026-05-08** Initial Phase 5c Build Checklist. Six prerequisites (PB-1 through PB-6). Thirteen phase-checkpoint criteria (CK-1 through CK-13). Fourteen tasks (T-1 through T-14) covering: provider.stream() implementation, job-lifecycle factoring, runAgentJobInline, the new SSE endpoint, the streamSynthesise client helper, the AgentTab streaming UI, workflow-integration sanity check, synthesise probe class extension, functional smoke + cancellation tests, cross-model verification, cloud smoke, Test Report + Tier-A absorption, commits. Seven risks tabulated with mitigations.
