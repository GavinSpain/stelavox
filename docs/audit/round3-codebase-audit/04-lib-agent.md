# Tier A.4 — `lib/agent/` audit

**Files in scope:** 8 (job-lifecycle, prose-to-tiptap, runner, streamSynthesise, operations/{expand, generate-context, refine, synthesise}) — ~1,431 lines

**Spec lens applied:** TA v2.2 §6.1 (architecture overview), §6.2 (context assembler immutability), §6.4 (document operations — V2), Phase 5/5c API Contracts §2.11 invariants 6/8, H-06 (Tiptap → plain text), H-07 (token budget gate before job creation), H-12 (no hardcoded operational values), agent profile library §2.1–§2.18 output formats.

---

## `lib/agent/operations/synthesise.ts` and `refine.ts`

### F-116 — `runRefine` rejects `target_field='metadata'` while Director schema admits it
**Severity:** **HIGH**   **Confidence:** certain   **Category:** spec-divergence (internal)
**Location:** `lib/agent/operations/refine.ts:20–30` vs `lib/director/schemas.ts:228`
The Director's `RefineStepProposalSchema.parameters.target_field` enum includes `'metadata'`. The runtime `runRefine` operation rejects it: `VALID_TARGET_FIELDS = ['summary', 'prose', 'notes']`. **Two sources of truth disagreeing on the same field.** A Director-dispatched refine step targeting `metadata` is accepted at planning time, gets persisted into the workflow_step, then fails at execution time with `invalid_target_field`. **Same shape as F-19 (BYOK) and F-81 (tool schemas vs Zod).**
**Recommended fix shape:** decide whether metadata refine is supported in V1; align both schemas.

### F-117 — operations files cite stale spec versions
**Severity:** LOW   **Confidence:** certain   **Category:** spec-drift
**Location:** `lib/agent/operations/{expand,refine,synthesise,generate-context}.ts:4`
All four cite `stelavox_phase5_api_contract_v1_0.md v1.2` and `agent_profile_library_v1_0.md`. Versions presumed bumped.

---

## `lib/agent/operations/expand.ts`

### F-118 — object-wrapped fallback returns first array property non-deterministically
**Severity:** MEDIUM   **Confidence:** certain   **Category:** wrong-semantics
**Location:** `lib/agent/operations/expand.ts:55–66`
Mars-series Bug 2 fix added a fallback for `{"books": [...]}` shape. Loops `Object.values(parsedObj)` and returns the first array. If the model returns `{"results": [...3 books], "metadata": ["v1"]}`, we may get `["v1"]` (Object.values order is implementation-defined for non-integer keys but typically insertion order in V8). Schema validation at line 113 should catch malformed entries — but a single-item junk array could pass if it accidentally Zod-validates.
**Recommended fix shape:** require the array property to satisfy `ExpandOutputItemSchema` heuristically before accepting; or look for a property name in a known set (`books`, `chapters`, `acts`, `scenes`, `beats`, `items`, `result`).

### F-119 — three throw-paths use inconsistent `output_schema_invalid:*` shapes
**Severity:** MEDIUM   **Confidence:** certain   **Category:** wrong-semantics
**Location:** `lib/agent/operations/expand.ts:108–121`
Three different sub-shapes: `output_schema_invalid:json_parse:${msg}`, `output_schema_invalid:${JSON.stringify(issues)}`, `output_schema_invalid:positions:${err}`. Caller has to substring-match three shapes to triage. Inconsistent.
**Recommended fix shape:** typed error class with `kind: 'json_parse' | 'zod' | 'positions'` and a `details` field.

### F-120 — `extractJsonArray` and `extractJsonObject` duplicate balanced-extraction logic
**Severity:** LOW   **Confidence:** certain   **Category:** dead-code (drift risk)
**Location:** `lib/agent/operations/expand.ts:36–103` vs `generate-context.ts:23–55`
Two implementations of markdown-fence stripping + balanced-bracket slicing. Drift risk: a bug fix in one won't propagate to the other. Same shape as F-81 (multiple sources of truth).
**Recommended fix shape:** extract to `lib/agent/operations/extract-json.ts`.

---

