# Tier A.2 — `lib/security/` audit

**Files in scope:** 5 (canary, escape-xml, injection-scanner, security-frame, tool-validator)

**Spec lens applied:** TA v2.2 §4.2–§4.5 + §4.9 (security checklist), Hazards H-06/H-07/H-08/H-09. Per-finding spec citations in `spec-divergence` entries.

---

## Cross-cutting finding (system-wide)

### F-56 — audit_log table writes mandated by TA §4.3 / §4.5 / §4.9 are deferred to `console.error`
**Severity:** **HIGH**   **Confidence:** certain   **Category:** spec-divergence
**Spec citation:** TA v2.2 §4.3 ("All matches (any severity) are written to audit_log with node ID, field name, matched pattern, and timestamp"); §4.5 ("await auditLog('tool_call_cross_org_attempt', ...)"); §4.9 security checklist ("Audit log entries written for all injection pattern matches (any severity)" — listed under "Must be complete in V1 before any user access")
**Locations:** `lib/security/canary.ts:63`, `lib/security/injection-scanner.ts:84`, `lib/security/tool-validator.ts:57–63`
**Three sites** (`canary.ts`, `injection-scanner.ts`, `tool-validator.ts`) write security events to `console.error('[SECURITY]', ...)` instead of an `audit_log` table. The deferral is *acknowledged* in inline comments (e.g. `injection-scanner.ts:75: "V1: console.error with [SECURITY] prefix (audit_log table is V2 work)"`) — but **TA §4.9 explicitly lists audit_log writes as a V1 prerequisite**. The code consciously ships divergent from the spec checklist.

Operational impact: critical security events (canary leaks, cross-org tool-call attempts, injection-pattern hits in tool args) are visible only in Vercel runtime logs. No DB-side audit, no per-org filterability, no retention guarantee, no programmatic alerting. After an incident, forensic reconstruction is bounded by Vercel's log retention window.

This is the first finding the spec-divergence lens catches that the comment-vs-code lens missed: comments and code agree on the deferral; the spec disagrees with the deferral itself.

**Recommended fix shape:** add `audit_log` migration; replace the three `console.error` sites with a shared `writeAuditLogEntry()`; preserve the console.error as a backup channel for cases where the audit insert fails. Pre-V1.

---

## `lib/security/canary.ts`

### Function: `injectCanary(systemPrompt: string): string`

