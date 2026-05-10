# Tier B — `app/api/`, `lib/config/`, `lib/supabase/`, `lib/stores/`, `lib/editor/`, `lib/api/`, `lib/validation/`

**Files in scope:** 41 API route handlers + ~16 library files

**Spec lens applied:** TA v2.2 §3 (Backend), §4 (Security), §6 (AI Integration), §8 (Director); H-01 through H-15. Phase 2/3/4/5/5b/5c API contracts.

**Method:** sampled representative routes from each cluster (agent, director, node CRUD, cron) + audited every shared library. Patterns repeat across routes in the same cluster — findings tagged by cluster, not per-file unless distinct.

---

## `lib/supabase/`

### F-167 — every Supabase factory uses `process.env.X!` non-null assertion
**Severity:** **HIGH**   **Confidence:** certain   **Category:** silent-failure
**Location:** `lib/supabase/{service,server,middleware,client}.ts`
All four files reference `process.env.NEXT_PUBLIC_SUPABASE_URL!` and friends. If env vars are unset (deploy misconfiguration, local missing `.env`), the `!` produces `undefined`, Supabase init throws with a less-obvious error (often `TypeError: Cannot read properties of undefined`). No early-throw path with a clear "missing env var" message. Same shape as F-14 (Anthropic API key) but four sites with no shared helper.
**Recommended fix shape:** central `requireEnv('NEXT_PUBLIC_SUPABASE_URL')` helper that throws on undefined/empty/whitespace.

### F-168 — `server.ts` `setAll` catch is unscoped; swallows non-Server-Component errors silently
**Severity:** MEDIUM   **Confidence:** certain   **Category:** silent-failure
**Location:** `lib/supabase/server.ts:18–25`
Comment claims the catch is for "Server Component disallowed cookie writes". But `cookieStore.set()` throws are unscoped — any error (Vercel runtime, mismatched headers) is swallowed. Session refresh failure goes silent.
**Recommended fix shape:** narrow the catch to the specific NextRequestMutability error class.

### F-169 — middleware refreshes session via `getUser()`; no error path
**Severity:** LOW   **Confidence:** worth-checking   **Category:** missing-handling
**Location:** `lib/supabase/middleware.ts:34`
`await supabase.auth.getUser()` swallows errors silently (no try/catch). On Auth API outage, every request still completes but the session may be stale. Acceptable for V1.

---

## `lib/stores/editor-store.ts`

### F-170 — autosave network failure swallowed silently; no UI signal
**Severity:** **HIGH**   **Confidence:** certain   **Category:** silent-failure
**Location:** `lib/stores/editor-store.ts:243–248`
```typescript
try { result = await patchNode(...) } catch { return }
```
Network error → stay-dirty (correct), but **no console.warn, no toast, no flag**. The user types, no save, indicator doesn't change to "save failed". Same shape as F-92, F-94, F-139 (silent transport failures across stream consumers). 

### F-171 — non-200/409/423 responses silently leave dirty=true; no backoff, no surface
**Severity:** **HIGH**   **Confidence:** certain   **Category:** silent-failure
**Location:** `lib/stores/editor-store.ts:307–309`
Comment names the policy: *"silent-on-other-errors policy"*. 422 (validation), 500 (server crash), 503 (degraded) all silently retry on the next setField. No exponential backoff. No surface to the user. If the server returns 500 for a malformed payload caused by a client bug, the user types more, autosave fires again, more 500s. Tight loop.
**Recommended fix shape:** classify response codes; surface unrecoverable errors (422, 500, 503) via a banner; apply backoff on retry.

### F-172 — `reloadFromServer` no-ops on transport failure
**Severity:** MEDIUM   **Confidence:** certain   **Category:** silent-failure
**Location:** `lib/stores/editor-store.ts:469`
`if (!res.ok) return`. Same shape as F-92.

### F-173 — `sendBeacon` may not carry auth cookie reliably
**Severity:** MEDIUM   **Confidence:** worth-checking   **Category:** silent-failure
**Location:** `lib/stores/editor-store.ts:529`
beforeunload handler uses `navigator.sendBeacon`. Beacon doesn't propagate cookies in all browser/SameSite combinations. If cookies don't propagate, the PATCH 401s and the user loses the dirty buffer. The shadow recovers it next session — but worth verifying the cookie policy across Vercel + Chrome/Safari/Firefox.

