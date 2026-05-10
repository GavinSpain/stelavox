# Round-3 audit — consolidated themes

**Source:** all eight per-tier catalogues (`01-lib-llm.md` through `08-tier-d.md`), plus the A.1 backfill.

**Total findings:** 227 across 138 files, weighted toward MEDIUM (104 / 45 / 78). Plus 1 retraction (F-38) and ~7 positive findings.

This document consolidates the recurring patterns that span multiple subsystems. **Most of the 45 HIGH findings collapse into ~12 root causes when grouped by theme.** Fix prioritisation should target themes, not individual findings.

---

## Theme T-1 — Silent failure on transport / error / race (HIGH-density theme)

**18+ instances across all subsystems.** The dominant pattern. Functions that should fail loudly return null, drop events, swallow errors, or resolve Promises cleanly when the underlying operation actually broke.

**Sites:**
- F-34, F-37 — Anthropic stream loop `default: break` swallows error events
- F-46 — `fetchBookSynopsisForContextNode` returns null on broken back-link instead of falling through
- F-71 — non-existent node treated as cross-org
- F-85, F-107, F-142 — SSE encoder / chunk loop default-case fall-through
- F-92, F-94, F-139 — `streamMessage` / `streamSynthesise` Promise resolves on transport failure
- F-101 — generic `tool_execution_error` wraps every executor exception
- F-105 — `parseWorkflowProposal` collapses 3 failure modes to null
- F-129 — `stream ended without usage info` → generic internal_error
- F-134 — `updateUsageRecords` doesn't check error from INSERT/UPDATE
- F-152 — `decorateWithLeaf` returns is_leaf=false on layer_stack fetch failure
- F-160 — `Math.max(...layers.map(l => l.index ?? 0))` masks malformed layers as 0
- F-166 — `deleteContextLink` `data?.length ?? 0` doesn't distinguish 404 from DB error
- F-170, F-171, F-172 — editor-store autosave network failure / non-200 status / reload silent
- F-189 — `.gt('order', N)` PostgREST footgun documented but unenforced
- F-201 — `useAgentJobsRealtime` no WebSocket error handler
- F-220 — `NodeDetailPanel` rename PATCH no-ops on transport failure

**Root cause:** the codebase consistently chooses fail-quiet over fail-loud at edge cases. Defensible in a few places (heartbeat must not crash the runner) but adopted unilaterally as a default.

**Recommended fix shape:** project-wide convention — every catch must either re-throw, log with context, or emit a typed error event. Add a lint rule banning bare `} catch { }` and `} catch { return }` in production code.

---

## Theme T-2 — H-01 violations (`.single()` where `.maybeSingle()` is correct)

**8+ instances.** Spec hazard explicitly documented; code drifted.

**Sites:**
- F-144 — `lib/data/projects.ts:updateProject`
- F-148 — `lib/data/documents.ts:updateDocument`
- F-155 — `lib/data/nodes.ts:updateNode`
- F-163 — `lib/data/context-links.ts:createContextLink` (comment claims maybeSingle, code uses single)
- F-192 — All 5 `/api/agent/*` routes use `.single()` on org fetch

**Root cause:** H-01 is documented in TA but never enforced in CI. ESLint rule could ban `.single()` on UPDATE / fetch-by-id paths.

**Recommended fix shape:** ESLint rule `no-supabase-single` that flags `.single()` and requires inline `// allow-single: zero rows is genuinely an error because <reason>` comment. Existing call sites are reviewed against the H-01 rule.

---

## Theme T-3 — Two sources of truth (drift cluster)

**8+ instances.** Two implementations of the same concept that must stay in sync, with no compile-time guard.

