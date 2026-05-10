# Tier A.5 — `lib/data/` audit

**Files in scope:** 5 (nodes, versions, projects, documents, context-links) — ~826 lines

**Spec lens applied:** TA v2.2 §3 (Backend / Database), H-01 (`.maybeSingle()` vs `.single()`), H-04 (atomic reorder), H-14 (documents ↔ layer_stacks insert order), H-15 (leaf-ness as layer-stack property), Phase 2/3/4 API contracts.

---

## `lib/data/versions.ts`

**No findings.** H-01 followed correctly; columns split between list-view and full-view; `range()` for pagination. Audited clean.

---

## `lib/data/projects.ts`

### F-143 — `getOrgId` returns arbitrary org for multi-org users
**Severity:** **HIGH**   **Confidence:** certain   **Category:** wrong-semantics
**Location:** `lib/data/projects.ts:6–13`
```typescript
export async function getOrgId(supabase: Client): Promise<string | null> {
  const { data } = await supabase
    .from('organisation_members')
    .select('organisation_id')
    .limit(1)
    .maybeSingle()
  return data?.organisation_id ?? null
}
```
For a user who is a member of multiple orgs, `.limit(1).maybeSingle()` returns whichever row PostgREST happened to return first. No `ORDER BY`. **Project creation goes to a non-deterministic org.** Same shape as F-46/47/50/54 (find-first without ordering). For V1 there's no UI for cross-org membership but the function is wrong as a primitive and would silently misbehave the moment multi-org lands.
**Recommended fix shape:** take a `userId` parameter; require an `org` selection upstream. Or document explicitly that this is "single-org users only" with an assertion that throws if `organisation_members.count > 1`.

### F-144 — `updateProject` uses `.single()` despite zero-rows being a valid UPDATE outcome
**Severity:** MEDIUM   **Confidence:** certain   **Category:** spec-divergence
**Spec citation:** TA v2.2 H-01
**Location:** `lib/data/projects.ts:42–53`
UPDATE matches by `eq('id', projectId)`. If the project was deleted between the API route's read and the wrapper's UPDATE, zero rows match → `.single()` throws. H-01 says use `.maybeSingle()` when zero rows is a valid result.

### F-145 — `fields: Record<string, unknown>` on update is type-unsafe
**Severity:** MEDIUM   **Confidence:** certain   **Category:** missing-validation
**Location:** `lib/data/projects.ts:42–46, 47`
Caller can pass any keys; no compile-time guard against typos or wrong types. Should be `Database['public']['Tables']['projects']['Update']`.

### F-146 — `getOrgId` has no JSDoc
**Severity:** LOW   **Confidence:** certain   **Category:** missing-comment
**Location:** `lib/data/projects.ts:6`
Critical primitive (every project create needs an org); zero documentation about its single-org assumption.

### F-147 — file has no header doc
**Severity:** LOW   **Confidence:** certain   **Category:** missing-comment
**Location:** `lib/data/projects.ts:1–5`

---

## `lib/data/documents.ts`

### F-148 — `updateDocument` uses `.single()` despite zero-rows being valid
**Severity:** MEDIUM   **Confidence:** certain   **Category:** spec-divergence
**Spec citation:** TA v2.2 H-01
**Location:** `lib/data/documents.ts:47–58`
Same shape as F-144.

### F-149 — `fields: Record<string, unknown>` on update is type-unsafe
**Severity:** MEDIUM   **Confidence:** certain   **Category:** missing-validation
**Location:** `lib/data/documents.ts:47–51`
Same shape as F-145.

### F-150 — `deleteDocument` has no count check or cascading-delete guard
**Severity:** MEDIUM   **Confidence:** worth-checking   **Category:** missing-validation
**Location:** `lib/data/documents.ts:60–65`
Returns the result without checking what was deleted. If the document has thousands of nodes and versions, the cascading FK delete may take a long time or fail mid-cascade. If the migration set up cascades correctly, this is fine. Worth verifying via the migrations audit (queued).

### F-151 — file has no header doc
**Severity:** LOW   **Confidence:** certain   **Category:** missing-comment

---

## `lib/data/nodes.ts`

