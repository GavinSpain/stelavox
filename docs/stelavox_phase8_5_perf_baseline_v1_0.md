# Phase 8.5 — Performance Baseline (v1.0)
**Date:** 2026-06-07
**Master HEAD:** `d9752b1`
**Scope:** measurement and analysis only — no fixes proposed in this pass

---

## Executive summary

Local single-user measurements show **two clear server-side bottlenecks** and **one client-side concern** worth tagging as candidates for follow-up work. None of them block V1 launch on functional grounds; they affect responsiveness and (more pressingly) **multi-user scaling**.

1. **`/api/documents/[id]/nodes` returns 2.7 MB for a 500k-word / 1556-node document**, takes ~2 seconds server-side, and is fetched 2× per route change in Director and document modes. The endpoint sends full prose JSON for every node when only structural fields are needed to render the tree. This is the single biggest server-side cost and the single biggest scaling risk.
2. **`/api/status/pending-attention` and `/api/status/document/[id]/pending-director`** are polled and add ~1 second to every cold page load. They're small (32-263 bytes) but they fire in every journey.
3. **The largest client JS chunk is 264 KB gzipped** and contains Tiptap + ProseMirror. This loads on any route that mounts the prose editor — i.e. the entire document mode. It's loaded once per session in production (cached after), so not catastrophic, but does mean a 264 KB transfer to read the first document.

**Multi-user constraints flagged in this baseline:**
- **Supabase Realtime** Pro plan caps at 500 concurrent connections. With 5-10 channels per active user the current architecture, the Pro plan saturates at **~50-100 concurrent users**.
- **Anthropic platform key** is shared across all non-BYOK users. Tier 1 / 2 input-token-per-minute limits become the binding constraint for Director and agent traffic far before Vercel / Supabase compute does.
- The 2.7 MB nodes endpoint becomes a bandwidth + DB load multiplier at scale; at 10k concurrent users it represents ~30-50 MB/s peak bandwidth and 1000s of concurrent Postgres queries.

**Order-of-magnitude scaling forecast** (full table in §6):