### F-174 — `gcOldShadows` runs on every loadNode; not throttled
**Severity:** LOW   **Confidence:** certain   **Category:** wrong-semantics
**Location:** `lib/stores/editor-store.ts:127, 359`
GC walks all localStorage keys on every node navigation. Cheap but unnecessary. Throttle to once per session.

### F-175 — module-scoped `debounceTimer` assumes one editor instance
**Severity:** LOW   **Confidence:** worth-checking   **Category:** wrong-semantics
**Location:** `lib/stores/editor-store.ts:155`
Single global timer. Fine for V1 (one active node at a time). If two nodes were ever editable simultaneously, they'd share the timer.

---

## `lib/editor/`

### F-176 — `serialise.ts:fromStorage` returns null on JSON parse failure
**Severity:** LOW   **Confidence:** certain   **Category:** silent-failure
**Location:** `lib/editor/serialise.ts:10–14`
Same shape as F-17 (`extractPlainText` legacy passthrough). If the prose column is corrupted JSON, `fromStorage` returns null and the editor renders empty. User sees blank prose with no signal of the corruption. The shadow may save the corrupted state back when they type.

### F-177 — `extensions.ts` lacks Inviolable #5 reference
**Severity:** LOW   **Confidence:** certain   **Category:** missing-comment
**Location:** `lib/editor/extensions.ts:27–40`
Inviolable #5 ("the prose editor has no visible toolbar") drives the prose extension config (no Link, no headings, etc.). Comment doesn't cite the Inviolable. New developer wondering why won't find it.

---

## `lib/api/errors.ts`

### F-178 — error registry has 90+ codes; no test that all are reachable
**Severity:** LOW   **Confidence:** worth-checking   **Category:** dead-code
**Location:** `lib/api/errors.ts:7–159`
Some helpers may be unused (the catalogue has accumulated across phases). Drift risk: a renamed error code may still reference an unused helper. Worth a `grep`-based reachability sweep.

---

## `lib/api/agent-operation-helper.ts`

### F-179 — `validateProfile` accepts user-passed `profile_id` without verifying `is_system_profile`
**Severity:** **HIGH**   **Confidence:** likely   **Category:** spec-divergence
**Spec citation:** TA v2.2 §6.3 ("Model selection is per agent profile — configurable without code changes"); agent_profile_library §1 (system profiles)
**Location:** `lib/api/agent-operation-helper.ts:113–122`
When the caller passes `profile_id`, the function loads the profile and checks `operation_type` matches, but doesn't verify the profile is a *system* profile. RLS would block cross-org access, but a same-org user could specify any profile_id, including non-system profiles (if/when V2 user-defined profiles land). Today V1 only has system profiles per the library doc — but the helper doesn't enforce that invariant.
**Recommended fix shape:** add `.eq('is_system_profile', true)` when loading by id; or load by id, then assert `is_system_profile === true`.

### F-180 — `checkConcurrency` uses `.limit(1).maybeSingle()` without ORDER BY
**Severity:** MEDIUM   **Confidence:** certain   **Category:** wrong-semantics
**Location:** `lib/api/agent-operation-helper.ts:152–166`
If multiple pending/running jobs exist (data corruption or race), find-first non-deterministic. Same shape as F-46/47/50/54/143.

### F-181 — `createJobAndDispatch` is the dispatch site for F-131 (context_snapshot two-write)
**Severity:** see F-131
**Location:** `lib/api/agent-operation-helper.ts:215`
INSERT writes `context_snapshot: { dynamic: dynamicContext }`. Runner later UPDATEs with stable+assembled. Spec calls context_snapshot immutable. Cross-reference only.

### F-182 — `walkForText` doesn't handle Tiptap mention/image nodes
**Severity:** LOW   **Confidence:** certain   **Category:** silent-failure
**Location:** `lib/api/agent-operation-helper.ts:84–98`
If a future Tiptap extension stores text in non-`text`-typed nodes (mention, image alt-text), `walkForText` reports the document as empty even though it has content. Same shape as F-18.

---

