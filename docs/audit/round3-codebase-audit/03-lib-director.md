# Tier A.3 — `lib/director/` audit

**Files in scope:** 12 (types, schemas, sse, heartbeat, route-helpers, streamMessage, conversation-context, executor, workflow-executor, tools/{index, read, write}) — ~3,700 lines

**Spec lens applied:** TA v2.2 §4.5, §8.1–§8.6, H-08 (write tools never execute inside loop), H-09 (BYOK key only in Edge memory), H-12 (no hardcoded operational values), Phase 5b API Contract §2.11 (I-2/I-3/I-9/I-10/I-12), §2.16 (SSE wire format).

---

## Positive finding worth noting first

### F-P1 — `lib/director/tools/write.ts` is H-08 compliant
**Confidence:** certain
**Location:** `lib/director/tools/write.ts:1–263`
Every write-tool executor (`execCreate*Step`) constructs and returns a `WorkflowStepProposal`. None perform DB writes. Cross-org/document/locked checks happen as defence-in-depth even though `validateToolCall` already ran. The single most-load-bearing security invariant in the Director subsystem is correctly implemented at this layer.

The risk that REMAINS — caught by the spec lens — is that H-08 is enforced *by convention*, not by type. A future write tool that accidentally writes to the DB would not be caught by `runAgenticTurn`. See F-95.

---

## `lib/director/types.ts`

### F-78 — `WorkflowStepOperationType` missing `'document_operation'`
**Severity:** LOW   **Confidence:** certain   **Category:** spec-divergence (intentional carve-out, but spec not updated)
**Spec citation:** TA v2.2 §8.3 lists `create_document_operation_step` as a write tool
**Location:** `lib/director/types.ts:10–17`
TA §8.3 lists 7 write tools; code has 6. The 7th (`create_document_operation_step`) is intentionally carved out per `tools/index.ts:9–11`: *"create_document_operation_step is intentionally NOT in this registry per the Phase 5b carve-out."* But TA §8.3 has no carve-out marker. Spec needs updating, not code.
**Recommended fix shape:** add a Phase 5b carve-out note to TA §8.3 and the agent profile library.

### F-79 — `DirectorConfig.status` enum doesn't include `'draft'` or `'beta'`
**Severity:** LOW   **Confidence:** certain   **Category:** spec-divergence
**Spec citation:** TA v2.2 §8.6 ("V2 (designed, not yet built): Full lifecycle: draft → beta → production → deprecated")
**Location:** `lib/director/types.ts:99–102`
TA §8.6 names V2's lifecycle states. Code's V1 enum is `'production' | 'deprecated'`. Code is V1-correct; the type would need expansion when V2 lands. Worth a `// V2: add 'draft' | 'beta'` marker.

### F-80 — spec citation stale
**Severity:** LOW   **Confidence:** certain   **Category:** spec-drift
**Location:** `lib/director/types.ts:4`

---

## `lib/director/schemas.ts`

### F-81 — JSON Schema in `tools/index.ts` and Zod schema in `schemas.ts` are two sources of truth
**Severity:** **HIGH**   **Confidence:** certain   **Category:** silent-failure
**Location:** `lib/director/schemas.ts:164–268` + `lib/director/tools/index.ts:53–293`
Each tool's input is described twice: hand-written JSON Schema in `tools/index.ts` (sent to Anthropic) AND Zod schema in `schemas.ts` (used for `validateToolCall`). The doc on `tools/index.ts:13–15` admits *"It MUST stay in sync with lib/director/schemas.ts"* — manual sync. **Same shape as F-19** (BYOK bool/plan-string two-sources). Drift is a silent injection vector: if the JSON Schema admits a field that Zod doesn't, validateToolCall could pass while the field is silently dropped. Or vice versa.
**Recommended fix shape:** generate JSON Schema from Zod via a build step (`zod-to-json-schema` library). Single source of truth.

### F-82 — `seed_content` accepts empty string in both write tool and proposal
**Severity:** MEDIUM   **Confidence:** certain   **Category:** missing-validation
**Location:** `lib/director/schemas.ts:115, 245`
`seed_content: z.string().max(10_000).optional()` — no minimum. The Director can propose generate_context with an empty `seed_content`, which the workflow executor's `deriveContextName` then handles by capitalising the context_type (`workflow-executor.ts:393–419`). Surface UX is "Theme" / "Character" as the new node's name — meaningless. Whether this is intent or oversight isn't clear.