| User scale | Vercel plan | Supabase plan | Anthropic tier | Primary bottleneck |
|---|---|---|---|---|
| 1,000 users | Pro | **Team (Pro doesn't fit)** | Tier 2 | Realtime cap |
| 10,000 users | Pro (watch bandwidth) | Team + pooler + index work | Tier 3 or BYOK push | DB connection pool + Realtime |
| 100,000 users | Enterprise | Enterprise + self-host Realtime + read replicas | Custom or BYOK-mandatory | Architecture redesign required |

The 1k-user line is the most actionable. The current architecture does not fit Supabase Pro at 1k concurrent users — Team plan ($599/month) is required from launch if we expect more than ~50 simultaneous active sessions.

---

## 1. Methodology

**Fixture:** `scripts/seed-mega-doc.ts` creates a synthetic 500k-word manuscript in the Novel layer stack: 1 Book → 5 Acts → 50 Chapters → 250 Scenes → 1250 Beats × ~400 words. Total 1556 nodes. Prose is Lorem-ipsum-style — size, not content quality, is what matters. Seeded in 1.4 seconds via bulk-insert per layer; idempotent (re-runs need `--reset`).

**Harness:** `scripts/measure-perf.ts` drives headless Chromium via Playwright, signs in as `author@stelavox.local`, and runs 7 journeys. For each it records:

- Navigation timing (TTFB, DOMContentLoaded, full load) from the browser's Performance API
- Per-API-call timings (URL, method, status, total ms, response bytes) via Playwright's network interception
- Journey-specific markers (e.g. "first tree row visible at N ms", "editor mounted at N ms")

**Output:** JSON to `docs/perf/measure-local-<timestamp>.json` (kept untracked — they're empirical data, not specs).

**Splits captured:**
- **TTFB** = server work + network in / queue / cold-start. Pure server-side floor.
- **Total − TTFB** = browser work (parse, layout, paint, JS execution) + client-side fetches that happen after the initial response.
- **API call total_ms** = wall-clock for each `fetch` to an `/api/*` route. Includes both server time and round-trip network.
- **Response size** = bytes over wire (compressed when applicable).

**Bundle analysis:** production `npm run build` (Turbopack), then `du -bh` on every chunk under `.next/static/chunks/`, identified per-chunk dependencies by grepping for module-name strings. Gzip-encoded sizes via `gzip -c | wc -c`.

**Vercel surface probes:** `curl -w` for TTFB and total time against public routes (`/login`, `/signup`, `/forgot-password`). No authenticated cloud measurements — the local mega-doc isn't on cloud and creating one for Vercel would have been a separate work item outside this baseline.

**What this baseline does *not* do:**
- Lighthouse scores (would require auth flow setup against authenticated routes; the navigation timing data from Playwright gives equivalent signal for our purposes)
- Real load test (no k6 / Artillery run); multi-user numbers are analytical projections, not measurements
- Performance profiling (CPU flame graphs, GC, memory) — not in scope for an "order of magnitude" baseline

---

## 2. Per-journey local measurements

All numbers from the second run (selectors corrected) against `localhost:3000` with the mega-doc loaded. Local dev server in Next.js dev mode — TTFB includes Turbopack compilation cost on first hit per route. Production numbers from `npm run start` would be substantially lower; Vercel numbers are projected in §5.

### J1 — Cold dashboard load (post-login)

| Metric | Value |
|---|---|
| Total | 4,466 ms |
| Nav TTFB | 4,055 ms |
| Client portion (total − TTFB) | 411 ms |
| API calls | 1 (`/api/status/pending-attention`) |
| API response size | 263 bytes |

**Read:** ~90% of this is server TTFB in dev mode — Turbopack compiling the dashboard page on first hit. In production this drops to ~500-1000 ms. Client work (parse + render) is 411 ms which is fast.

**Classification:** `[SERVER]` dominated; expected to be `[NETWORK]` dominated in production after compile-once.

### J2 — Open mega document (cold tree fetch)

| Metric | Value |
|---|---|
| Total | 3,910 ms |
| Nav TTFB | 988 ms |
| API calls | 6 |
| Heaviest API | **`GET /api/documents/[id]/nodes` — 2.69 MB, 1,995 ms** |

**Per-API breakdown:**

| URL | Method | Status | Total ms | Size |
|---|---|---|---|---|
| `/api/status/pending-attention` | GET | 200 | 620 | ? |
| `/api/status/pending-attention` | GET | 200 | 759 | ? |
| `/api/status/pending-attention` | GET | 200 | 1363 | 263 B |
| `/api/status/document/[id]/pending-director` | GET | 200 | 1460 | 32 B |
| `/api/projects/[id]/context-nodes?limit=...` | GET | 200 | 1868 | 47 B |
| **`/api/documents/[id]/nodes`** | **GET** | **200** | **1995** | **2.69 MB** |

**Read:** Multiple parallel API calls — three of them are status polls (which are fast in payload but slow in dev mode) plus one heavy fetch. The nodes endpoint dominates: **2.7 MB of JSON is sent for a tree that only needs name + parent_id + order + status to render**. The prose JSON in each beat is ~3 KB per row × 1250 beats = ~3.75 MB compressed to ~2.7 MB over the wire. That prose is only needed when the user actually opens a beat.

**Classification:** `[SERVER]` for response build cost, `[NETWORK]` for the 2.7 MB transfer.

### J3 — Click a deep tree row (beat) → editor mount

| Metric | Value |
|---|---|
| Total | 3,372 ms |
| Nav TTFB | 813 ms |
| API calls | 6 |
| Key finding | `/api/documents/[id]/nodes` re-fetched (2.69 MB again) |

**Read:** Navigating from one beat to another **re-fetches the entire 2.7 MB nodes endpoint**. This is the duplicate-fetch issue: the page lays out fresh on navigation, the tree component mounts, it requests nodes, and the route handler returns the full payload again. If the user clicks 100 tree rows in a session that's 270 MB of redundant traffic on the cloud bill.

### J4 — Type in prose → autosave round-trip

| Metric | Value |
|---|---|
| Total | 2,317 ms |
| Keystrokes done at | 258 ms |
| Autosave completed at | 2,238 ms |
| API calls | 0 captured (PATCH happened in J3 capture window — see J3 table; ~427 ms) |

**Read:** ~2 seconds between keypress and autosave completion. The autosave debounce is the dominant cost (~1.5s). PATCH `/api/nodes/[id]` round-trip is ~400 ms on the server side.

**Classification:** `[CLIENT]` debounce + `[SERVER]` PATCH.

### J5 — Open Director panel

| Metric | Value |
|---|---|
| Total | 17,112 ms |
| Nav TTFB | 1,102 ms |
| API calls | 9 |
| Director-visible marker | 16,634 ms |

**Read:** This is anomalous. Director panel "becomes visible" at 16.6 seconds — far slower than every other journey. Likely causes: (a) Director conversation endpoint also waits on nodes, (b) selector waited on a state that only fires after a prompt is sent, (c) genuine slowness in panel mount. **Worth investigating separately** — this number is the most suspect in the dataset. Flagged as a follow-up candidate.

### J7 — POST /api/exports (DOCX, acceptance only)

| Metric | Value |
|---|---|
| Total | 244 ms |
| Status | 202 Accepted |

**Read:** Job creation is fast (the actual export render runs in `waitUntil` async and isn't measured here). 244 ms is good — the synchronous portion just validates + inserts the `export_jobs` row.

**Classification:** `[SERVER]` minimal; this is healthy.

### J8 — Sentence Focus toggle

| Metric | Value |
|---|---|
| Total | 3,883 ms (includes navigation to beat) |
| Toggle action done at | 304 ms |

**Read:** The toggle itself is fast — 300 ms includes dispatching the event and waiting one frame. Most of the 3.9 s wall-clock was the page navigation to position on a beat. Pure-client toggle cost is healthy.

**Classification:** `[CLIENT]` only; healthy.

---

## 3. Bundle composition (production)

Production build via `npm run build` (Turbopack). All sizes from `.next/static/chunks/` on disk.

| Chunk | Uncompressed | Gzipped | Identified contents |
|---|---|---|---|
| `0vmjluzry4u7~.js` | 981 KB | **264 KB** | Tiptap + ProseMirror (model/view/dropcursor) + app code |
| `11ml809_zz058.js` | 233 KB | 62 KB | Supabase SDK + Next.js dist runtime |
| `0n__~w80_gx-1.js` | 223 KB | 71 KB | react-dom |
| `0m1opr37a2rl0.js` | 138 KB | 38 KB | App-specific code (unidentified) |
| `0jltl103nimkm.js` | 136 KB | 41 KB | **docx + epub libraries** ← see note |
| `0dx542q394zj7.js` | 112 KB | ~30 KB | Likely cmdk + dialog primitives |
| `03~yq9q893hmn.js` | 110 KB | ~30 KB | Likely react-arborist |
| (smaller chunks) | ~400 KB | ~110 KB | Various |
| **Total all chunks** | **2,287 KB** | **648 KB** | |

**Observations:**

- The Tiptap + ProseMirror chunk at 264 KB gzipped is the single largest cost and unavoidable for the document mode. It's loaded once per session and then cached — production users only pay this on first visit per release.
- The `docx + epub` chunk (~41 KB gzipped) is **client-side payload for what should be server-only work**. Exports run in the Vercel function, not the browser, so these libraries shouldn't be in the client bundle. Likely a `import` somewhere that doesn't get tree-shaken because it's reached from a code path that runs on both server and client. Candidate for investigation; ~41 KB gzipped is small but it's pure waste.
- `react-dom` at 71 KB gzipped is React 19 (current). Nothing to do.
- The cmdk + dialog primitives (~30 KB gzipped) are a small marginal cost for the command palette landed in Phase 8.1.

**Total first-load JS budget for the document page (estimated):** ~500-550 KB gzipped, which is high. Industry-typical target is 200-300 KB gzipped initial. The Tiptap chunk is the dominant contributor.

**Per-route First Load JS** wasn't broken out by Turbopack's build output in the way the webpack builder used to summarise. The Turbopack production output omits the per-route size table — this is a known gap. Could be derived with `@next/bundle-analyzer` (not currently installed) if a more precise per-route breakdown is wanted in a follow-up.

---

## 4. Vercel surface probes

Public unauthenticated routes via `curl`.

| Route | Status | TTFB | Total |
|---|---|---|---|
| `/` (redirect to `/login`) | 307 | 720 ms | 730 ms |
| `/login` (cold) | 200 | 540 ms | 560 ms |
| `/signup` (cold) | 200 | 1,000 ms | 1,040 ms |
| `/forgot-password` (cold) | 200 | 1,030 ms | 1,070 ms |
| `/login` (warm 1) | 200 | 520 ms | 550 ms |
| `/login` (warm 2) | 200 | 1,140 ms | 1,280 ms |
| `/login` (warm 3) | 200 | 670 ms | 700 ms |

**Read:**
- Static / prerendered routes: 500-1000 ms TTFB. This includes network RTT from the measurement origin to Vercel's edge + the actual page render time.
- Dynamic (`/login` warm hit 2) hit a re-cold render at 1.14 s — Vercel function had spun down between probes ~2 minutes apart.
- Cold start adds ~300-500 ms over warm.

**Translated to authenticated routes:** local dev TTFB on warm routes ranged 800 ms - 1.1 s. Vercel production should sit somewhere similar — possibly faster on the static portion (Next.js production build is much tighter than dev), possibly slower on dynamic API routes that hit Supabase (each adds network RTT to Supabase Australia → wherever your local user sits).

---

## 5. Client / server / network split summary

| Journey | Client | Server | Network | Dominant |
|---|---|---|---|---|
| J1 cold dashboard | ~400 ms (parse+render) | ~4,000 ms (dev compile) | minimal | **`[SERVER]` (dev artifact)** |
| J2 open mega doc | ~1,900 ms (tree render + DOM build for 1556 rows) | ~2,000 ms (nodes endpoint build) | 2.7 MB transfer | **`[SERVER]` + `[NETWORK]`** |
| J3 click tree row | ~1,500 ms (editor mount) | ~800 ms × 2 (nodes refetch) | 2.7 MB again | **`[NETWORK]`** (redundant fetch) |
| J4 autosave | ~1,800 ms (debounce + Tiptap) | ~400 ms (PATCH) | small | **`[CLIENT]`** (debounce by design) |
| J5 Director panel | unknown (anomalous) | unknown | unknown | **needs investigation** |
| J7 POST export | minimal | ~250 ms | minimal | healthy |
| J8 Sentence Focus toggle | ~300 ms (plugin apply) | none | none | healthy |

---

## 6. Multi-user projection at 1k / 10k / 100k user scales

**Method.** From single-user numbers I estimate the resource demand per active user-second (DB connections, Realtime channels, function invocations, Anthropic tokens), then multiply against platform caps for each plan tier and find the lowest plan that fits. **These are order-of-magnitude — within 2× either way.** Real load tests would tighten the numbers.

### 6.1 Demand per active user

| Resource | Estimate per active user | Source |
|---|---|---|
| Realtime channels | 5-10 concurrent | Status indicator + tree + Director + per-node + scheduler subscriptions |
| DB connections (sustained) | ~1 (via pooler) | Each route handler uses a brief connection then releases |
| DB query rate (peak) | ~5 queries/sec during heavy navigation | Tree fetch + status polls + autosave PATCHes |
| Vercel function invocations | ~10 /minute | Steady-state during writing; spikes on doc open |
| Bandwidth | ~5-15 MB / 5-min session | Dominated by nodes fetch (2.7 MB on big docs); typically ~1 MB on small docs |
| Anthropic input tokens | 0-500K/minute peak | Director conversation + agent operations; mostly idle |
| Anthropic RPM | 0-2 /minute peak | Director call + agent step |

### 6.2 Platform caps (sourced June 2026)

| Platform | Free / Hobby | Pro ($20-25 /mo) | Team / Enterprise |
|---|---|---|---|
| **Vercel** function concurrency | low | ~30,000 concurrent invocations | Enterprise: 100,000+ |
| Vercel bandwidth | 100 GB | 1 TB included; $0.15 / extra GB | Enterprise custom |
| Vercel compute time | low | 40 hrs/month; $5 / extra hour | Enterprise custom |
| **Supabase** Realtime peak connections | 200 | **500** (hard cap, $10 / extra 1000) | Team: custom, Enterprise: custom |
| Supabase DB direct connections | 60 | 60 (Pro) | scales with compute size |
| Supabase pooler connections | ~200 | ~3000 | scales |
| Supabase DB included | 500 MB | 8 GB | Team / Enterprise larger |
| **Anthropic** Tier 1 Sonnet ITPM | n/a | 500K input tokens/min, ~50 RPM | Tier 4+ / Custom |
| Anthropic Tier 2 | n/a | 1M ITPM, higher RPM | |

### 6.3 Projection at three scales

Assumption: "1,000 users" means 1,000 registered users with ~10% active at any moment = 100 concurrent active sessions. Same multiplier for 10k (1,000 concurrent) and 100k (10,000 concurrent).

#### 1,000 users (~100 concurrent active)

| Resource | Demand | Plan that fits |
|---|---|---|
| Vercel function concurrency | 100 × 10 = 1,000 invocations/min | **Pro** ✅ (well under 30k cap) |
| Vercel bandwidth | 100 × 15 MB/session × 30 sessions/day = 45 GB/day = 1.4 TB/month | **Pro** ⚠️ (over 1 TB; ~$60/month overage) |
| Supabase Realtime channels | 100 × 7 = **700 concurrent** | **Pro DOES NOT FIT** (cap 500). Need Team or Enterprise. |
| Supabase DB query rate | 100 × 5 = 500 QPS | **Pro** ✅ (with pooler) |
| Anthropic shared platform key | Variable; assume 5% Director usage = 5 concurrent calls | **Tier 2** recommended; Tier 1 fits but risks 429 collisions |

**Bottom line at 1k users:** Vercel Pro + **Supabase Team ($599/month)** + Anthropic Tier 2 (auto-progression with usage credit). Total monthly platform cost ~$650-700.

**Workaround for staying on Pro:** Reduce per-user Realtime channel count from 5-10 to 1-2 (consolidate the status indicator + tree + Director + scheduler subscriptions into a single multiplexed channel per user). With 2 channels/user, 100 concurrent = 200 channels — fits Pro 500. That's an architectural change, not a config tweak.

#### 10,000 users (~1,000 concurrent active)

| Resource | Demand | Plan that fits |
|---|---|---|
| Vercel function concurrency | 1,000 × 10 = 10,000 invocations/min | **Pro** ✅ |
| Vercel bandwidth | 10,000 × 15 MB × 30 = 4.5 TB/day = **135 TB/month** | **Pro overage ~$20k/month** — Enterprise becomes cost-competitive |
| Supabase Realtime channels | 1,000 × 7 = **7,000 concurrent** | **Team with custom cap negotiation** required |
| Supabase DB query rate | 1,000 × 5 = 5,000 QPS | **Team or Enterprise** + read replicas |
| DB connection pool | sustained ~1,000 + spikes | Team with larger compute |
| Anthropic | sustained ~10-50 concurrent agent calls | **Tier 3 or Tier 4** required; consider BYOK-mandatory for heavy users |

**Bottom line at 10k users:** Architectural work required before this scale lands. Top items:
1. **Slim down `/api/documents/[id]/nodes`** — return only structural columns; lazy-load prose. Cuts bandwidth ~80%.
2. **Multiplex Realtime channels** to 1-2 per user.
3. **Read replicas** for the read-heavy nodes endpoint.
4. **Move Anthropic usage to BYOK-mandatory** above a usage threshold; platform key acts as a free-tier sampler.

#### 100,000 users (~10,000 concurrent active)

At this scale every assumption above breaks. The system needs:
- Vercel Enterprise tier + edge caching for static reads
- Supabase Enterprise tier or self-hosted Postgres + self-hosted Realtime infrastructure
- Anthropic Tier 4+ or Custom with negotiated rate limits
- Read replicas, sharding for hot tables (`nodes` is the biggest hot table — 1556 rows × 100k users = 156M rows when actively in use)
- Background job queue offload of any non-interactive operation (export, Director iterations, agent jobs) — V1.x-B.2 WFQ scheduler already covers this for agents

The right framing for this number: **100k users is a different product**. It's not reachable by tuning the current architecture; it requires the architectural changes from the 10k-user bullet list plus deeper structural work.

### 6.4 Bottleneck classification (the answer to the user's framing)

| Bottleneck | Side | Single-user impact | Multi-user impact |
|---|---|---|---|
| `/api/documents/[id]/nodes` 2.7 MB payload | **SERVER + NETWORK** | 2s wait on doc open | Bandwidth and DB query cost both scale linearly |
| `/api/documents/[id]/nodes` redundant re-fetch on navigation | **NETWORK** | duplicate 2.7 MB transfer per route change | Compounds with above |
| Realtime channel count per user | **SERVER (Supabase cap)** | invisible to single user | **Saturates Pro cap at ~50-100 users**; primary scaling block |
| Anthropic shared platform key | **SERVER (rate limit)** | invisible while alone | Single rate-limit bucket shared across all non-BYOK users; collisions begin at ~10-20 simultaneous Director calls |
| Tiptap + ProseMirror bundle 264 KB gzipped | **CLIENT** | first-paint on document page | Each user pays once per release |
| `docx + epub` in client bundle (~41 KB gzipped) | **CLIENT** | small waste | Pure waste at any scale |
| Dev-mode cold compile TTFB (4s on J1) | **(dev only)** | annoyance for developers | not applicable in production |
| J5 Director panel 17s visibility | **UNKNOWN** | possibly real, possibly measurement artefact | needs separate investigation before classification |

---

## 7. Suggested budgets

Based on what we measured, here's a first-cut V1 budget. Numbers are targets, not commitments — actual tracking would need CI hookup or a manual quarterly check.

| Surface | Budget | Current (local prod) | Status |
|---|---|---|---|
| Initial JS payload, gzipped | < 350 KB per route | ~500-550 KB document page | ⚠️ over by ~50% |
| `/api/documents/[id]/nodes` response | < 500 KB per 1000-node doc | 2.7 MB on 1556-node doc | ❌ over by ~5× |
| `/api/documents/[id]/nodes` server time | < 500 ms p50 | 2,000 ms on 1556-node doc | ❌ over |
| Cold page TTFB (production) | < 1,000 ms p50 | unknown — projected 500-1000 ms | likely ✅ |
| Warm page TTFB (production) | < 500 ms p50 | unknown — projected 500-1000 ms | likely ⚠️ |
| Autosave PATCH round-trip | < 1,000 ms p50 | 427 ms | ✅ |
| Export job creation (POST `/api/exports`) | < 500 ms | 244 ms | ✅ |
| Sentence Focus toggle | < 200 ms | 304 ms | ⚠️ close |
| Realtime channels per user | ≤ 2 | 5-10 | ❌ over |
| Vercel function concurrency p99 | < 50% of plan cap | unknown | n/a single-user |

---

## 8. Prioritised candidate list for follow-up

If a future Phase 8.5b ships fixes, this is the recommended ordering — biggest payoff first.

1. **`/api/documents/[id]/nodes` slim-down** (HIGH IMPACT). Exclude `prose` and `summary` from the default tree fetch; add a `?include=prose,summary` opt-in for callers that need it. Drops 2.7 MB → estimated 200-400 KB on mega-doc. Cuts bandwidth ~85%, server time ~70%, every subsequent navigation cost similarly. Mostly a route-handler change; client tree code already only needs structural columns. **Estimated effort: 1 session.**

2. **`/api/documents/[id]/nodes` no-refetch on internal navigation** (HIGH IMPACT). Currently every route change refetches the entire tree. Could be cached client-side (per documentId) and only refetched on a Realtime invalidation signal. Halves or eliminates the duplicate fetch we saw in J3 and J5. **Estimated effort: 1 session.**

3. **Realtime channel multiplexing** (HIGH IMPACT FOR SCALE). Consolidate the 5-10 per-user channels into 1-2. Allows Supabase Pro to fit 1k users instead of saturating at ~50. **Estimated effort: 2-3 sessions; touches status indicator, tree subscription, Director, scheduler.**

4. **Investigate J5 Director panel 17s visibility** (UNKNOWN IMPACT). Either it's real (and we need to find the cost) or it's a measurement artefact (and the data is misleading). **Estimated effort: half session.**

5. **Status-poll consolidation** (MEDIUM IMPACT). `/api/status/pending-attention` + `/api/status/document/[id]/pending-director` could be a single response. They're small but they fire on every cold load. **Estimated effort: half session.**

6. **`docx + epub` out of client bundle** (LOW IMPACT, EASY). Find the import that pulls them into the client bundle; mark with `'use server'` or restructure. Saves 41 KB gzipped from first load. **Estimated effort: 30 minutes if the import is obvious; 1 session if structural.**

7. **Per-route bundle analysis with `@next/bundle-analyzer`** (LOW IMPACT, EASY). Get the per-route First Load JS table that Turbopack omits. Useful for prioritising future trims. **Estimated effort: 30 minutes (install + one analysis run).**

8. **Document-mode initial-load Lighthouse run** (LOW IMPACT, EASY). Validate LCP / INP / CLS against Core Web Vitals targets. Requires a logged-in flow which is the only friction. **Estimated effort: 1 session.**

9. **Per-route cold-start hardening** (CONDITIONAL). If Vercel cold-start TTFB stays above 1s in production measurements after item 1-2 ship, consider edge caching for the dashboard route or moving some dynamic logic into ISR. **Estimated effort: ladder; only if measured cold-start is genuinely hurting users.**

---

## Appendix A — Raw JSON artefacts

Located in `docs/perf/`:

- `measure-local-2026-06-07T13-28-07-687Z.json` — full per-journey results (the second run; corrected selectors)
- `measure-local-2026-06-07T13-26-01-867Z.json` — earlier run with broken J3 / J5 selectors (kept for traceability of the 32s "detail panel visible" artefact)

The JSON is gitignored; these files exist on disk on the machine that ran the measurements. Move under version control if the report needs them inline.

## Appendix B — Sources

Vercel plan limits & pricing:
- [Vercel Limits](https://vercel.com/docs/limits)
- [Vercel Pricing](https://vercel.com/pricing)
- [Vercel Functions Limitations](https://vercel.com/docs/functions/limitations)
- [Vercel Pricing Plans and Hidden Costs Explained (2026)](https://schematichq.com/blog/vercel-pricing)

Supabase Realtime + Pro plan limits:
- [Supabase Realtime Limits](https://supabase.com/docs/guides/realtime/limits)
- [Supabase Realtime Concurrent Peak Connections Quota](https://supabase.com/docs/guides/troubleshooting/realtime-concurrent-peak-connections-quota-jdDqcp)
- [Supabase Pricing](https://supabase.com/pricing)
- [Supabase Pricing: Real Costs at 10K-100K Users](https://designrevision.com/blog/supabase-pricing)

Anthropic rate limits & tier progression:
- [Claude API Rate Limits](https://platform.claude.com/docs/en/api/rate-limits)
- [Claude API Quota Tiers Explained 2026](https://www.aifreeapi.com/en/posts/claude-api-quota-tiers-limits)
- [AI API Rate Limits 2026](https://devtk.ai/en/blog/ai-api-rate-limits-comparison-2026/)

---

**Changelog**

**v1.0 — 2026-06-07** Initial baseline. Measurement-and-report only; no fixes. Master HEAD `d9752b1`. Local run against Next.js dev mode + 500k-word seeded mega-doc; production-build bundle analysis; Vercel public surface probes; multi-user projection at 1k / 10k / 100k scales against Vercel / Supabase / Anthropic plan tiers. Two `[SERVER + NETWORK]` bottlenecks identified (`/api/documents/[id]/nodes` payload + redundant fetch), one `[SERVER (Supabase cap)]` scaling block (Realtime channel count per user), one `[CLIENT]` minor (docx + epub in client bundle). Nine prioritised follow-ups documented; J5 Director panel anomaly flagged for separate investigation before classification.