### F-152 — `decorateWithLeaf` returns `is_leaf: false` when `maxLayerIndex` is null
**Severity:** **HIGH**   **Confidence:** certain   **Category:** spec-divergence
**Spec citation:** TA v2.2 H-15 ("Leaf-ness is a layer-stack property")
**Location:** `lib/data/nodes.ts:76–82`
```typescript
const is_leaf = maxLayerIndex !== null && node.layer_index === maxLayerIndex
```
If `maxLayerIndex` is null (layer_stack fetch returned no template-non-template row, or transient DB error in `getDocumentMaxLayerIndex`), every node gets `is_leaf: false`. Per H-15: *"Clients MUST consume this server-derived field rather than computing leaf-ness from tree state."* — and the field exists. But: when the field is set to `false` because the *server* couldn't determine it, **leaf-only UI affordances disappear silently** (ProseEditor, Synthesise button, `+ Add child` shown on leaves where it shouldn't be). The user sees no error. Same fail-quiet shape as the rest of the silent-failure cluster.
**Recommended fix shape:** throw if `maxLayerIndex` is null; let the route catch and 500 with a clear error. Don't silently return wrong leaf-ness.

### F-153 — `getDocumentMaxLayerIndex` filters `is_template=false`; race on document creation
**Severity:** MEDIUM   **Confidence:** worth-checking   **Category:** wrong-semantics
**Spec citation:** TA v2.2 H-14 (`documents ↔ layer_stacks` insert order)
**Location:** `lib/data/nodes.ts:57–74`
H-14 mandates a specific insert order: stack first (NULL doc_id), then document, then UPDATE the stack to point at the doc. If a leaf-ness query lands during the brief window when the stack exists but isn't yet linked to the document, this query returns null. **Cascades to F-152** — every node appears non-leaf during that window.
**Recommended fix shape:** verify the create_document_with_layer_stack RPC is atomic across all three steps. If it is, F-153 doesn't manifest in practice — but the wrapper should still throw rather than return null.

### F-154 — `createNode` `order = max(siblings) + 1` race acknowledged but not fixed
**Severity:** **HIGH**   **Confidence:** certain   **Category:** spec-divergence
**Spec citation:** TA v2.2 H-04 ("Integer node ordering renumbers all siblings, not just affected nodes")
**Location:** `lib/data/nodes.ts:24–30, 103–112`
File-level comment lines 24-30: *"There is a theoretical race where two concurrent appends compute order = max(siblings) + 1 independently and end up duplicating. Phase 2 is single-user-per-document; the race window is sub-millisecond."* The single-user assumption is wrong: round-3 testing exercised multi-tab concurrent edits (Step 2). Two tabs adding nodes at the same parent concurrently can both compute the same `order`. Whether the second INSERT fails depends on whether `(parent_id, order)` has a UNIQUE constraint — H-04 mandates atomic reordering but doesn't enforce a constraint.
**Recommended fix shape:** wrap in an RPC that takes `FOR UPDATE` on the parent row before computing max + 1. Or use the existing `move_node` RPC pattern (Migration 021) for create-at-end too. **Same shape as F-96 (nextSequence), F-99 (getOrCreateConversation), F-133 (usage-records).**

### F-155 — `updateNode` uses `.single()` despite zero-rows being valid
**Severity:** MEDIUM   **Confidence:** certain   **Category:** spec-divergence
**Spec citation:** TA v2.2 H-01
**Location:** `lib/data/nodes.ts:147–158`
UPDATE-by-id where the node was concurrently deleted returns zero rows; `.single()` throws. Same shape as F-144, F-148. The `updateNodeOptimistic` and `updateNodeOptimisticByContentRevision` variants correctly use `.maybeSingle()` because mismatch IS an expected case — but `updateNode` follows H-01's wrong-side default.