### F-83 — `comment_type` enum may be narrower than DB column
**Severity:** MEDIUM   **Confidence:** worth-checking   **Category:** spec-divergence
**Location:** `lib/director/schemas.ts:122, 253`
Director admits `'instruction' | 'note'`. Whether the `node_comments.comment_type` column also enumerates `'question'`, `'concern'`, etc. requires checking migrations. If yes, the Director can only create a subset of comment types.

### F-84 — `WorkflowProposalSchema.steps.max(100)` is far above any practical workflow
**Severity:** LOW   **Confidence:** certain   **Category:** missing-validation
**Location:** `lib/director/schemas.ts:152`
100 steps is a lot. The workflow executor's continuation-passing model and dependency-graph machinery probably hasn't been tested at that scale. The default `agent.director_max_workflow_steps` (workflow-executor.ts:317) may already cap below this — but the Zod max admits 100.

---

## `lib/director/sse.ts`

### F-85 — `default: return null` silently drops unknown event types
**Severity:** MEDIUM   **Confidence:** certain   **Category:** silent-failure
**Location:** `lib/director/sse.ts:84–86`
If a new TurnEvent variant is added to `executor.ts` but not added to `turnEventToSse`, the client never sees it. TS exhaustiveness via `const _: never = event` would catch at compile time. Same shape as F-18, F-34, F-37 — missing default/exhaustiveness handlers across the subsystem.

### F-86 — `JSON.stringify(payload)` throws on circular references
**Severity:** LOW   **Confidence:** certain   **Category:** silent-failure
**Location:** `lib/director/sse.ts:25`
A payload with cycles crashes the encoder. Unlikely in practice (TurnEvent shapes are flat) but no safeguard.

---

## `lib/director/heartbeat.ts`

### F-87 — heartbeat failures swallowed without logging
**Severity:** **HIGH**   **Confidence:** certain   **Category:** silent-failure
**Location:** `lib/director/heartbeat.ts:31–38`
Comments justify swallow ("heartbeat failures must not crash the runner"). But: failures are *invisible*. If heartbeats fail for hours (DB pool exhausted, table deadlock), no operator visibility. The recovery cron eventually marks jobs as stalled — correct fail-safe — but with no signal of WHY. Same shape as F-58 (canary log lacks breadcrumb).
**Recommended fix shape:** `console.warn('[heartbeat] failure', { error })` in catch. Don't crash, but don't be silent.

### F-88 — sync throws in `updateFn` are unhandled
**Severity:** MEDIUM   **Confidence:** certain   **Category:** silent-failure
**Location:** `lib/director/heartbeat.ts:31–33, 36–38`
`Promise.resolve(updateFn()).catch(...)` first calls `updateFn()` synchronously. If updateFn throws sync, the throw escapes before `Promise.resolve` wraps it. Sync throws are unhandled and crash the caller despite the "swallow" comment. Defensive: `Promise.resolve().then(updateFn).catch(...)` defers execution.

---

## `lib/director/route-helpers.ts`

### F-89 — `assertConversationAuthor` admits any caller when no user messages exist
**Severity:** **HIGH**   **Confidence:** certain   **Category:** spec-divergence
**Spec citation:** TA v2.2 §4.5 (cross-user authorisation must run); Phase 5b API Contract §2.2 G-2 (author-of-conversation gate)
**Location:** `lib/director/route-helpers.ts:59–64`
Comment justifies: *"For Phase 5b V1 we admit any caller in this edge case (it shouldn't occur — workflows arise from user messages)"*. But "shouldn't occur" is not enforced. If a workflow exists for a conversation with no user messages (race, manual DB insert, future feature), ANY authenticated caller can approve/cancel. Exception bypass to a security check. **Spec doesn't permit "admit any caller" exemptions.**
**Recommended fix shape:** verify "shouldn't occur" via a CHECK or trigger; OR fall through to a stricter author-of-document check.

### F-90 — `WorkflowRow` and `WorkflowStepRow` are typed manually; no compile-time guard against migration drift
**Severity:** MEDIUM   **Confidence:** certain   **Category:** silent-failure
**Location:** `lib/director/route-helpers.ts:107–147`
Same shape as F-07 (config cast without validation). If a migration adds/removes a column, the manual interface and the `as unknown as WorkflowRow` cast won't catch it. The generated `lib/types/database.ts` is the source of truth; this file duplicates a subset.
**Recommended fix shape:** import the row types from `Database['public']['Tables']['workflows']['Row']` instead.