## `lib/agent/operations/generate-context.ts`

### F-121 — no object-wrapped fallback like expand has
**Severity:** MEDIUM   **Confidence:** certain   **Category:** missing-feature
**Location:** `lib/agent/operations/generate-context.ts:23–55`
expand.ts handles `{"books": [...]}` model misfire. generate-context.ts doesn't have the equivalent fallback. If the model returns `{"context": {"summary": "...", "metadata": {...}}}` (one extra wrapper), parse succeeds but Zod validation fails. Same Mars-series shape, missing fix.

---

## `lib/agent/prose-to-tiptap.ts`

### F-122 — single-paragraph internal `\n` becomes one paragraph with literal newlines
**Severity:** MEDIUM   **Confidence:** certain   **Category:** wrong-semantics
**Location:** `lib/agent/prose-to-tiptap.ts:51–67`
`split(/\n\s*\n+/)` requires a blank line for paragraph breaks. A model that emits soft line breaks (line-wrapping at 80 chars but no blank lines) produces ONE paragraph with literal `\n` characters. Tiptap then renders as a single paragraph (newlines collapse to spaces). Same Mars-series-shape risk as expand parser fallback — model emits valid-but-unexpected shape and we silently degrade.
**Recommended fix shape:** detect "soft-wrapped" plain text (no blank-line breaks but `\n` present) and either treat each line as its own paragraph OR replace `\n` with spaces before paragraph splitting.

### F-123 — Markdown emitted by model lands as literal text
**Severity:** LOW   **Confidence:** certain   **Category:** wrong-semantics
**Location:** `lib/agent/prose-to-tiptap.ts:23–26`
Acknowledged in comment: *"Any Markdown the model emits despite the instruction lands as literal characters in the text node, recoverable by manual edit post-Accept."* Same shape as F-25 (synthesise schema doesn't validate content shape). The schema layer permits it; the conversion layer ignores it; the user sees `**bold**` literally. V1 acceptable per comment.

---

## `lib/agent/runner.ts`

### F-124 — workflow-dispatched agent_jobs may bypass H-07 token budget gate
**Severity:** **HIGH**   **Confidence:** likely   **Category:** spec-divergence
**Spec citation:** TA v2.2 H-07 ("token budget gate must run before agent job record is created")
**Location:** `lib/director/workflow-executor.ts:664–678` (dispatch site) vs `lib/agent/runner.ts` (no budget check)
The user-triggered API routes (e.g. `app/api/agent/synthesise/route.ts`) call `checkTokenBudget` before INSERTing the agent_job. The workflow executor's `dispatchAgentJobForStep` INSERTs `agent_jobs` rows directly (workflow-executor.ts:664–678) **without calling `checkTokenBudget`**. A 30-step workflow generates 30 agent_jobs that bypass the budget gate. Per H-07's stated scope: *"All agent API routes (expand, synthesise, refine, generate-context, critique, document-operation, director message)"* — workflow_step dispatches aren't listed but the spirit applies: every agent_job should have a budget check.
**Recommended fix shape:** in `dispatchAgentJobForStep`, call `checkTokenBudget` before the `agent_jobs.insert`. On failure, mark the step `failed` with `error_message='token_budget_exceeded'` and pause the workflow.

### F-125 — retry-on-parse-failure uses identical prompt; doubles cost on shape misfires
**Severity:** **HIGH**   **Confidence:** certain   **Category:** wrong-semantics
**Location:** `lib/agent/runner.ts:139–175`
SU-J14-3 fix: on `output_schema_invalid` or `model_output_truncated`, retry the LLM call ONCE. The retry uses **the same prompt** — same model, same temperature, same context. Anthropic's outputs are non-deterministic (temperature > 0) so a second call may succeed where the first failed; but if the failure is *systematic* (e.g. the prompt asks for a shape the model can't produce), the retry doubles cost without improving outcomes. Mars-series Bug 2 (object-wrapped array) was fixed at the parser layer — that's the right shape for systematic failures. The retry covers stochastic failures only.
**Recommended fix shape:** on retry, vary something — temperature += 0.1, or add a retry-clarification system message ("Your previous output failed validation. Emit ONLY the JSON array. No prose.") — so retries have a different chance of success than the first call.