## `lib/validation/nodes.ts`

### F-183 — `metadata: z.record(z.string(), z.unknown())` admits any object
**Severity:** MEDIUM   **Confidence:** certain   **Category:** missing-validation
**Location:** `lib/validation/nodes.ts:51`
Same shape as F-27 (generate-context schema). Per-type validation deferred to V2.

### F-184 — `prose` cap 2,000,000 chars with editor warning at 100k creates an "edge zone"
**Severity:** LOW   **Confidence:** certain   **Category:** wrong-semantics
**Location:** `lib/validation/nodes.ts:49`
2M is a guardrail; 100k is the editor warning. Users who paste between 100k–2M get warned but the API accepts. Defensible — guards against accidental megabyte payloads — but the gap is wide.

### F-185 — `nodeContextPostSchema` document_id conditional acknowledged-but-unenforced
**Severity:** LOW   **Confidence:** certain   **Category:** wrong-semantics
**Location:** `lib/validation/nodes.ts:79–80`
Comment: *"Zod cannot express the conditional cleanly without verbose refinements"*. Route handles consistency. Coupling between schema and route — if route forgets the check, scope=document with missing document_id slips through.

### F-186 — both `expected_version` and `expected_content_revision` accepted; route picks
**Severity:** LOW   **Confidence:** certain   **Category:** wrong-semantics
**Location:** `lib/validation/nodes.ts:117–122`
Caller can pass both. Route prefers content_revision (per `nodes/[nodeId]/route.ts:257`). If they disagree, the caller's intent is ambiguous. Documented but not enforced — could `superRefine` to require exactly one.

---

## `app/api/` route patterns (cluster-level findings)

### F-187 — `POST /api/director/message` does not call `checkTokenBudget` despite H-07 explicitly scoping it
**Severity:** **HIGH**   **Confidence:** certain   **Category:** spec-divergence
**Spec citation:** TA v2.2 H-07 ("All agent API routes (expand, synthesise, refine, generate-context, critique, document-operation, **director message**)")
**Location:** `app/api/director/message/route.ts` (no checkTokenBudget import or call)
H-07's stated scope explicitly names `director message`. The five `/api/agent/*` routes call `checkTokenBudget`; the director routes do not. Director conversations consume substantial tokens (full conversation history + tool definitions). A user with depleted budget can still drive the Director. Combined with F-124 (workflow-step bypass) the budget gate has three holes.
**Recommended fix shape:** add `checkTokenBudget` call before agent_jobs/conversation_messages dispatch in `/api/director/message` and `/api/director/conversation/[id]/resume`.

### F-188 — `renumberSiblingsAfterDelete` non-atomic UPDATE chain violates H-04 spirit
**Severity:** **HIGH**   **Confidence:** certain   **Category:** spec-divergence
**Spec citation:** TA v2.2 H-04 ("Integer node ordering renumbers all siblings ... must update all affected siblings in a single transaction")
**Location:** `app/api/nodes/[nodeId]/route.ts:128–149`
Comment lines 121-127 acknowledge the gap: *"this runs AFTER the DELETE commits. If the route process dies between the DELETE and the renumber, the affected parent's children will have a sparse order (one gap)."* H-04 mandates atomic reorder. Workaround documented as Phase 6 hardening. Code consciously violates the hazard's spirit.
**Recommended fix shape:** RPC `delete_node_with_renumber` analogous to `move_node` (Migration 021).

### F-189 — `.gt('order', N)` PostgREST footgun documented inline; not enforced anywhere
**Severity:** **HIGH**   **Confidence:** certain   **Category:** silent-failure
**Location:** `app/api/nodes/[nodeId]/route.ts:117–121`
Comment: *"PostgREST treats `order` as a reserved query parameter name (used for ORDER BY). A filter like `.gt('order', N)` emits `?order=gt.N` which PostgREST parses as a (malformed) order-by clause rather than a filter — silently dropping it."* So any code that does `.gt('order', N)` silently fails to filter. Documented in one route only; future code touching node ordering can hit this trap.
**Recommended fix shape:** ESLint rule that flags `.gt('order',` etc.; or wrap in a helper that uses `.filter()` with the explicit operator name.