### F-91 — `formatWorkflowResponse` lists fields manually
**Severity:** MEDIUM   **Confidence:** certain   **Category:** silent-failure
**Location:** `lib/director/route-helpers.ts:150–189`
Same shape as F-90. New columns added in migrations aren't included until this function is updated. Manual sync. **Same shape as scripts/ schema drift surfaced in round-3 testing.**

---

## `lib/director/streamMessage.ts`

### F-92 — Promise resolves successfully on transport failure; consumer thinks stream completed
**Severity:** **HIGH**   **Confidence:** certain   **Category:** silent-failure
**Location:** `lib/director/streamMessage.ts:89–99`
On `!res.ok || !res.body`, the function calls `onError(...)` then `return`. The Promise resolves (not rejects). A caller that does `await streamDirectorMessage(...)` continues as if everything worked. Only callers that wired an `onError` handler see the failure. **Same shape as F-34, F-37** (silent failure modes in stream loops).
**Recommended fix shape:** throw after onError, or change the contract so the Promise rejects on transport failure.

### F-93 — no idle-timeout; client waits forever if server hangs
**Severity:** MEDIUM   **Confidence:** certain   **Category:** silent-failure
**Location:** `lib/director/streamMessage.ts:106–119`
`while (true)` reads from the body indefinitely. If the server stops emitting events without sending `done`, the client hangs. AbortSignal can break this externally but no internal idle-timeout.

### F-94 — tail buffer dropped without `done` event triggers no callback
**Severity:** MEDIUM   **Confidence:** certain   **Category:** silent-failure
**Location:** `lib/director/streamMessage.ts:120–121`
*"Any tail buffer is ignored — last event must be `done` per spec"*. If the server crashes mid-stream, the partial event is dropped and no `onDone` / `onError` fires. Consumer left hanging.

---

## `lib/director/conversation-context.ts`

### F-95 — `summariseConversation` calls `provider.complete()` with raw user content (NO escapeXml, NO injection scan)
**Severity:** **HIGH**   **Confidence:** certain   **Category:** spec-divergence
**Spec citation:** TA v2.2 §4.2 ("`escapeXml()` must be applied to every user-controlled string before XML wrapping. Missing escaping on any field is a security vulnerability.")
**Location:** `lib/director/conversation-context.ts:280–337`
The summariser builds `promptBody = oldest.map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n\n')` and passes it as `dynamic.securityWrapped` directly. **No `<user_data>` wrapping. No `escapeXml`. No injection scan.** A user who injected content into a prior message gets that content fed verbatim to the summariser. The summary then persists in `conversation_summary` and is re-included in future Director context (line 246). Long-term injection vector via summary persistence.

The provider's own canary scan runs on output, so the canary is protected. But the model's normal summarisation pass would happily incorporate injected instructions. This is the exact threat model TA §4.2 was written for — and this site bypasses it.
**Recommended fix shape:** route the summariser through the same `escapeXml` + `<user_data>` wrap + `wrapContextWithSecurityFrame` pipeline that the agent assembler uses. This may require extracting the wrap logic from `context-assembler.ts` into a shared helper.

### F-96 — `nextSequence` race condition under concurrent inserts
**Severity:** **HIGH**   **Confidence:** likely   **Category:** wrong-semantics
**Location:** `lib/director/conversation-context.ts:352–364`
`SELECT MAX(sequence) + 1` is racy. Two concurrent `appendUserMessage` calls can both read the same MAX, both insert with the same sequence. Whether the second INSERT fails depends on a UNIQUE constraint on `(conversation_id, sequence)` in migrations. If absent, two messages have the same sequence and ordering breaks downstream. Same shape as F-46/47/50/54 (non-deterministic ordering on race).
**Recommended fix shape:** verify migration; if no unique constraint, add one + use a Postgres SERIAL or RPC.

### F-97 — `summariseConversation` hardcodes temperature/maxTokens
**Severity:** MEDIUM   **Confidence:** certain   **Category:** spec-divergence
**Spec citation:** TA v2.2 H-12 ("Never hardcode token budgets, prices, model IDs, durations, or limits in TypeScript")
**Location:** `lib/director/conversation-context.ts:321–322`
`temperature: 0.3, maxTokens: 1500` — both hardcoded. Should come from `getConfig`.

### F-98 — `findInterruptedTurn` returns first of N silently; caller-responsibility unenforced
**Severity:** MEDIUM   **Confidence:** certain   **Category:** callers-disagree
**Location:** `lib/director/conversation-context.ts:184–200`
Returns the first row when `data.length === 1` OR `=== 2`. Comment says route-layer asserts at-most-one. **Function silently picks the first when 2+ exist.** A caller that doesn't know the implicit contract uses the wrong interrupted turn.
**Recommended fix shape:** throw on 2+ rows; let the route catch and 500.