**Sites:**
- F-19 — BYOK detection: `org.plan` substring vs `org.byok_enabled` boolean (factory vs token-budget)
- F-81 — Tool input shapes: JSON Schema in `tools/index.ts` vs Zod in `schemas.ts`
- F-90, F-91 — Manual `WorkflowRow`/`WorkflowStepRow` types vs generated `Database` types
- F-116 — `target_field='metadata'` admitted by Director, rejected by runtime operations
- F-120 — `extractJsonArray` (expand) and `extractJsonObject` (generate-context) duplicate fence-strip + balanced-extract
- F-141 — `parseSseBlock` in streamSynthesise vs streamMessage
- F-145, F-149, F-162, F-203, F-206 — Manual `Record<string, unknown>` / DTO types vs DB columns
- F-209 — `metadata-schemas.ts` (form) vs agent_profile_library §2.12–§2.17 (prompts)
- F-217 — `getOrgId` duplicated in `lib/data/projects.ts` and `components/layout/AppShell.tsx`

**Root cause:** absence of a single-source-of-truth for cross-cutting shapes. Each instance was added in isolation; drift accumulates over phases.

**Recommended fix shape:** depends on the pair:
- Tool schemas: generate JSON Schema from Zod via `zod-to-json-schema`
- Row types: import from `Database['public']['Tables']['X']['Row']`
- BYOK detection: single helper `isByok(org)`
- `getOrgId`: consolidate to one site (probably `lib/data/projects.ts`)
- metadata-schemas: generate from agent_profile_library at build time, OR runtime-validate emitted metadata against the form schema

---

## Theme T-4 — Race conditions without UPSERT/atomic primitive

**5 instances.** SELECT-then-INSERT-or-UPDATE patterns that race under concurrency.

**Sites:**
- F-96 — `nextSequence` `MAX(sequence) + 1`
- F-99 — `getOrCreateConversation` SELECT-then-INSERT
- F-132 — `persistFinalResult` filters `.neq('status','cancelled')` instead of `.eq('status','running')`
- F-133 — `updateUsageRecords` SELECT-then-INSERT-or-UPDATE
- F-154 — `createNode` `MAX(order) + 1` (acknowledged in comment, not fixed)

**Root cause:** Postgres UPSERT (`INSERT ... ON CONFLICT ... DO UPDATE`) and atomic CAS-style (`.eq` filters) patterns aren't applied consistently.

**Recommended fix shape:** audit migrations for missing UNIQUE constraints; convert each site to UPSERT or wrap in an RPC that does `FOR UPDATE` locking.

---

## Theme T-5 — Find-first without ORDER BY (non-deterministic)

**6+ instances.** `.limit(1).maybeSingle()` (or `.find()` over an unordered array) where multiple rows are possible.

**Sites:**
- F-46, F-47, F-50, F-54 — context-assembler back-link / sibling / style-guide selection
- F-143 — `getOrgId` returns arbitrary org for multi-org users
- F-180 — `checkConcurrency` find-first if multiple jobs exist
- F-217 — AppShell duplicates F-143

**Root cause:** assumption that "exactly one row exists" without enforcement.

**Recommended fix shape:** every `.limit(1)` site adds explicit `.order(...)` with a deterministic key (created_at ASC is usually correct).

---

## Theme T-6 — Spec mandates X, code consciously deferred to V2, V1 checklist says X is V1-mandatory

**3 instances.** Internally-consistent V2-deferral comments that the spec disagrees with.

**Sites:**
- F-56 — `audit_log` table writes (TA §4.3/§4.5/§4.9) deferred to `console.error`. V1 checklist says it's V1-required.
- F-78 / F-115 — `create_document_operation_step` write tool. TA §8.3 lists it; code carves it out per "Phase 5b carve-out".
- F-89 — `assertConversationAuthor` admits any caller when no user messages exist. TA §4.5 doesn't permit exemptions.

**Root cause:** Phase boundaries created carve-outs that didn't propagate back into the spec. Spec is now misleading on what V1 actually ships.

**Recommended fix shape:** for each: either land the deferred work, or amend the spec to acknowledge the V1 carve-out with a "scheduled for Vx" note.

