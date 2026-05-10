# Error-handling conventions

**Origin:** round-3 audit Theme T-1 (silent failure on transport / network / SDK errors). 26+ sites in the audit returned silent fallbacks (Promise.resolve, empty arrays, mistyped defaults) instead of surfacing the failure to the user. This doc codifies the convention applied to all Phase 3 batches and going-forward work.

## The rule, in one sentence

**A failure must produce either (a) a thrown exception, (b) a user-visible toast, or (c) a documented `// silent-on-purpose: <reason>` comment. Never a silent `Promise.resolve(undefined)` / empty array / NaN / wrong-type default.**

---

## Where each surface applies

| Layer | Failure mode | Surface |
|---|---|---|
| `lib/data/*` wrapper | Supabase error | Return `{ data, error }` with `error` populated. Never swallow. |
| `lib/llm/*` provider | Stream chunk error / SDK throw | **Throw** with a message naming the SDK error type. Already-yielded chunks remain valid; consumer's try/catch sees the throw. (B3.2 chose throw over a structured error chunk so the LLMStreamChunk surface stays minimal.) |
| `lib/director/*` server-side helper | DB error / SDK error | Throw with a message naming the operation. The route's try/catch turns it into 500. |
| API route (`app/api/*`) | Validation / lookup failure | Return a structured error response (`err.notFound()`, `err.internal()`). Never 200 with null body. |
| Client `lib/*` (e.g. `streamMessage`, `streamSynthesise`) | `fetch` non-OK / parse error | **Reject the Promise.** Don't resolve quietly. The caller decides toast / retry. |
| React component | Action failed (autosave, click handler, fetch) | Call `useToast().show(message, 'error')`. Plus `console.error()` for the dev console. |
| Client real-time hook (`useAgentJobsRealtime`, `useNodesRealtime`) | WebSocket error / disconnect | At minimum: `console.error('[realtime] …')`. Ideally: re-subscribe + toast on persistent failure. |

## What "silent-on-purpose" means

Some failures are genuinely fine to ignore:

- A network beacon for analytics that we don't care if it dropped
- A best-effort cache invalidation where the next read will recompute anyway
- A teardown-time cleanup whose target may already be gone

Mark these explicitly:

```ts
// silent-on-purpose: cache invalidation; next read will recompute on miss
await fetch('/api/cache/invalidate', { method: 'POST' }).catch(() => {})
```

The comment is the contract. Reviewers should reject silent catches that lack the comment.

## Anti-patterns

```ts
// ✗ silent-on-failure
fetch(url).then(r => r.json()).catch(() => null)

// ✗ silent fallback to "no data"
const { data } = await supabase.from('x').select()
return data ?? []  // hides errors as "no rows"

// ✗ Promise.resolve on failure
.catch(err => { console.error(err); return Promise.resolve() })

// ✗ wrong-type default
const budget = await getConfigInt(key) ?? 0  // pre-B2.1 silent garbage

// ✗ swallowed in stream loop
for await (const chunk of stream) {
  if (chunk.type === 'error') break  // user sees truncated output, no error
}
```

## Correct patterns

```ts
// ✓ throw with naming context
if (!data) throw new Error(`getOrgIdForUser: user ${email} has no organisation_members row`)

// ✓ user-visible toast on action failure
const res = await fetch('/api/x')
if (!res.ok) {
  toast.show(`Save failed: ${res.status}`, 'error')
  console.error('[save]', await res.text())
  return  // caller keeps existing state
}

// ✓ stream provider throws on error event (B3.2)
case 'error': {
  throw new Error(`Anthropic stream error (${type}): ${message}`)
}

// ✓ silent-on-purpose
// silent-on-purpose: best-effort log dispatch; loss is acceptable
fetch('/api/log', { method: 'POST', body: JSON.stringify(event) }).catch(() => {})
```

## Phase 3 batch references

- B3.2 — anthropic stream error chunks
- B3.3 — `streamMessage` / `streamSynthesise` Promise rejection
- B3.4 — editor-store autosave toast
- B3.5 — `useAgentJobsRealtime` WebSocket error handler
- B3.6 — component-layer fetch silences (10 sites)