### F-156 — `listContextNodesByProject` builds an `.or()` filter via string interpolation
**Severity:** **HIGH**   **Confidence:** certain   **Category:** silent-failure
**Location:** `lib/data/nodes.ts:309–311`
```typescript
query = query.or(`scope.eq.project,and(scope.eq.document,document_id.eq.${f.documentId})`)
```
String interpolation directly into a PostgREST filter expression. If `f.documentId` contains characters PostgREST interprets specially (commas, parens, quotes, dots), the filter is malformed or the matching is wrong. Today documentId is a UUID (validated upstream by the route's UUID guard) so the live exposure is zero. But: defence-in-depth says wrappers shouldn't rely on caller-side validation. **Same family as F-55 (metadata JSON-stringified scan).**
**Recommended fix shape:** assert UUID format inside the wrapper, or use `.in()` plus a separate `eq(scope, ...)` chain.

### F-157 — `updated_at` set client-side instead of via DB trigger
**Severity:** MEDIUM   **Confidence:** worth-checking   **Category:** wrong-semantics
**Location:** `lib/data/nodes.ts:154, 175, 194` (also `documents.ts:54`, `projects.ts:49`)
All update wrappers set `updated_at: new Date().toISOString()` — client wall-clock time. Edge Functions across regions can have skewed clocks. A DB-side trigger setting `updated_at = NOW()` would be authoritative. Spec doesn't explicitly mandate one or the other; verifying via migration audit if a trigger already exists.

### F-158 — `deleteNode` has no count check
**Severity:** MEDIUM   **Confidence:** certain   **Category:** missing-validation
**Location:** `lib/data/nodes.ts:201–206`
Returns the result without verifying anything was deleted. Caller has no way to distinguish "deleted successfully" from "didn't match". Should return a count or throw on zero-rows-affected.

### F-159 — `listNodes` returns breadth-first; depth-first is contract-applied at route layer
**Severity:** LOW   **Confidence:** certain   **Category:** wrong-semantics
**Location:** `lib/data/nodes.ts:14–22, 114–133`
Comment acknowledges: wrapper returns `(depth ASC, order ASC)` but API contract mandates depth-first. The route is responsible for the in-memory sort. Coupling between layers — if a future caller forgets the depth-first sort, they get the wrong order. Defensible (no recursive CTE without RPC) but the convention is fragile.

### F-160 — `Math.max(...layers.map(l => l.index ?? 0))` masks malformed layer data as 0
**Severity:** MEDIUM   **Confidence:** certain   **Category:** silent-failure
**Location:** `lib/data/nodes.ts:73`
If `layers` is `[{index: undefined}, {index: undefined}]` (corrupt data), returns 0 — meaning "max layer index is 0, so root is the leaf". Cascades to F-152: every non-root node returns false for is_leaf, every root returns true. Silently wrong.

### F-161 — `createContextNode` hardcodes `version: 1`
**Severity:** LOW   **Confidence:** certain   **Category:** wrong-semantics
**Location:** `lib/data/nodes.ts:254`
Migration 037 (round-3) bumped the column default to 1. Code still sets it explicitly. Defence-in-depth fine; documents the V1 invariant. Not really a bug.

### F-162 — `listContextNodesByProject` `.order('name')` is case-sensitive
**Severity:** LOW   **Confidence:** certain   **Category:** wrong-semantics
**Location:** `lib/data/nodes.ts:319–320`
Comment acknowledges: PostgREST through supabase-js can't `lower(name)` directly. Result is non-human-friendly ordering for mixed-case names. Acceptable per V1 contract.

---

## `lib/data/context-links.ts`

### F-163 — `createContextLink` uses `.single()` but comment claims `.maybeSingle()` semantics
**Severity:** MEDIUM   **Confidence:** certain   **Category:** comment-vs-code-mismatch
**Location:** `lib/data/context-links.ts:36–57`
Comment lines 36-39: *"on UNIQUE constraint violation the maybeSingle resolves to data: null"*. Code at line 56 uses `.single()`. **They disagree.** On UNIQUE violation, `.single()` errors via the PostgreSQL error path; `.maybeSingle()` would also error (zero rows aren't returned on a violation — the violation IS the error). Comment is wrong about the mechanism, but the route's 409 handling probably catches the error correctly. Cosmetic but misleading documentation.

### F-164 — `listAncestorLinksForNode` walks parent chain sequentially; cycle cap silently truncates
**Severity:** MEDIUM   **Confidence:** certain   **Category:** wrong-semantics
**Location:** `lib/data/context-links.ts:154–178`
Same shape as F-44 (fetchAncestors) and F-45 (no cycle detection). Walks N-1 hops in N+1 sequential queries. Caps at 10 hops on pathological data — silently truncates rather than throwing on suspected cycle.

### F-165 — `listBackLinks` JS-side sort with no pagination
**Severity:** MEDIUM   **Confidence:** certain   **Category:** wrong-semantics
**Location:** `lib/data/context-links.ts:240–290`
PostgREST can't order by referenced-table columns through implicit join. So all rows are fetched and sorted in JS. No `.range()`. If a popular character has hundreds of back-links, all are fetched and sorted client-side per request. Same shape as F-50 (limit-50-no-order) — non-deterministic ordering when ambiguous + perf cost on large lists.
**Recommended fix shape:** add a `cursor` parameter; sort + limit via a Postgres RPC that can do the ordered join.

### F-166 — `deleteContextLink` returns `data?.length ?? 0`; doesn't surface DB errors
**Severity:** LOW   **Confidence:** certain   **Category:** silent-failure
**Location:** `lib/data/context-links.ts:82–94`
Returns `{ deletedCount, error }`. Caller can ignore `error`. A failed DELETE that errored returns `deletedCount: 0` — caller maps to 404 (link not found) when actually it was a backend error. Same shape as F-09 (collapses transient errors and missing-row).

---

## `lib/data/` — Tier A.5 summary

| Severity | Count |
|---|---|
| HIGH | **4** (F-143, F-152, F-154, F-156) |
| MEDIUM | 13 |
| LOW | 7 |
| **Total** | **24** |

### Themes that recur across `lib/data/`

1. **`.single()` used where `.maybeSingle()` is correct (H-01 violations).** F-144, F-148, F-155 — three update sites + arguably the createContextLink mismatch. Spec H-01 explicitly enumerates this as a hazard; the code drifted.

2. **Race conditions on integer ordering / sequence assignment (F-154).** Same shape as F-96 (nextSequence), F-99 (getOrCreateConversation), F-133 (usage-records). H-04 covers reorder atomicity; create-at-end shares the same race shape but isn't covered.

3. **Find-first without ORDER BY (F-143).** `getOrgId` returns arbitrary org for multi-org users. Same shape as F-46/47/50/54 in lib/llm.

4. **Leaf-ness derivation fails-closed on data anomalies (F-152, F-160).** When the layer_stack fetch returns null or has malformed indices, every node gets is_leaf=false — silently. UI affordances disappear without an error. Same shape as F-46 (broken back-link returns null instead of fallback).

5. **String-interpolated PostgREST filters (F-156).** Defence-in-depth gap; today UUID validation upstream blocks injection but the wrapper relies on it. Same shape as F-55 (metadata JSON scan).

6. **`Record<string, unknown>` for update fields (F-145, F-149).** Type safety lost at the data-layer boundary. Compile-time guard would catch typos; today only Postgres catches them.

7. **JS-side post-processing of unbounded result sets (F-165).** No `.range()` on listBackLinks. Same shape as F-50 (limit-50-no-order).

8. **Sequential parent-chain walks instead of recursive CTE/RPC (F-164).** Same shape as F-44 (fetchAncestors). N round-trips where 1 RPC would suffice. The `move_node` RPC exists for one parent-aware operation; no pattern for a `walk_ancestors` RPC.

9. **Client-side `updated_at` (F-157).** Cross-region clock skew matters for any time-ordered analysis.

### What the spec lens caught

- **F-152 / F-160 (H-15 violation by null-cascade).** Spec H-15 says leaf-ness is server-derived — but when the server can't derive it, returning false silently produces wrong UI gates. Pure spec-divergence: the spec invariant *"clients MUST consume this server-derived field"* assumes the server delivers a meaningful value; this code delivers a meaningfully-wrong one when its dependency fails.
- **F-154 (H-04 spirit).** H-04 mandates atomic reorder; create-at-end uses the same `MAX + 1` pattern with the same race shape. The hazard's *spirit* (atomic order assignment) covers this site; the *letter* doesn't.
- **F-144/F-148/F-155 (H-01 violations).** Three concrete hazard violations, each one straightforward to fix.

---

*Tier A.5 (`lib/data/`) audit complete. **Tier A is now complete (5 subsystems, 166 findings).** Continue to Tier B (`app/api/`, `lib/config/`, `lib/supabase/`, `lib/store/`, `lib/editor/`) on your go.*