---

## Theme T-7 — `escapeXml` / injection-scan bypass on user content

**5 instances.** Sites that produce LLM input from user-controlled strings without going through the security frame.

**Sites:**
- F-55 — context-assembler `formatContextNodes` metadata JSON-stringified then scanned as plain text
- F-73 — `tool-validator.ts` injection scan only walks top-level string args
- F-95 — `summariseConversation` builds promptBody without escapeXml or injection scan
- F-113 — workflow-executor auto-create context node embeds `seed_content` raw
- F-156 — `listContextNodesByProject` string-interpolated PostgREST `.or()` filter (today UUID-validated upstream; defence-in-depth gap)

**Root cause:** the security frame (escapeXml + scanContent + `<user_data>` wrapping) is a discipline applied at most call sites but not all. New sites don't get it by default.

**Recommended fix shape:** centralise the wrapping. Every prompt-builder accepts only "wrapped" types (a brand-typed `WrappedUserText`); raw strings can't reach the LLM. Type-system enforcement.

---

## Theme T-8 — Race conditions / atomicity violations in node operations (H-04)

**3 instances.** H-04 mandates atomic sibling renumbering; code uses sequential UPDATEs.

**Sites:**
- F-154 — `createNode` (create-at-end has the same race as reorder)
- F-188 — `renumberSiblingsAfterDelete` runs sequential UPDATEs after DELETE; comment acknowledges atomicity gap
- F-189 — `.gt('order', N)` PostgREST footgun

**Root cause:** Migration 021's `move_node` RPC handles the H-04-correct path for moves. No equivalent RPC for create-at-end or delete-with-renumber.

**Recommended fix shape:** add `create_node_at_end` and `delete_node_with_renumber` RPCs analogous to `move_node`. Replace the route-level sequential-UPDATE pattern with RPC calls.

---

## Theme T-9 — H-12 hardcoded operational values

**6+ instances.** Spec H-12 says no hardcoded operational values; code has them at multiple sites.

**Sites:**
- F-39 — Anthropic temperature denylist regex `^claude-opus-4-([7-9]|\d{2,})`
- F-67 — Injection-scanner patterns frozen at module load
- F-97, F-103 — Director session summariser temperature/maxTokens; executor fallbacks
- F-128 — `runAgentJobInline` hardcoded `providerName = 'anthropic'`
- F-167 — Supabase env var assertions
- F-193 — Agent routes hardcode `profile.max_tokens + 4096` budget estimate
- F-199 — Cron `120_000` grace window
- F-223 — `DirectorPanel` 580/400 widths

**Root cause:** H-12's "no hardcoded values" is interpreted narrowly (only token budgets / prices / model IDs). Other operational values (regexes, sizes, fallbacks) drift in.

**Recommended fix shape:** broader interpretation of H-12 — anything that may need to change without a deploy goes in platform_config. Document the principle explicitly in the spec.

---

## Theme T-10 — Sequential walks where one RPC/CTE would suffice (perf)

**4 instances.** Parent-chain walks executed as N+1 queries.