### F-190 — `ancestorChainLocked` walks parent chain sequentially; duplicated across routes
**Severity:** MEDIUM   **Confidence:** certain   **Category:** wrong-semantics
**Location:** `app/api/nodes/[nodeId]/route.ts:35–51` (also referenced in `documents/[documentId]/nodes/route.ts`)
Same shape as F-44 (fetchAncestors), F-164 (listAncestorLinksForNode), F-169 (cron loop). N round-trips per write operation. Same parent-walk pattern repeated in ~5 places across the codebase. Could be a Postgres function `is_ancestor_chain_locked(nodeId)` returning a single boolean.

### F-191 — agent route org-fetch races against the concurrency check
**Severity:** MEDIUM   **Confidence:** certain   **Category:** wrong-semantics
**Location:** `app/api/agent/synthesise/route.ts:73–87` (and the four sibling routes)
Order: `checkConcurrency` → org fetch → `checkTokenBudget`. Between the concurrency check and the budget check, the user can fire another dispatch (different tab). Both pass concurrency check (they're independent), both pass budget check, both are dispatched. Two concurrent jobs for the same target. Mitigated only by F-180's find-first which is non-deterministic.
**Recommended fix shape:** wrap the entire dispatch decision in a Postgres function with row-level locking on the target node.

### F-192 — agent routes use `.single()` on org fetch; H-01 violation
**Severity:** MEDIUM   **Confidence:** certain   **Category:** spec-divergence
**Spec citation:** TA v2.2 H-01
**Location:** All 5 `/api/agent/*` routes (e.g. `synthesise/route.ts:81`)
`.single()` on the organisations row throws if the org was concurrently deleted. Same shape as F-144/148/155. Five sites.

### F-193 — agent routes hardcode `profile.max_tokens + 4096` for budget estimate
**Severity:** MEDIUM   **Confidence:** certain   **Category:** spec-divergence
**Spec citation:** TA v2.2 H-12
**Location:** All 5 `/api/agent/*` routes
Magic `4096` represents an input-token estimate. H-12 violation — should come from `getConfig`.

### F-194 — agent routes default `org.plan ?? 'trial'` silently downgrades on data corruption
**Severity:** MEDIUM   **Confidence:** certain   **Category:** silent-failure
**Location:** All 5 `/api/agent/*` routes (e.g. `synthesise/route.ts:84`)
If `plan` is null, falls back to 'trial'. A user with a paid plan whose row got corrupted gets trial budget. Should fail-closed.

### F-195 — `decorateWithLeaf` cascading null returns from F-152 affect every node-API response
**Severity:** see F-152
**Location:** `app/api/nodes/[nodeId]/route.ts:166–169` and 12 other call sites
Every route that returns a node calls `decorateWithLeaf`. F-152 says is_leaf silently returns false on layer_stack fetch failure. Cascade: every node response in the system gets wrong is_leaf when the layer_stack fetch fails. UI affordances disappear silently across the app.

---

## `app/api/cron/director-recovery/route.ts`

### F-196 — comment says "updated_at" but code uses `created_at` for stuck-interim filter
**Severity:** **HIGH**   **Confidence:** certain   **Category:** comment-vs-code-mismatch
**Location:** `app/api/cron/director-recovery/route.ts:16, 116`
File-level comment line 16: *"conversation_messages with turn_state='interim' whose `updated_at` is older than agent.heartbeat_timeout_ms"*. Code at line 116 uses `created_at`: `.lt('created_at', jobCutoff)`. **A message updated recently but created long ago would still be considered stuck.** A streaming Director turn that's been writing successfully for a long time (>2 min) gets swept as stuck. Either comment or code is wrong.
**Recommended fix shape:** if the comment is right, change to `updated_at`. If the code is right (created_at = "fresh dispatches only"), update the comment. The streaming-tail risk argues for `updated_at`.

### F-197 — UPDATE counts inferred from `!error` rather than affected rows
**Severity:** MEDIUM   **Confidence:** certain   **Category:** wrong-semantics
**Location:** `app/api/cron/director-recovery/route.ts:81, 108, 125`
`if (!error) agentJobsFailed++` — but the UPDATE may match 0 rows (CAS-style filter) without erroring. Counter over-counts. Same shape as F-197 cluster — not knowing how many rows actually changed.

### F-198 — `advanceWorkflow` errors logged but don't block other workflow advances
**Severity:** LOW   **Confidence:** certain   **Category:** wrong-semantics
**Location:** `app/api/cron/director-recovery/route.ts:128–138`
Sequential `await advanceWorkflow(wfId)` in a loop. If one workflow's advance throws, the loop continues. Good — but: if a systemic issue (DB pressure) causes ALL advances to throw, the response still 200s with optimistic counters.

### F-199 — `120_000` (2-min grace window) hardcoded
**Severity:** LOW   **Confidence:** certain   **Category:** spec-divergence
**Spec citation:** TA v2.2 H-12
**Location:** `app/api/cron/director-recovery/route.ts:57`

### F-200 — `.or(\`last_heartbeat_at.is.null,...\`)` string-interpolated PostgREST filter
**Severity:** LOW   **Confidence:** certain   **Category:** silent-failure
**Location:** `app/api/cron/director-recovery/route.ts:67, 96`
Same shape as F-156. jobCutoff/wfCutoff are ISO date strings — controlled — so the live exposure is zero. Defence-in-depth gap.

---

## Tier B summary

| Severity | Count |
|---|---|
| HIGH | **9** (F-167, F-170, F-171, F-179, F-187, F-188, F-189, F-196 + cluster F-195) |
| MEDIUM | 17 |
| LOW | 8 |
| **Total** | **34** |

### Themes that recur in Tier B (and ladder up to existing Tier-A clusters)

1. **Silent transport-failure swallow in client-side stores (F-170, F-171, F-172, F-173).** Same shape as F-34/F-37/F-92/F-94/F-139 — a client whose autosave fails silently and a server whose stream consumer thinks "done" when actually "broken". Now visible at the editor-store layer too.

2. **H-07 token budget bypass — three sites total.** F-124 (workflow_step), F-187 (director message + resume) — and F-188 (rate-limit query fail-open in tool-validator) cuts the same direction. The budget gate has three holes.

3. **H-04 atomic reorder spec-divergence (F-188).** Conscious violation with documented "Phase 6 hardening" deferral. Spec is V1-mandatory; deferral is V2.

4. **H-01 violations (F-192 + the four in lib/data).** Five `.single()` sites where `.maybeSingle()` is correct, plus more in lib/data. Pattern consistent across the codebase.

5. **String-interpolated PostgREST filters (F-156, F-189, F-200).** Three sites. Defence-in-depth gap; today UUID/ISO-string validation upstream blocks injection but the wrappers rely on it.

6. **Find-first / N+1 walks (F-180, F-190).** Same parent-walk pattern in 5 places (lib/llm context-assembler, lib/director conversation-context, lib/data context-links, app/api/nodes/[id], app/api/cron/director-recovery). One Postgres function would replace all five.

7. **Hardcoded operational values (F-167 env-vars, F-193 token estimate, F-199 grace window).** H-12 violations across the layer.

8. **Comment-vs-code mismatch on a critical recovery path (F-196).** The cron sweep's filter for stuck interims uses `created_at` while the comment says `updated_at`. A live Director turn could be falsely swept as stuck.

### What the spec lens caught

- **F-187 (Director routes don't call checkTokenBudget despite H-07 listing them).** Pure spec-divergence — H-07's "Scope" section explicitly enumerates "director message" but the route omits it.
- **F-188 (renumberSiblingsAfterDelete violates H-04).** Comment acknowledges the deferral; spec is V1-mandatory.
- **F-179 (validateProfile doesn't enforce is_system_profile).** Aligns with V1 invariant from agent_profile_library §1; helper trusts caller.
- **F-167 (every supabase factory uses non-null assertions).** Not directly a spec rule but the same defensive-validation pattern as F-14 (Anthropic key check).
- **F-192 (`.single()` on org fetch in agent routes).** Five new H-01 sites surfaced by the spec lens.

---

*Tier B audit complete. **Stopping here per checkpoint policy.** Continue to Tier C (`lib/hooks/`, `lib/export/`, `lib/context/`) on your go. Tier C is small (~10 files); a single catalog file with consolidated findings is appropriate.*