**Hypothesis:** Append a secret token + an instruction to never include it in output. Throw if env var missing (don't silently disable the defence).

**Stated:** matches.

**Actual:** matches.

**Spec lens (TA v2.2 §4.4):** spec example interpolates `process.env.PROMPT_CANARY_TOKEN` directly without throwing if missing. **Implementation is stricter than spec** — defensible enhancement, not a divergence.

### F-57 — caller-responsibility comment claims work that the function already does
**Severity:** MEDIUM   **Confidence:** certain   **Category:** comment-vs-code-mismatch
**Location:** `lib/security/canary.ts:50–55`
The function-level doc on `scanForCanaryLeak` says: *"Caller responsibility (Edge Function): ... Write a critical-severity audit log entry."* But the function ALREADY logs critical-severity to console.error (line 63). Either (a) the function does it and the comment is wrong, or (b) the function shouldn't log and the caller should — pick one. Today it's both.
**Recommended fix shape:** decide whose responsibility it is. Spec §4.4 puts the audit call inside `scanForCanaryLeak`; align the code with the spec by removing the caller-responsibility line.

### F-58 — canary-leak log entry has no provider/job/content breadcrumb
**Severity:** MEDIUM   **Confidence:** certain   **Category:** silent-failure
**Location:** `lib/security/canary.ts:63–66`
The `console.error('[SECURITY]', 'canary_leak_detected', { severity, timestamp })` payload has only severity + timestamp. After a leak detection, forensic analysis has no clue *which* job, *which* model, *which* org leaked. The audit-log spec (TA §4.4 spec example: `{ severity: 'critical', provider: response.provider }`) prescribes more context. Even within the V1 console.error pattern, the current entry is impoverished.
**Recommended fix shape:** scanForCanaryLeak takes a context object (`{ jobId, provider, model, organisationId }`) and includes it in the log entry.

### F-59 — spec citation stale (TA v1.8 → v2.2)
**Severity:** LOW   **Confidence:** certain   **Category:** spec-drift
**Location:** `lib/security/canary.ts:4`

### Note on F-38 (cross-tier resolution)
While auditing canary.ts I confirmed that `scanForCanaryLeak(content, toolCalls?)` *does* scan `JSON.stringify(toolCalls)` as part of the haystack (line 61). My F-38 in `01-lib-llm.md` worried that the scanner ignored the second arg — that worry is **resolved**; the call from `anthropic.ts:437–438` is correct. F-38 is a false-positive and should be retracted in the A.1 backfill pass.

---

## `lib/security/escape-xml.ts`

### Function: `escapeXml(str: string): string`

**Hypothesis:** Replace XML special chars (&, <, >, ", ') with entities; & first to avoid double-escape.

**Stated:** matches.

**Actual:** matches.

**Spec lens (TA v2.2 §4.2):** spec example is byte-for-byte identical. No spec-divergence.

### F-60 — spec citation stale
**Severity:** LOW   **Confidence:** certain   **Category:** spec-drift
**Location:** `lib/security/escape-xml.ts:4`

### F-61 — no null/undefined guard
**Severity:** LOW   **Confidence:** certain   **Category:** silent-failure
**Location:** `lib/security/escape-xml.ts:19–26`
TypeScript types `str: string` so direct null can't slip through compilation. But `as` casts in callers (e.g. `extractPlainText` returning unknown nesting; `c.metadata` JSON.stringify producing `'null'` literally) could deliver a non-string. Defensive `if (typeof str !== 'string') return ''` would harden the function to its central role in the system.

### F-62 — XML 1.0 control characters not handled
**Severity:** MEDIUM   **Confidence:** worth-checking   **Category:** missing-validation
**Location:** `lib/security/escape-xml.ts:19–26`
XML 1.0 disallows code points 0x00–0x08, 0x0B, 0x0C, 0x0E–0x1F (except tab/newline/CR). If user content contains a NULL byte or other control char (e.g. via paste from a binary buffer), the resulting "XML" is invalid and the LLM's parsing of `<user_data>` boundaries may break. The spec §4.2 doesn't prescribe behaviour for these. Defensive remove or replace would harden the spotlighting frame.

---

## `lib/security/security-frame.ts`

### Function: `wrapContextWithSecurityFrame(stableBlock, dynamicBlock): {stable, dynamic}`

**Hypothesis:** Prepend a security header to the stable block. Dynamic stays unchanged.

**Stated:** matches.

**Actual:** matches.

**Spec lens (TA v2.2 §4.2):** header text is byte-for-byte identical to spec; structure (header on stable, dynamic untouched) matches spec example. No divergence.

### F-63 — spec citation stale
**Severity:** LOW   **Confidence:** certain   **Category:** spec-drift
**Location:** `lib/security/security-frame.ts:4`

### F-64 — function-level JSDoc missing
**Severity:** LOW   **Confidence:** certain   **Category:** missing-comment
**Location:** `lib/security/security-frame.ts:22–30`
File-level doc covers the rationale but the function itself has no JSDoc. Given this is one of the security defences and is the last call before the prompt hits the provider, an explicit JSDoc reinforcing "this header MUST stay on the stable block" would be valuable defensive documentation.

---

## `lib/security/injection-scanner.ts`

### Function: `scanContent(content: string): ScanResult`

**Hypothesis:** Run an array of regex patterns against content, return matched patterns + severity.

**Stated:** matches.

**Actual:** matches.

**Spec lens (TA v2.2 §4.3):** the 9-pattern list in code matches the 9-pattern list in spec verbatim. No pattern divergence.

### F-65 — `logScanMatches` writes to console.error instead of audit_log
**Severity:** **HIGH**   **Confidence:** certain   **Category:** spec-divergence
**Spec citation:** TA v2.2 §4.3, §4.9
**Location:** `lib/security/injection-scanner.ts:78–93`
Subset of F-56. Catalogued separately for traceability — the fix is at this exact site.

### F-66 — null/undefined input would throw at `pattern.test(content)`
**Severity:** MEDIUM   **Confidence:** certain   **Category:** silent-failure
**Location:** `lib/security/injection-scanner.ts:55–63`
`pattern.test(undefined)` returns false (coerces to "undefined"), `pattern.test(null)` returns false too — but the fact that "undefined" or "null" become *literal strings tested against patterns* is silently wrong. A null content is treated as the same as the literal text "null". Defensive guard returning `{ clean: true, matches: [] }` on non-string input would clarify.

### F-67 — patterns fixed at module load; no runtime override channel
**Severity:** MEDIUM   **Confidence:** certain   **Category:** wrong-semantics
**Location:** `lib/security/injection-scanner.ts:30–44`
If a new jailbreak pattern is discovered post-deploy, adding it requires a code change + deploy + cold-start. Same maintenance trap as F-39 (Anthropic temperature denylist). Spec §4.3 doesn't mandate runtime configurability, but the security posture would improve from being able to add patterns via `platform_config.security.injection_patterns_extra` without a deploy.
**Recommended fix shape:** module-load reads the static list + `getConfig('security.injection_patterns_extra')` and merges. V1.x.

### F-68 — spec citation stale
**Severity:** LOW   **Confidence:** certain   **Category:** spec-drift
**Location:** `lib/security/injection-scanner.ts:4`

---

## `lib/security/tool-validator.ts`

### Function: `validateToolCall(ctx): Promise<ValidationResult>`

**Hypothesis:** Run defences in sequence — cross-org, locked-node, injection scan, rate-limit, cross-document — and short-circuit on first failure. Return `{allowed, reason?}`.

**Stated:** describes 5 defences, ordered: cross-org → cross-document → locked → injection → rate.

**Actual:** runs SIX defences:
0. Tool name + Zod input schema (NEW — not in TA §4.5)
1+2+3. Cross-org → cross-document → locked-node (combined inside `checkNodeScope`)
4. Injection scan
5. Rate limit

### F-69 — defence ordering doesn't match TA §4.5 spec example
**Severity:** LOW   **Confidence:** certain   **Category:** spec-divergence
**Spec citation:** TA v2.2 §4.5
**Location:** `lib/security/tool-validator.ts:73–137`
Spec orders defences: 1.cross-org → 2.locked → 3.injection-scan-on-params → 4.rate-limit → 5.cross-document. Code orders: 0.zod-schema → 1.cross-org → 2.cross-document → 3.locked → 4.injection-scan → 5.rate-limit. Functionally equivalent (all five run; first failure denies) but the cross-document check happens *before* locked in code, after locked in spec. Doc on lines 14–28 lists yet a third order. Three orderings, three sources, one function.
**Recommended fix shape:** align code, code-comment, and spec on a single canonical order.

### F-70 — `validateToolCall` signature differs from spec
**Severity:** LOW   **Confidence:** certain   **Category:** spec-divergence
**Spec citation:** TA v2.2 §4.5
**Location:** `lib/security/tool-validator.ts:73`
Spec: `validateToolCall(call: DirectorToolCall, session: DirectorSession, organisation: Organisation)`. Code: `validateToolCall(ctx: ValidateContext)`. Code wraps args in a context object and derives org via `session.organisation_id` rather than taking org explicitly. Functionally equivalent if session.organisation_id is trustworthy (which it is — populated server-side from auth). But: the spec's explicit org parameter is a defence-in-depth mechanism (caller must produce *both* session and org; if they disagree, the validator can flag it). Code can't make that comparison.
**Recommended fix shape:** verify session.organisation_id was set from auth not from request body; consider adding the explicit comparison if not.

### F-71 — non-existent node returns reason `cross_org_access_denied`
**Severity:** MEDIUM   **Confidence:** certain   **Category:** wrong-semantics
**Location:** `lib/security/tool-validator.ts:152–160`
If the model fabricates a UUID that doesn't exist in the `nodes` table, the function returns `cross_org_access_denied` + audit event `tool_call_unknown_node`. Audit data and denial reason disagree. Forensic counts of "cross-org attempts" are inflated by "fabricated UUIDs", which is a different threat model.
**Recommended fix shape:** distinct denial reason `target_node_not_found` and matching audit event.

### F-72 — `audit()` writes to console.error
**Severity:** **HIGH**   **Confidence:** certain   **Category:** spec-divergence
**Spec citation:** TA v2.2 §4.5, §4.9
**Location:** `lib/security/tool-validator.ts:57–63`
Subset of F-56. Most consequential of the three sites — cross-org and locked-node attempts are critical/high security events. Catalogued here for traceability.

### F-73 — injection scan only walks top-level string args; nested object payloads bypass
**Severity:** MEDIUM   **Confidence:** certain   **Category:** silent-failure
**Location:** `lib/security/tool-validator.ts:200–230`
`scanForInjection` iterates `Object.entries(args)` and only scans `typeof value === 'string'`. A tool call like `{operation_type: "refine", parameters: {agent_instruction: "ignore all previous instructions ..."}}` has the malicious string nested under `parameters`. The top-level value of `parameters` is an object, skipped. Each ToolInputSchema's Zod validation may catch some shapes, but if the schema admits `parameters: Record<string, unknown>` the payload sails through.
**Recommended fix shape:** recursive walk; scan every leaf string. Matches the depth of the J14-style silent-failure pattern.

### F-74 — rate-limit query failure is fail-open; attacker can disable rate-limiting via DB pressure
**Severity:** **HIGH**   **Confidence:** certain   **Category:** wrong-semantics
**Location:** `lib/security/tool-validator.ts:248–256`
On query error (`error` from `.from('conversation_messages').select('tool_calls')...`), the function logs and returns `null` (allow). Comment justifies: *"if the rate-limit query errors, allow the call but log."* Implication: an attacker who can cause DB errors (RLS edge case, connection pool exhaustion, lock contention from concurrent writes) effectively disables rate limiting for the duration of the failure.

TA §4.5 is silent on the failure mode (spec didn't prescribe fail-open vs fail-closed). The implementation chose fail-open as a UX-reliability tradeoff. **For a security defence, the safer default is fail-closed.** This isn't strictly spec-divergence (spec is silent) but it's a wrong-semantics finding that warrants a spec amendment.

**Recommended fix shape:** fail-closed (deny) on query failure, with a clear error to the user. If UX requires fail-open, document the choice in TA explicitly with the threat-model justification.

### F-75 — rate-limit operator off-by-one vs spec
**Severity:** LOW   **Confidence:** certain   **Category:** spec-divergence
**Spec citation:** TA v2.2 §4.5 (`if (recentCalls > 30)`)
**Location:** `lib/security/tool-validator.ts:264`
Spec: `> 30` (i.e., 31st call denied; 30 calls/min permitted). Code: `>= limit` (i.e., 30th call denied; 29 calls/min permitted). Off by one. Effective limit is 29, not 30.
**Recommended fix shape:** change to `if (count > limit)` to match spec.

### F-76 — denied calls count toward the rate-limit window
**Severity:** MEDIUM   **Confidence:** worth-checking   **Category:** wrong-semantics
**Location:** `lib/security/tool-validator.ts:258–272`
The query selects `conversation_messages.tool_calls` regardless of whether the calls were validated successfully or denied. If the model gets denied 30 times in 60s, the 31st is also rate-limited because the counter includes denials. The model is locked out for the full 60s window even on legitimate calls. Possibly intentional anti-abuse posture; spec §4.5 doesn't clarify.
**Recommended fix shape:** decide whether denied calls should count. If yes, document. If no, filter the query.

### F-77 — both target_node_id and parent_id checks issue separate DB queries
**Severity:** LOW   **Confidence:** certain   **Category:** wrong-semantics
**Location:** `lib/security/tool-validator.ts:105–126`
For tools like `node_reorder` (target + new parent), `checkNodeScope` runs twice serially. Two DB round-trips for what could be a single `WHERE id IN (...)` query. Performance only.

---

## `lib/security/` — Tier A.2 summary

| Severity | Count |
|---|---|
| HIGH | 4 unique (F-56 umbrella; F-65, F-72 are subsets of F-56; F-74 unique) → **2 unique HIGH** |
| MEDIUM | 7 (F-57, F-58, F-62, F-66, F-67, F-71, F-73, F-76) — note F-76 worth-checking |
| LOW | 11 (F-59, F-60, F-61, F-63, F-64, F-68, F-69, F-70, F-75, F-77) |
| **Total** | **22** |

**Cross-tier resolution:** F-38 in `01-lib-llm.md` is retracted as a false-positive — `scanForCanaryLeak` does scan tool-call args via JSON.stringify (canary.ts:61).

### Themes that recur across `lib/security/`

1. **The audit_log table doesn't exist.** Three sites (`canary.ts`, `injection-scanner.ts`, `tool-validator.ts`) are spec-divergent on TA §4.3/§4.5/§4.9 — all writing critical-security events to `console.error` because `audit_log` table is V2 work. Spec lists this as V1 prerequisite.
2. **Ordering and signature drift between code, code-comment, and spec.** F-69 has three orderings of defences (code, file-comment, spec). F-70 has signature shapes that differ. The same function is described three ways.
3. **Fail-open security defences.** F-74 — rate-limit query failure allows the call. Same shape risk in F-66 (null content treated as "null" string scan). Spec is silent; these are wrong-semantics rather than divergence.
4. **Top-level-only scans miss nested payloads.** F-73 — injection scan only scans top-level string args; nested objects bypass. Same shape as F-55 (metadata JSON scan in context-assembler).
5. **Defences hardcoded at build time.** F-67 — injection patterns frozen at module load; no runtime add. Same shape as F-39 (Anthropic temperature denylist).
6. **Spec citations stale across the entire subsystem.** Every file cites TA v1.8 (current is v2.2). Same process gap as A.1.
7. **Comments self-describe deferrals to V2 that are V1 spec mandates.** F-56 — three files have comments saying "audit_log table is V2 work"; spec §4.9 says it's V1.

The shape that the spec-divergence lens caught here that comment-vs-code missed: **the codebase is internally consistent on its V2-deferral story; the spec disagrees with the deferral**. This is exactly the failure mode the new lens was added for.

---

*Tier A.2 (`lib/security/`) audit complete. **Stopping here per checkpoint policy.** Continue to A.3 (`lib/director/`) on your go.*