**Sites:**
- F-44 — `fetchAncestors` (context-assembler)
- F-51 — `fetchLinkedContextNodes` re-fetches target node
- F-164 — `listAncestorLinksForNode` walks parent chain
- F-190 — `ancestorChainLocked` walks parent chain
- (Plus the cron route's stuck-interim sweep)

**Root cause:** supabase-js can't emit recursive CTEs without an RPC. The walk-and-collect pattern is repeated.

**Recommended fix shape:** single Postgres function `walk_ancestors(node_id, options)` that returns the chain in one round trip; helpers in lib/data wrap it.

---

## Theme T-11 — Generic catch-all error wrappers losing cause

**5 instances.** Try/catch that produces a generic error label, hiding the actual failure.

**Sites:**
- F-71 — non-existent node → `cross_org_access_denied`
- F-101 — tool executor exception → `tool_execution_error`
- F-105 — three failure modes of `parseWorkflowProposal` → null
- F-119 — three throw-paths in expand operation use inconsistent `output_schema_invalid:*` shapes
- F-129 — stream-without-usage → generic internal_error

**Root cause:** the caller wants a single error type to handle. The function aggregates multiple causes into one label. Forensic reconstruction post-incident is harder than necessary.

**Recommended fix shape:** typed error classes with discriminated unions; each cause gets its own enum value. Caller still gets one shape but can branch on cause.

---

## Theme T-12 — Inviolable #2 verdigris violations

**2 instances** (Tier D only).

**Sites:**
- F-213 — `DirectorInput` Send button background uses verdigris
- F-214 — `PlanCard` step checkbox checked-state uses verdigris border + background

**Root cause:** the design moved beyond the original 9 sanctioned uses without amending Brand Identity. Two new "Director affirmative-action" colour uses crept in.

**Recommended fix shape:** decide intent. Either (a) revert to text-primary on these elements; or (b) propose explicit broadening of use #7 in Brand Identity v2.2 to cover "Approve flow controls including step toggles + Director Send".

---

## Theme T-13 — Spec staleness on rapid-iteration files

**Cross-cutting low-severity finding across every subsystem.** Almost every audited file cites a stale spec version (TA v1.8 → v2.2; Phase N API contracts at v1.0/v1.2 with no recent bumps tracked).

**Sites:** F-01, F-06, F-16, F-41, F-59, F-60, F-63, F-68, F-80, F-117, F-147, F-151, F-212 — and likely more inline.

**Root cause:** spec citations are static strings in source files. Bumping the spec version doesn't auto-update them.

**Recommended fix shape:** lint rule that flags `_v\d+_\d+\.md` references and warns when they don't match the current version listed in CLAUDE.md. Or: simpler — drop the version from inline citations, cite by section number only, and assume the live spec is canonical.

---

## Closing observations

**The audit's biggest signal isn't the count of bugs — it's the shape of the recurring patterns.** Every theme above repeats across multiple subsystems. Each repetition means *the codebase doesn't have a structural defence against that class of bug*.

**Fix prioritisation should target themes, not findings.** A single project-wide fix for T-1 (silent failure on transport) closes 18+ findings simultaneously. Going per-finding produces 18 commits with 18 review cycles for the same conceptual change.

**The spec lens caught what the comment-vs-code lens couldn't.** Most HIGH findings in A.2 (security) and the Tier D Inviolable #2 violations were spec-divergence-only. Internally consistent code that disagreed with the spec. The lens addition was the right call.

**Code is more often correct than the spec.** Especially in lib/llm and lib/agent — TA v2.2 hasn't caught up to Phase 5b/5c work. The audit surfaced ~13 spec-drift findings where the spec needs updating, not the code.

**The single most-leveraged fix:** F-07 — `getConfig<T>` casts without validation. That one fix removes the F-20, F-21, F-32, F-50, F-138 cascades. Similar leverage exists at F-152 (decorateWithLeaf null cascade → F-195 affecting every node-API response).

---

*This consolidated themes document closes the audit-execution phase. Next step per the user's pre-audit instruction: come back to the user for a "serious look at the results" before any fix work begins.*

---

## FULL-PASS UPDATE — 2026-05-10

After the user pushed back on Tier D sampling, the audit was extended:
- **Tier D full pass** added 19 findings to the original 13 → **32 total**.
- **Tier E** (originally-excluded `scripts/`, `tests/`, `supabase/migrations/`, `docs/`) added 12 findings.

Combined: **258 findings, 48 HIGH** (was 227 / 45). Plus 11 positive findings + 1 retraction.

### Theme deltas

The 13 themes already documented are unchanged in shape; per-theme site counts grew. Plus one new theme.

**T-1 silent failure on transport / error / race** — now **26+ sites** (was 18+).
*Tier D full-pass adds:* F-237 (SelectionTooltip blur leak), F-238 (BackLinksList), F-239 (ContextLinker), F-240 (detail/NodePicker), F-243 (CommentThread resolve/delete), F-244 (director/NodePicker), F-247 (NodeMoreMenu), F-248 (FocusMode siblings), F-250 (ContextCreateModal documents).
*Tier E adds:* F-254 (scripts pervasive `} catch {}`).
**The dominant theme keeps gaining sites at every audit pass.** Component-layer fetches are the new nest. Project-wide convention change is the only sane fix.

**T-2 H-01 violations** — now **10+ sites** (was 8+).
*Tier E adds:* F-258 (tests/helpers/db.ts).

**T-3 two sources of truth** — now **15+ sites** (was 8+).
*Tier D adds:* F-241 (VersionHistory's own extractPlainText), F-245 (nodeTypeIcon vs lib/context/icons.ts), F-246 (two NodePicker components), F-251 (`globals.css` verdigris-backdoor mappings on `--sidebar-primary` and `--chart-1` — DORMANT but pre-wired), F-252 (shadcn ui/ Tailwind tokens vs CSS custom props).
*Tier E adds:* F-257 (third `getOrgId` implementation), F-260 (custom env loader vs dotenv).
**This is now the second-largest theme.** The codebase has accumulated parallel implementations of the same primitives at a rate that suggests no architectural defence against the pattern.

**T-4 race conditions** — DB-level confirmation. No new application sites; Tier E migrations show:
- `nodes` is **missing** UNIQUE on (parent_id, "order") — F-265. Application races (F-154, F-188) are unguarded at the DB. Producing duplicate `order` values is silent at every layer.
- `conversation_messages` is **missing** UNIQUE on (conversation_id, sequence) — F-266. F-96 race unguarded.
- `conversations` HAS UNIQUE(document_id) — F-99 guarded ✓
- `usage_records` HAS the right UNIQUE — F-133 partially guarded (DB rejects, F-134 swallows error)

**T-12 Inviolable #2 verdigris violations** — still 2 active (F-213/F-214) + 1 dormant (F-251 — verdigris-mapped Tailwind variables that no component currently uses but any future shadcn primitive could pick up silently).

### NEW: Theme T-14 — Validation only at the API layer; DB doesn't enforce the same invariants

**Sites:**
- F-267 — `nodes.node_type` is TEXT with no CHECK constraint
- F-268 — `nodes.created_by`/`last_modified_by` are TEXT with placeholder default
- F-269 — `summary`/`prose`/`notes` stored as TEXT (JSON-stringified) not JSONB
- F-90, F-91, F-145, F-149 — manual TS row types vs generated DB types
- F-203, F-206 — DTO shapes diverge from DB column nullability

**Root cause:** validation discipline is "Zod at the API boundary, route-level checks for invariants". Direct DB writes (service-role from runner.ts, workflow-executor's auto-create-context-node F-113, admin operations, data migration) bypass it. The DB has no defence-in-depth.

**Recommended fix shape:** for each enum-like field (`node_type`, `comment_type`, `node_category`, `status`), add a CHECK constraint OR a Postgres ENUM type. Similar for FK fields like `created_by` (UUID FK to auth.users). For Tiptap content, JSONB with a CHECK that validates basic shape.

---

### What the migrations audit closed

Migration audit closed the loop on **Theme T-8** (H-04 atomicity violations):
- Application races (F-154, F-188) — DB has no constraint to catch
- F-265 — DB layer doesn't help
- **Both layers fail H-04.** Both need fixing for the cluster to close.

Migration audit revealed the **partial-mitigation pattern** in T-4:
- F-263 (conversations UNIQUE) ✓ — race fully guarded
- F-264 (usage_records UNIQUE) ✓ — race rejected at DB BUT F-134 swallows = data loss
- F-265 (nodes missing UNIQUE) ✗ — race unguarded
- F-266 (conversation_messages missing UNIQUE) ✗ — race unguarded

The migrations-audit signal: *some* races are guarded, *some* aren't, with no obvious pattern explaining why one table got the constraint and another didn't. Inconsistent migration discipline rather than considered choice.

### New positive findings (full pass)

- **F-262** — H-13 fully compliant. All 14 SECURITY DEFINER functions correctly have `SET search_path = public`. Migrations 016 and 017 retroactively patched the two original functions that lacked it. The hazard process worked.
- **F-263, F-264** — DB-level UNIQUE constraints guard F-99 and F-133 races.
- **F-256** — `cost-report.ts` uses correct schema (no drift).
- **F-208** — `useNodeRealtime` and `useNodesRealtime` follow H-05 cleanly.
- **F-211** — `CONTEXT_NODE_TYPES_V1` is a single-source-of-truth that the rest of T-3 should follow.
- **F-225** — `ExecutionCard` heartbeat per Component Spec v2.8 §7.7.
- **F-227** — `NodeRow` left-border verdigris is sanctioned use #9.

### What changed between sample and full pass

- **+3 HIGH findings** — F-242 (CommentThread comment_type 3-source disagreement), F-253 (smoke-agent-runner RPC drift), F-265 (nodes UNIQUE missing). All three are existing-pattern repeats; the full pass surfaces same-shape findings the sample missed.
- **No genuinely new themes from full pass.** The 13 original themes plus T-14 cover all 258 findings.
- **The user's instinct was right.** Two findings would have stayed invisible without full-pass discipline: F-253 (broken script that's been broken since before the round-3 typecheck gate landed) and F-265/F-266 (DB constraints that only appear when you grep the migrations). Both are exactly the round-3 lesson — schema drift in places that aren't routinely run.

### Most-leveraged structural fixes (updated)

The **48 HIGH findings collapse to ~14 root causes**. Picking those 14 closes the audit at the structural level:

1. **F-07** → cascades to F-20, F-21, F-32, F-50, F-138 + adds runtime validation across platform_config layer
2. **F-152 / F-160** → cascades to F-195 (every node-API response affected when layer_stack fetch fails)
3. **Project-wide silent-failure convention** (T-1) → 26+ sites with one decision
4. **`audit_log` table migration** (F-56) → 3 spec-divergence sites + 4 critical-event-blackout findings
5. **Add UNIQUE constraints to `nodes(parent_id, "order")` and `conversation_messages(conversation_id, sequence)`** (F-265, F-266) → closes T-4 + T-8 at the DB layer
6. **CHECK constraints on enum fields** (F-267 etc.) → closes T-14 at the DB layer
7. **Single `getOrgId` helper** consolidating F-143 + F-217 + F-257 → closes one instance each of T-3 + T-5
8. **Generate JSON Schema from Zod**; **import row types from generated `Database`** → closes F-81 + F-90/91/145/149 (T-3 cluster)
9. **`requireEnv` helper** (F-167) → centralises six `process.env.X!` sites
10. **UPSERT for `updateUsageRecords`** (F-133/F-134) → closes the billing-data-loss race
11. **director routes call `checkTokenBudget`** (F-187) → closes H-07 holes 2/3
12. **workflow_step dispatches call `checkTokenBudget`** (F-124) → closes H-07 hole 3/3
13. **Inviolable #2 fix** (F-213, F-214, F-251 dormant) → closes T-12
14. **Either fail-closed on rate-limit query failure (F-74) OR document the choice in TA explicitly** → policy decision

The remaining ~30 HIGH findings are unique to their site and need per-site fixes (not pattern-fix-able). Most are MEDIUM in practice — most-leveraged-by-effort gives the structural fixes priority.

---

*Full-pass update complete. Audit-execution phase is now genuinely done. The user-deferred "serious look at the results" is the next step.*