### F-126 — `provider.complete({...assembled, config: {...config, model: modelId}})` may use wrong context window
**Severity:** MEDIUM   **Confidence:** worth-checking   **Category:** wrong-semantics
**Location:** `lib/agent/runner.ts:108–111`
The assembled prompt was *built* against `profile.model_id`. `getProvider` returns a possibly-different `modelId` (org override per `preferred_model_overrides`). The runner spreads assembled but overrides model. **If the resolved model has a smaller context window or different temperature semantics than the profile's**, the prompt may exceed the model's context or hit edge cases. Latent bug for the org-override path.
**Recommended fix shape:** assemble *after* resolving the model, so context-window-dependent decisions in the assembler use the right model.

### F-127 — `void finalContent` is dead
**Severity:** LOW   **Confidence:** certain   **Category:** dead-code
**Location:** `lib/agent/runner.ts:190`
`void finalContent  // referenced in retry-aware logging only` — but no logging references it. Dead.

### F-128 — `runAgentJobInline`'s `providerName = 'anthropic'` hardcoded
**Severity:** MEDIUM   **Confidence:** certain   **Category:** spec-divergence
**Spec citation:** TA v2.2 H-12
**Location:** `lib/agent/runner.ts:373`
String literal in the runner. If a future BYOK provider is added, this string is wrong. Cost computation depends on provider name (per F-04 cost.ts is Anthropic-only — doubly wrong).