### F-99 — `getOrCreateConversation` unique-constraint dependency unverified
**Severity:** MEDIUM   **Confidence:** worth-checking   **Category:** spec-divergence
**Location:** `lib/director/conversation-context.ts:45–86`
Race-safe behaviour assumes `conversations.(organisation_id, document_id)` has a UNIQUE constraint that prevents the second concurrent INSERT from succeeding. If absent, two conversations exist for the same doc. Check migration.

---

## `lib/director/executor.ts`

### F-100 — H-08 enforced by convention, not by type or runtime check
**Severity:** **HIGH**   **Confidence:** certain   **Category:** silent-failure
**Spec citation:** TA v2.2 H-08 ("Director write tools must never execute inside the agentic loop")
**Location:** `lib/director/executor.ts:415–445`
`runAgenticTurn` calls `executor(call.arguments, session)` without verifying that write tools' result shape (`WriteToolResult`) doesn't include side-effect markers. The H-08 contract is enforced by the *implementations* of write tools (per F-P1, they're compliant). But: a future write tool that accidentally writes to the DB inside its body would not be caught. No runtime invariant.
**Recommended fix shape:** the executor type-checks: for tools registered with `kind: 'write'`, the result must be `WriteToolResult` (have `proposal`, no `data`); ABORT if violated. Closes the H-08 enforcement loop.

### F-101 — generic `tool_execution_error` catch loses actual failure cause
**Severity:** MEDIUM   **Confidence:** certain   **Category:** silent-failure
**Location:** `lib/director/executor.ts:415–421`
ANY exception in tool execution becomes `{ ok: false, error: 'tool_execution_error', reason: msg }`. The Director sees only the generic label. Forensic data lost: was it a DB error? Validation error? Network error? The `reason: msg` carries the message but the `error: 'tool_execution_error'` discards type info. Same shape as F-71.

### F-102 — result-shape coercion is fragile
**Severity:** MEDIUM   **Confidence:** certain   **Category:** wrong-semantics
**Location:** `lib/director/executor.ts:442`
`JSON.stringify(result.ok ? (result as { data?: unknown; proposal?: unknown }).data ?? (result as { proposal?: unknown }).proposal : result)` — multiple unsafe casts and `data ?? proposal` precedence. A write tool that accidentally returns `{ok: true, data: null, proposal: {...}}` works; but `{ok: true, data: undefined, proposal: {...}}` and similar combinations are subtly different.

### F-103 — hardcoded fallback for temperature / maxTokens
**Severity:** MEDIUM   **Confidence:** certain   **Category:** spec-divergence
**Spec citation:** TA v2.2 H-12
**Location:** `lib/director/executor.ts:268–269`
`config.model_params.temperature ?? 0.7` and `config.model_params.max_tokens ?? 8192`. The `??` only catches null/undefined. Negative or zero passes through.

### F-104 — empty assistant content array breaks the loop without an error event
**Severity:** MEDIUM   **Confidence:** certain   **Category:** silent-failure
**Location:** `lib/director/executor.ts:474–479`
On `stop_reason='tool_use'` with no text and no tool calls, the loop breaks. Comment says it shouldn't happen but doesn't yield an error event. Caller sees `turn_complete` with stop_reason='tool_use' which is meaningless.

### F-105 — `parseWorkflowProposal` has three failure modes collapsed to null
**Severity:** MEDIUM   **Confidence:** certain   **Category:** silent-failure
**Location:** `lib/director/executor.ts:578–615`
No tag / malformed JSON / Zod fail all return null. Caller can't distinguish. The Mars-series Bug 2 (expand parser fallback) was the same pattern — a fallback path masked the real error mode. Two `console.warn` calls help but they're not part of the return contract.

### F-106 — `securityWrapped: ''` on the legacy single-string body is dead-on-the-side-the-provider-reads
**Severity:** LOW   **Confidence:** certain   **Category:** dead-code
**Location:** `lib/director/executor.ts:263`
Same as F-42 (`config.stream` field unread). The `messages` field is what the provider reads via SU-47; `securityWrapped` is empty. The fact that AssembledPrompt's type still requires `securityWrapped` is dead-mass.

### F-107 — `default: break` in chunk loop drops unknown chunk types silently
**Severity:** LOW   **Confidence:** certain   **Category:** silent-failure
**Location:** `lib/director/executor.ts:336–337`
Same shape as F-34, F-37, F-85.

---

## `lib/director/workflow-executor.ts`

### F-108 — sequential dispatch differs from spec's `Promise.all` parallel batch dispatch
**Severity:** LOW   **Confidence:** certain   **Category:** spec-divergence
**Spec citation:** TA v2.2 §8.4 ("Independent steps run in parallel" via `Promise.all`)
**Location:** `lib/director/workflow-executor.ts:289–291`
Spec runs batch dispatches in parallel. Code runs sequentially via `for ... await`. Each `dispatchAgentJobForStep` awaits the agent_jobs INSERT before moving to the next. Job execution itself is still parallel via `waitUntil`, so user-visible parallelism preserved. Performance impact: ~50ms × N for the dispatch chain.
**Recommended fix shape:** `await Promise.all(dispatchable.map(dispatchAgentJobForStep))` to match spec.

### F-109 — catch-up pass mutates step.status in memory; doesn't refresh from DB
**Severity:** MEDIUM   **Confidence:** certain   **Category:** wrong-semantics
**Location:** `lib/director/workflow-executor.ts:179–215`
After catch-up, the `stepsRaw` array's items have their `status` mutated in place. Downstream logic reads from this mutated array. Cleaner: after the catch-up loop, re-SELECT the steps. Risk of subtle bug if DB write doesn't actually persist (e.g. RLS denies, transient error not caught) but in-memory state shows it did.

### F-110 — `accept_agent_job` retry path may loop on persistent failure
**Severity:** MEDIUM   **Confidence:** worth-checking   **Category:** silent-failure
**Location:** `lib/director/workflow-executor.ts:161–181`
If `accept_agent_job` fails, step marked failed, workflow paused. On retry (e.g. user clicks Resume), the workflow's catch-up sees the agent_job still in 'completed' status (acceptance failed) and tries `accept_agent_job` AGAIN. If the failure cause is persistent (e.g. CHECK constraint violation), we loop indefinitely on each Resume attempt. Comment claims "accept_agent_job RPC is idempotent on already-'accepted' jobs" — but the failed-acceptance case isn't covered by that idempotency guarantee.

### F-111 — `result_summary` truncation missing for synchronous steps
**Severity:** MEDIUM   **Confidence:** worth-checking   **Category:** missing-validation
**Location:** `lib/director/workflow-executor.ts:773–781`
For sync steps, `result_summary` is set to `'${step.operation_type} executed'` — short literal. No truncation. But for LLM-bearing steps via the catch-up path (line 187, 198), `result_summary: job.result_summary_text` is the agent's summary — could be arbitrarily long. The `workflow_steps.result_summary` column likely has a length cap (TEXT in pg, so unbounded but rendering hits limits).

### F-112 — auto-create context node has no transaction; orphan possible on partial failure
**Severity:** MEDIUM   **Confidence:** certain   **Category:** wrong-semantics
**Location:** `lib/director/workflow-executor.ts:540–592`
INSERT context node → INSERT back-link → UPDATE workflow_step. No transaction. If the back-link INSERT fails (line 574–581), the context node is orphaned. The step retargets and proceeds; the orphan stays. Defensible (orphan is harmless) but messy. Wrap in a transaction or use a stored procedure.

### F-113 — `seed_content` not escaped or scanned when embedded into auto-created Tiptap doc
**Severity:** MEDIUM   **Confidence:** certain   **Category:** spec-divergence
**Spec citation:** TA v2.2 §4.2 + §4.3
**Location:** `lib/director/workflow-executor.ts:528–538`
The auto-create branch synthesises a Tiptap doc from `seed_content` without `escapeXml` or `scanContent`. If the Director's seed_content contains injected text (attacker-controlled chain), it lands raw in `nodes.summary`. Subsequent agent operations that read this node DO escape via the assembler — defence-in-depth holds — but the canary scan never runs on this user-derived content at write time. Worth flagging because the *write* path bypasses the security frame entirely.

### F-114 — circular import between runner.ts and workflow-executor.ts hidden by lazy imports
**Severity:** LOW   **Confidence:** certain   **Category:** wrong-semantics
**Location:** `lib/director/workflow-executor.ts:703–704`
`const { runAgentJob } = await import('@/lib/agent/runner')` is a runtime workaround for a circular dependency (runner imports advanceWorkflow). Lazy imports hide the structural issue. Refactor to break the cycle (e.g. an event bus or a thin shared interface).

---

## `lib/director/tools/index.ts`

### F-115 — `create_document_operation_step` carve-out is unilateral; spec doesn't reflect
**Severity:** LOW   **Confidence:** certain   **Category:** spec-divergence
**Spec citation:** TA v2.2 §8.3
**Location:** `lib/director/tools/index.ts:9–11`
Same root as F-78. The carve-out has a code comment but TA §8.3 still lists the tool. Update the spec.

---

## `lib/director/tools/read.ts`

Audit of read.ts deferred to a focused pass — read-tool security depends on cross-org checks (already covered by `verifyTargetNode` pattern in write.ts and by `validateToolCall`). No HIGH findings expected. Catalogued as a **gap** to revisit; flagging here for the index.

---

## `lib/director/` — Tier A.3 summary

| Severity | Count |
|---|---|
| HIGH | **8** (F-81, F-87, F-89, F-92, F-95, F-96, F-100; plus a class of repeats — see themes) |
| MEDIUM | 19 |
| LOW | 11 |
| **Total** | **38** |

(Plus 1 positive finding F-P1 — H-08 implementation site is compliant.)

### Themes that recur across `lib/director/`

1. **`escapeXml` / injection scan bypass on the summariser path (F-95).** TA §4.2 mandates escaping for ALL user content in ALL prompts; the summariser route bypasses. Long-term injection vector via `conversation_summary` persistence.

2. **Multiple sources of truth for tool inputs (F-81).** JSON Schema in `tools/index.ts` AND Zod in `schemas.ts`. Manual sync. Same shape as F-19 (BYOK bool/plan-string).

3. **H-08 enforced by convention only (F-100, F-P1).** Write-tool implementations are compliant today; the executor doesn't *check* compliance. Adding a runtime invariant (write tools must produce `WriteToolResult` only; abort otherwise) would close the loop.

4. **Race conditions on sequence assignment (F-96, F-99).** `SELECT MAX(sequence) + 1` and `getOrCreateConversation` both depend on UNIQUE constraints in migrations that we haven't verified. Verifying as part of the migrations audit (queued).

5. **Authorisation bypass in edge cases (F-89).** *"Shouldn't occur"* exemptions to security checks that aren't enforced. Same shape as F-71 (treating non-existent node as cross-org instead of distinct error).

6. **Silent failure modes in stream loops (F-92, F-93, F-94, F-107).** SSE and the stream consumer have multiple paths where the Promise resolves cleanly even though the underlying transport / parser failed. Same shape as F-34, F-37 in `lib/llm/`.

7. **Generic catch-all error wrappers (F-101, F-105).** `tool_execution_error`, `null`-from-parseWorkflowProposal — three failure modes collapsed to one return value. Forensic data lost. Same shape as F-71 (cross-org reason masking node-not-found).

8. **Mutable in-memory state across DB writes (F-109).** The catch-up pass mutates step status in memory; downstream logic reads the mutated array. If a DB write silently failed, in-memory state and DB state diverge.

9. **Hardcoded operational values (F-97, F-103).** Director session-summariser temperature/maxTokens, executor fallbacks. Same shape as F-39 (Anthropic temperature denylist) — H-12 violations.

10. **Spec-divergence on architectural changes (F-108).** TA §8.4 spec example is the original synchronous-batch design. Phase 5b changed to continuation-passing for serverless. Code is correct; spec is stale. Spec needs updating.

11. **Manual row-type interfaces (F-90, F-91).** `WorkflowRow` and `formatWorkflowResponse` duplicate columns from generated DB types. Migration-add-column risk. Same shape as scripts/ schema drift.

### What the spec lens caught here that comment-vs-code missed

- **F-95 (summariser bypasses escapeXml + injection scan)** — comment and code agree on what the function does; SPEC says it must use the security pipeline; CODE skips it. Pure spec-divergence.
- **F-89 (authorisation bypass when no user messages)** — comment acknowledges the bypass; code matches comment; SPEC §4.5 doesn't permit *any* exemption. Spec-divergence by acknowledged carve-out.
- **F-78 / F-79 / F-115** — multiple V1 carve-outs that aren't reflected in the spec docs. The code's comments are honest about the deferrals; the spec hasn't been updated to acknowledge them.
- **F-103 / F-97** — H-12 violations (hardcoded operational values). Comment-vs-code lens accepts hardcoded fallbacks; spec lens flags them.

---

*Tier A.3 (`lib/director/`) audit complete. **Stopping here per checkpoint policy.** Continue to A.4 (`lib/agent/`) on your go.*