### F-129 — stream-without-usage thrown as generic `internal_error`
**Severity:** MEDIUM   **Confidence:** certain   **Category:** silent-failure
**Location:** `lib/agent/runner.ts:420–422` + catch at 469
`if (!usage) throw new Error('stream ended without usage info')`. Mapped to generic `internal_error` in catch. The actual cause (likely an Anthropic error event swallowed by F-34's default-case break) is invisible. Compound silent-failure across the lib/llm + lib/agent boundary.

### F-130 — `notifyWorkflowIfStep` runs unconditionally outside try/finally
**Severity:** MEDIUM   **Confidence:** worth-checking   **Category:** wrong-semantics
**Location:** `lib/agent/runner.ts:228`
Line 228 — `await notifyWorkflowIfStep(job.triggered_by)` runs after the try/finally on success path. But the catch block already calls `persistFailure` which itself calls `notifyWorkflowIfStep` at line 273 of job-lifecycle.ts. **On error path, notifyWorkflowIfStep fires twice** (once via persistFailure, once at line 228). `advanceWorkflow` is idempotent per workflow-executor.ts:55, but the double-call is wasteful and adds DB load.

---

## `lib/agent/job-lifecycle.ts`

### F-131 — `assembleAndPersistContext` writes `context_snapshot` after dispatcher set it; spec calls it "set once, immutable"
**Severity:** **HIGH**   **Confidence:** likely   **Category:** spec-divergence
**Spec citation:** Phase 5b API Contract §2.11 invariant 8 — "context_snapshot is set once, then read-only"
**Location:** `lib/agent/job-lifecycle.ts:182–210`
The agent_jobs row is INSERTed by the dispatcher (e.g. `workflow-executor.ts:664–678`) with `context_snapshot: { dynamic: dynamicCtx }`. Then the runner UPDATEs it with the full assembled prompt (`stable`, `dynamic`, `config`, `assembled_at`). **Two writes to a column the spec describes as immutable.** The conventional reading would be: insert with placeholder; runner fills it; never touched again. If "set once" means "one INSERT", the code violates. If "set once" means "one final write before the job runs", the code is OK with caveats. Spec wording governs.
**Recommended fix shape:** clarify the spec; if "one INSERT" is the intent, change dispatchers to set the full snapshot OR have the runner INSERT instead of UPDATE.

### F-132 — `persistFinalResult` clobbers non-`running` non-`cancelled` statuses
**Severity:** **HIGH**   **Confidence:** certain   **Category:** wrong-semantics
**Location:** `lib/agent/job-lifecycle.ts:230–246`
The UPDATE filters only `.neq('status', 'cancelled')`. So a job in `failed`, `pending`, or `accepted` status would have its status overwritten to `'completed'`. If a recovery cron transitioned a stalled job to `failed` while the runner was still working, the runner's eventual success would clobber the `failed` state to `completed`. Race condition with the recovery sweep.
**Recommended fix shape:** `.eq('status', 'running')` instead of `.neq('status', 'cancelled')`.

### F-133 — `updateUsageRecords` race condition on concurrent jobs
**Severity:** **HIGH**   **Confidence:** certain   **Category:** wrong-semantics
**Location:** `lib/agent/job-lifecycle.ts:356–397`
SELECT-then-INSERT-or-UPDATE pattern. Two concurrent jobs for the same `(org, year_month, op, provider)` tuple: both SELECT no existing → both INSERT → second INSERT fails on UNIQUE (assuming the constraint exists in migrations). If the constraint exists, the second job's tokens are silently lost (INSERT error not checked). If the constraint doesn't exist, two rows for the same tuple — billing aggregation later double-counts or chooses arbitrarily.
**Same shape as F-96 (nextSequence) and F-99 (getOrCreateConversation).**
**Recommended fix shape:** UPSERT with atomic increment via Postgres `INSERT ... ON CONFLICT (...) DO UPDATE SET tokens_input = usage_records.tokens_input + EXCLUDED.tokens_input, ...`.

### F-134 — `updateUsageRecords` doesn't check error from INSERT or UPDATE
**Severity:** **HIGH**   **Confidence:** certain   **Category:** silent-failure
**Location:** `lib/agent/job-lifecycle.ts:374–396`
Both branches call `await supabase...` and discard the error. If the write fails (RLS, constraint, transient DB error), tokens are silently lost. **Billing data corruption goes undetected.**
**Recommended fix shape:** check `.error` on both writes; on failure, log + retry with bounded backoff; if still failing, console.error and store in a side-channel for manual reconciliation.

### F-135 — `recordTokensOnly` has no status guard
**Severity:** MEDIUM   **Confidence:** certain   **Category:** wrong-semantics
**Location:** `lib/agent/job-lifecycle.ts:326–344`
UPDATE without `.eq('status', ...)` filter. If the job is `'completed'`, this UPDATE clobbers the tokens that `persistFinalResult` already set. In practice only called from cancellation paths so unlikely to fire on completed jobs, but the lack of guard is a footgun.

### F-136 — `persistCancellation` always notifies workflow regardless of UPDATE match
**Severity:** MEDIUM   **Confidence:** certain   **Category:** wrong-semantics
**Location:** `lib/agent/job-lifecycle.ts:281–303`
The `.in('status', ['running', 'pending'])` filter means UPDATE may match no rows (job already terminal). But `notifyWorkflowIfStep` runs unconditionally at line 302. Idempotent on the workflow side but unnecessary — and signals "cancellation occurred" to a workflow tick when it didn't.

### F-137 — `loadJobAndProfile` comment references non-existent `markJobFailed`
**Severity:** LOW   **Confidence:** certain   **Category:** comment-vs-code-mismatch
**Location:** `lib/agent/job-lifecycle.ts:104–105`
*"caller dispatches `markJobFailed` or proceeds"* — the function is called `persistFailure`. Stale terminology.

### F-138 — `formatYearMonth` accepts `Date` object directly; no NaN guard like in token-budget.ts
**Severity:** LOW   **Confidence:** certain   **Category:** missing-validation
**Location:** `lib/agent/job-lifecycle.ts:350–354`
`new Date()` always produces a valid date. But for symmetry with F-21 (token-budget.ts NaN trap), add the same defensive guard. Lower risk here because the caller always passes `new Date()`.

---

## `lib/agent/streamSynthesise.ts`

This is a structural duplicate of `lib/director/streamMessage.ts` — same SSE consumer pattern. Findings mirror.

### F-139 — Promise resolves on transport failure (mirror of F-92)
**Severity:** **HIGH**   **Confidence:** certain   **Category:** silent-failure
**Location:** `lib/agent/streamSynthesise.ts:110–122`
Same shape as F-92: on `!res.ok || !res.body`, calls `onError` then `return`. Promise resolves successfully. Caller's `await streamSynthesise(...)` sees clean completion when the request actually failed.

### F-140 — no idle timeout (mirror of F-93)
**Severity:** MEDIUM   **Confidence:** certain   **Category:** silent-failure
**Location:** `lib/agent/streamSynthesise.ts:128–140`

### F-141 — `parseSseBlock` duplicated between streamSynthesise and streamMessage
**Severity:** MEDIUM   **Confidence:** certain   **Category:** dead-code
**Location:** `lib/agent/streamSynthesise.ts:63–84` vs `lib/director/streamMessage.ts:40–65`
Two implementations of the same SSE-block parser. Drift risk: a fix in one won't propagate. **Same shape as F-81, F-90/91, F-120** (multiple sources of truth for parsing).

### F-142 — switch has no default case (mirror of F-85, F-107, etc.)
**Severity:** MEDIUM   **Confidence:** certain   **Category:** silent-failure
**Location:** `lib/agent/streamSynthesise.ts:145–167`

---

## `lib/agent/` — Tier A.4 summary

| Severity | Count |
|---|---|
| HIGH | **8** (F-116, F-124, F-125, F-131, F-132, F-133, F-134, F-139) |
| MEDIUM | 12 |
| LOW | 7 |
| **Total** | **27** |

### Themes that recur across `lib/agent/`

1. **Agent profile library / Director schemas / operations layer disagree on enum domains.** F-116 — `target_field='metadata'` admitted by Director Zod, rejected by runtime. **Three sources of truth that must stay in sync** (Director schemas, agent profile library, operations layer). Same shape as F-19, F-81.

2. **Workflow-dispatch path bypasses H-07 token budget (F-124).** Spec scope says "all agent API routes"; workflow_step dispatches aren't routes but produce identical agent_jobs and identical LLM cost. H-07's spirit is broken even though its letter doesn't cover the case.

3. **Retry-on-parse-failure with identical prompt (F-125).** Doubles cost on systematic shape misfires. The Mars-series Bug 2 fix was at the parser layer (right shape); the SU-J14-3 retry is a band-aid.

4. **`context_snapshot` immutability claim vs two-write reality (F-131).** Phase 5b API Contract §2.11 invariant 8 says set-once. Code does two writes (dispatcher INSERT + runner UPDATE). Spec interpretation matters.

5. **Status-clobber races (F-132, F-135).** persistFinalResult and recordTokensOnly use over-broad UPDATE filters. Recovery cron + runner success path can race; the runner wins, overwriting the recovery's `failed` transition.

6. **Usage-records race + silent error swallow (F-133, F-134).** Billing-relevant writes use SELECT-then-INSERT-or-UPDATE without UPSERT and without error checking. Same shape as F-96/F-99 (sequence races) but for usage tokens — i.e. *money*.

7. **SSE consumer duplication (F-141).** `streamSynthesise.ts` and `streamMessage.ts` are near-identical. Parser shared by copy-paste. Same drift-risk shape as F-81/F-90/F-91/F-120 — but applied to a parser that fronts every Director and synthesise call.

8. **Spec-version stale across all operation files (F-117).** Same process gap that surfaced in A.1, A.2, A.3.

### What the spec lens caught here

- **F-124 (workflow bypass of H-07)** — the dispatch-vs-API-route distinction is exactly the kind of edge the spec lens catches: the rule says "API routes"; the violation is in a place that produces equivalent behaviour but isn't called an API route.
- **F-131 (context_snapshot two-write)** — the spec calls the column immutable. The code's two-write pattern has an internal logic but the spec disagrees.
- **F-132 (status clobber)** — not strictly spec-divergence (spec doesn't enumerate transitions explicitly) but a wrong-semantics issue the spec lens highlighted by drawing attention to the recovery-cron interaction.
- **F-128 (provider hardcoded)** — H-12 violation.
- **F-116 (target_field=metadata)** — internal spec-divergence between Director and operations.

---

*Tier A.4 (`lib/agent/`) audit complete. **Stopping here per checkpoint policy.** Continue to A.5 (`lib/data/`) on your go. After A.5, the planned Tier-B/C/D passes follow, then the A.1 backfill.*
