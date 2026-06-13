# Stelavox — V1 Deliverables Register
## Version 1.0

> **Tier-A planning artefact.** Produced by the Phase 9 pre-launch backlog review (2026-06-10). This is the single canonical list of every deferred / queued / tagged item across the project — it supersedes the scattered V2/V3 markers in Tier-A specs, per-phase memos, and the TA §11 Backlog row. Items not in this register don't exist. All 121 items were reviewed and bucket-assigned by the author in one session; product-scope locks made during the review are recorded in the Summary section.
>
> **Versioning note:** version lives in the filename per the document naming convention. Bucket changes and new items are recorded in the Changelog at the bottom; the internal register changelog (v1.0–v2.1) documents the review session itself.

**Created 2026-06-10 during Phase 9 reset.** Single source of truth for everything that hasn't been done yet.

## Buckets

- **V1** — must ship before launch. Becomes work in Phase 10 / 11 / 12 / 13 / or a new mini-phase.
- **V1.x** — first post-launch wave. Small, additive, time-sensitive. Done within 1–3 months of launch.
- **V2+** — substantial. Revisit when V1 traffic + user data inform the decision.
- **V3** — soft-drop; recorded so we don't lose the idea but not actively planned. Promote to V2+ if the case ever lands.

## Categories

1. **Agent System** — Director, agent profiles, prompts, workflows, briefs, scheduler, throttle, BYOK routing
2. **Document Operations** — nodes, layer stacks, tree, prose editor, focus mode, autosave, versioning, locking
3. **Author UX** — settings, account, dashboard, project page, export, command palette, keyboard shortcuts, onboarding, a11y, empty states
4. **Brand + Design System** — Inviolables, typography, tokens, motion, wireframes
5. **Data + Infra** — Postgres, migrations, RLS, realtime, Supabase, Vault, performance, bundle
6. **LLM Cost Model** — pricing, plans, traffic engineering, batched_24h, BYOK plan-tier, prompt caching
7. **Failure UX + Observability** — failure-class surfaces, admin dashboard, synthetic probes, monitoring, alerting, telemetry, audit logs
8. **Multi-tenancy + Accounts** — orgs, members, billing, signup, auth
9. **Deployment + Operations** — Vercel, environments, secrets, DR, runbooks
10. **Documentation + Meta** — user docs, dev docs, spec maintenance, changelog discipline
11. **Security** — RLS, auth, BYOK key handling, secrets, injection, audit, abuse, rate-limit

## Per-item format

```
#### DR-NNN — Short title
- Origin: <source pointer>
- Description: <1-3 lines what it is>
- Effort: S (≤1 session) / M (1 phase) / L (multi-phase)  ·  V1-risk: None / Low / Medium / High
- Proposed bucket: V1 / V1.x / V2+ / V3
- Rationale: <one line>
```

## Population status

- [x] Director Architecture v2.6 §16.3 — V2 backlog (10 items)
- [x] Director Architecture v2.6 §16.4 — calibration questions (7 items)
- [x] TA v2.10 §11 Backlog row (per phase plan memory)
- [x] V1.x deferrals listed in phase plan memory
- [x] Document operations / Phase 3a
- [x] Developer documentation backlog
- [x] Round-3 audit residual — captured at theme-level (14 themes) + named HIGH residuals (~10 items). 207 individual findings cited via theme.
- [x] CLAUDE.md changelog — major reassignments captured via per-phase memos
- [x] Tier-A spec sweep — backlog mentions captured via Director Architecture §16.3/§16.4 + TA §11 + Phase 14
- [x] Per-phase shipped memos — V1.x-A through V1.x-F + Phase 6/7/8 captured
- [x] Open SUs — SU-J11 family, SU-24, SU-22 captured in-band

---

## 1. Agent System

> **✅ CATEGORY LOCKED 2026-06-10.** Decisions ratified by the author:
>
> | Item | Locked bucket |
> |---|---|
> | DR-001..DR-007, DR-009, DR-010 | V2+ |
> | DR-008 extended-thinking UX | V1.x |
> | DR-011..DR-014, DR-016, DR-017 (calibration) | V1.x — tuning waits for traffic; **observability of these metrics must be V1** (see DR-121) |
> | DR-015 top-up flow | **V2+** (changed from proposed V1/V1.x) |
> | DR-018 refine_accept probe | V2+ |
> | DR-019 push notifications | V1.x |
> | DR-020 FailureToast/Banner adoption | **V1** |
> | DR-021 admin column migration | V1.x |
> | DR-022 30-day retention | V1.x |
> | DR-023 cache analytics | V1.x |
> | DR-024 Research Intermediary | V2+ |
>
> **Commercial model locked alongside DR-015/DR-070:** Stripe is V1 — every plan including BYOK pays a platform cost through Stripe. Credit exhaustion never locks the user out of *writing*; it locks Director/agent dispatch only. Escape paths are upgrade-to-next-plan or convert-to-BYOK-plan. Top-up is therefore not needed for V1 and moves to V2+. (Product Spec amendment required in Phase 9.D propagation — the "never locked out of writing" guarantee should be stated explicitly.)

### 1.1 Director — V2 architecture extensions

#### DR-001 — Multi-document Director (series-level)
- Origin: Director Architecture v2.6 §16.3
- Description: Director acts across all documents in a project, not per-document. Conversation memory + permission model expand.
- Effort: L  ·  V1-risk: None
- Proposed bucket: V2+
- Rationale: Per-doc scope sufficient for V1 launch test. Multi-doc is a substantive re-architecture of conversation context + RLS.

#### DR-002 — Per-model prompt variants
- Origin: Director Architecture v2.6 §16.3
- Description: Distinct system prompts per model tier (Haiku / Sonnet / Opus) instead of one shared prompt.
- Effort: M  ·  V1-risk: None
- Proposed bucket: V2+
- Rationale: Shared prompt is working at V1 scale per launch-standard test. Per-model variants need empirical signal from real users to calibrate.

#### DR-003 — QC job types (review_node, consistency_check, evaluate_against_goal)
- Origin: Director Architecture v2.6 §16.3 + Agent Profile Library v1.4 §3.10
- Description: Three new agent job operation types covering quality control — review a node against criteria, check cross-node consistency, evaluate output against goal. Agent profiles already drafted in library.
- Effort: M  ·  V1-risk: Low
- Proposed bucket: V2+
- Rationale: Author can manually review in V1 launch test; automated QC adds value but isn't required to write the novel. Agent profiles drafted suggest fast follow-up but won't move launch.

#### DR-004 — Supervisory agent for behavioural drift / cost anomaly detection
- Origin: Director Architecture v2.6 §16.3
- Description: Background agent that monitors Director behaviour patterns + cost trends, flags anomalies before they hit budget caps.
- Effort: L  ·  V1-risk: Low
- Proposed bucket: V2+
- Rationale: Admin dashboard (V1.x-E) covers the manual observability path. Supervisory automation needs traffic patterns to define "drift" — wait for V1 data.

#### DR-005 — Per-workflow rollback; per-Brief snapshot/restore
- Origin: Director Architecture v2.6 §16.3
- Description: Restore a workflow's outputs to pre-execution state; snapshot a Brief and restore later. Granularity beyond per-node restore (Phase 6).
- Effort: L  ·  V1-risk: Low
- Proposed bucket: V2+
- Rationale: Per-node restore covers the main "I want this back" case. Per-workflow / per-Brief is a wider-grained safety net that complicates state-machine semantics.

#### DR-006 — Cross-conversation memory beyond per-document
- Origin: Director Architecture v2.6 §16.3
- Description: Director remembers things across separate conversation threads, not just within one. Pairs with DR-001 multi-doc.
- Effort: L  ·  V1-risk: None
- Proposed bucket: V2+
- Rationale: Brief is canonical durable memory in V1; conversation is rolling window. Cross-conversation requires a deeper memory architecture (vector store, summaries, recall).

#### DR-007 — Director config version lifecycle (draft / beta / production / deprecated)
- Origin: Director Architecture v2.6 §16.3 + TA §8.6
- Description: Same lifecycle agent_profiles will get (SU-24 V2). Config rows tagged with status; only one production at a time; A/B testing slot.
- Effort: M  ·  V1-risk: Low
- Proposed bucket: V2+
- Rationale: V1 ships with manual config bumps via migrations. Lifecycle is the right shape post-launch when iteration on the system prompt accelerates.

#### DR-008 — Extended-thinking UX surfacing
- Origin: Director Architecture v2.6 §16.3
- Description: Visible UI affordance when Director is using Anthropic's extended_thinking mode — the model takes longer but produces deeper output. Currently silent.
- Effort: S  ·  V1-risk: Low
- Proposed bucket: V1.x
- Rationale: Author noticing "why is Director slow?" without knowing it's thinking-mode is a UX gap that will surface fast in V1 traffic. Small implementation.

#### DR-009 — Reflective completion acknowledgement
- Origin: Director Architecture v2.6 §16.3 + V1.x-D close-out
- Description: Director ends a turn with a brief reflective ack ("I expanded act 2; here's what I noticed…") instead of just the mechanical line that ships today.
- Effort: M  ·  V1-risk: Low
- Proposed bucket: V2+
- Rationale: Mechanical ack works. Reflective requires prompt engineering + the LLM cost of the reflection token. Defer until V1 data shows real users want it.

#### DR-010 — MCP integration for third-party tools
- Origin: Director Architecture v2.6 §16.3
- Description: Director can call external MCP servers (databases, web fetch, third-party services) via the standard MCP protocol.
- Effort: L  ·  V1-risk: None
- Proposed bucket: V2+
- Rationale: V1 stays in-platform. MCP opens a large security + abuse surface that needs its own threat model. Genuine V2 work.

### 1.2 Scheduler / throttle calibration (not architectural)

#### DR-011 — WFQ class weights tuning (initial 50/25/20/5)
- Origin: Director Architecture v2.6 §16.4
- Description: The four-class weighting ratios were chosen by intuition. Real V1 traffic + admin dashboard data tells us if the split holds.
- Effort: S  ·  V1-risk: None
- Proposed bucket: V1.x
- Rationale: Dashboard data needed first; tuning is a config change (`throttle.class_weights`).

#### DR-012 — Class 1 reserved-slot count
- Origin: Director Architecture v2.6 §16.4
- Description: Currently 3 reserved + 5 max. Tune from observed Director-iteration concurrency.
- Effort: S  ·  V1-risk: None
- Proposed bucket: V1.x
- Rationale: Same as DR-011. Config change.

#### DR-013 — Per-user bucket refill rate
- Origin: Director Architecture v2.6 §16.4
- Description: Token bucket refill rate per user. Defaults from V1.x-B.2 may be too generous or too tight.
- Effort: S  ·  V1-risk: None
- Proposed bucket: V1.x
- Rationale: Same as DR-011.

#### DR-014 — Director conversation window default (turns)
- Origin: Director Architecture v2.6 §16.4
- Description: Rolling-window size for conversation context. Default 10 turns; correct value depends on how long real conversations get.
- Effort: S  ·  V1-risk: None
- Proposed bucket: V1.x
- Rationale: Cost vs context-utility tradeoff; only measurable from real traffic.

#### DR-015 — Top-up granularity + pricing
- Origin: Director Architecture v2.6 §16.4 + Product Spec §3
- Description: When a user exhausts allocated credits, what increments can they top up? $5? $10? Custom?
- Effort: M  ·  V1-risk: None (post-decision)
- Bucket: **V2+ — LOCKED 2026-06-10**
- Rationale: Author decision: exhaustion locks Director only, never writing; escape paths are upgrade-to-next-plan or convert-to-BYOK (both available V1 via Stripe, DR-070). Top-up is a convenience layer on top of that, not a requirement.

#### DR-016 — Period-start vs live recalc on credit-rate changes
- Origin: Director Architecture v2.6 §16.4
- Description: When platform pricing rates change mid-period, do we honour the locked period-start rate, or live-recalc against the new rate?
- Effort: M  ·  V1-risk: Low
- Proposed bucket: V1.x
- Rationale: V1 ships with stable rates; this only matters when we change them. Defer until first rate change is on the table.

#### DR-017 — Synthetic probe cadence
- Origin: Director Architecture v2.6 §16.4 + V1.x-F
- Description: pg_cron daily probes shipped V1.x-F. Tune cadence (daily? hourly? per-event?) based on what signal the probes actually surface.
- Effort: S  ·  V1-risk: None
- Proposed bucket: V1.x
- Rationale: Daily is the current default and produces signal. Tuning is a pg_cron schedule change.

### 1.3 V1.x deferrals to Backlog (per phase plan memory)

#### DR-018 — refine_accept accept-path probe exercise
- Origin: V1.x-F SHIPPED memo
- Description: The refine_accept synthetic probe currently exercises LLM-call + parse + result-persistence but NOT the accept_agent_job call (cleanup would need to roll back the version-bump + node_versions row insert).
- Effort: M  ·  V1-risk: Low
- Proposed bucket: V2+
- Rationale: Half the probe is real; the missing half doesn't change V1 launch viability. Full coverage requires probe-time rollback machinery.

#### DR-019 — Push-model failure notifications
- Origin: V1.x-E SHIPPED memo
- Description: Capacity alerts in V1.x-E evaluate pull-style at /admin page-load. Push notifications (email / Slack / etc.) when thresholds cross would close the response-time gap.
- Effort: M  ·  V1-risk: Low
- Proposed bucket: V1.x
- Rationale: V1 launch is one user (the author). Push notifications matter when there are paying users to protect. Soon-after-launch work.

#### DR-020 — FailureToast / FailureBanner per-surface adoption ✅ SHIPPED 2026-06-13
- Origin: V1.x-F SHIPPED memo
- Description: V1.x-F shipped the components as pure-render substrate. Per-surface adoption (AgentTab, SchedulerPanel, AppShell global) was deliberately deferred — existing working error paths untouched.
- Effort: M  ·  V1-risk: Medium
- Bucket: **V1 — SHIPPED Phase 9.E (E.1)**
- Rationale: Failure UX is a core part of "would my real user feel safe using this" — the author launch test will exercise failure modes. Worth landing the per-surface mounts before launch.
- **Closeout:** New `FailureSurface` wrapper classifies an HTTP status → failure class (`lib/ui/classifyFailure.ts`) and renders the matching V1.x-F `FailureToast` (A/C) or `FailureBanner` (D/E), reading admin-tunable copy from `/api/failure-messages` (H-12). Adopted in `AgentTab` (6 setError→setFailure sites) and `SchedulerPanel`. "AppShell global" is satisfied by the existing RealtimeBadge global indicator — a redundant global failure bus was judged out of scope. 423 (lock) and 422 injection_blocked are deliberately excluded by the classifier so the dedicated surfaces (DR-046 ConflictBanner / DR-050 SecurityWarningBanner) own them without double-rendering.

#### DR-021 — Admin user-base migration to users.is_platform_admin column
- Origin: V1.x-E SHIPPED memo
- Description: Admin auth currently uses `PLATFORM_ADMIN_EMAILS` env-var allowlist. Migrate to a `users.is_platform_admin` column once a real admin user base exists.
- Effort: S  ·  V1-risk: None
- Proposed bucket: V1.x
- Rationale: Allowlist works for V1's single-author launch. Column migration matters once there's a team operating the platform.

#### DR-022 — 30-day rate-limit retention bump
- Origin: V1.x-F SHIPPED memo (D-F3-1 deferral)
- Description: anthropic_rate_limit_samples currently retained 7 days. Bump to 30 if regression-spotting needs longer windows.
- Effort: S  ·  V1-risk: None
- Proposed bucket: V1.x
- Rationale: Decision lever is "does 7 days hide a real regression?" — only V1 traffic answers this.

### 1.4 TA V2 backlog items (per phase plan memory)

#### DR-023 — Cache analytics in usage dashboard
- Origin: TA V2 backlog
- Description: Prompt-cache hit-rate visualisation in /admin dashboard (currently invisible). Helps tune cache breakpoints.
- Effort: M  ·  V1-risk: None
- Proposed bucket: V1.x
- Rationale: Caching is shipped and working; the analytics layer is a small admin enhancement.

#### DR-024 — Research Intermediary implementation
- Origin: TA V2 backlog
- Description: Mediator agent between Director and external research / web-fetch — adds a controlled middle layer.
- Effort: L  ·  V1-risk: None
- Proposed bucket: V2+
- Rationale: V1 has no external-research feature. Tied to DR-010 MCP integration scope.

---

## 2. Document Operations

> **✅ CATEGORY LOCKED 2026-06-10** (three items resolved in follow-up discussion, see below):
>
> | Item | Locked bucket |
> |---|---|
> | DR-025..DR-030 (Phase 14 cluster) | V2+ |
> | DR-031..DR-035 (Phase 3a doc-ops chain) | V2+ |
> | DR-036 JSON import | V2+ |
> | DR-037 PDF export | V2+ |
> | DR-038 KDP submission | V3 |
> | DR-039 attachment bundling | V2+ |
> | DR-040 cloud auto-backup | **V1.x** — full third-party integration (option c: Dropbox/GDrive/S3); manual JSON export is the launch-day safety net; middle-path platform-storage auto-export skipped |
> | DR-041 ExportProfileEditor UI | **V1.x** |
> | DR-042 size-limit banners | **V1** — folded into a V1 polish/verification pass (Phase 10), not a standalone item |
> | DR-043 BulkUnlockConfirmModal | **V1** |
> | DR-044 Brief-aware lock conflict | **DROPPED** — written against the removed brief-amendments surface; residual case already covered by check_node_writable's agent-in-flight category |
> | DR-045 /settings/locks page | V1.x |
> | DR-046 editor 423-handling | **V1** |
> | DR-047 restore-while-locked polish | V1.x |

### 2.1 Phase 14 — Layer stack generalisation (post-V1 architectural)

#### DR-025 — Drop / replace nodes.node_type CHECK constraint
- Origin: TA §11 Phase 14 + project_layer_stack_generalisation memory
- Description: Replace the seven-explicit-value CHECK with layer-stack-aware write-time validation. Required before non-novel doc types can be added without schema changes.
- Effort: M  ·  V1-risk: None
- Proposed bucket: V2+
- Rationale: V1 ships Novel + Series-of-Novels via the existing hardcoded LAYER_LABELS / NODE_TYPES maps. Phase 14 is the polymorphic version for adding Anthology / Paper / TV Series / Screenplay etc.

#### DR-026 — Extend layers JSONB shape (abbreviation, labels, agent_profile_mapping)
- Origin: TA §11 Phase 14
- Description: Add `abbreviation`, `singular_label`, `plural_label`, `at_reference_token`, `default_word_count_target`, `agent_profile_mapping` fields to the layer_stacks.layers JSON.
- Effort: M  ·  V1-risk: None
- Proposed bucket: V2+
- Rationale: Carries Phase 14 with DR-025.

#### DR-027 — GET endpoint for layer_stacks
- Origin: TA §11 Phase 14
- Description: API route for clients to fetch layer_stack data (currently NodeTree hardcodes labels with a Phase 2 stub comment admitting this).
- Effort: S  ·  V1-risk: None
- Proposed bucket: V2+
- Rationale: Part of Phase 14 polymorphism.

#### DR-028 — Rewrite NodeTree to consume fetched layer_stack
- Origin: TA §11 Phase 14
- Description: NodeTree.tsx currently hardcodes `LAYER_LABELS` + `NODE_TYPES`. Replace with dynamic consumption of the fetched layer_stack from DR-027.
- Effort: M  ·  V1-risk: None
- Proposed bucket: V2+
- Rationale: Carries Phase 14.

#### DR-029 — Move layer_stack_id from documents to projects
- Origin: TA §11 Phase 14
- Description: ~50-line SQL migration. Layer-stack identity belongs at project level, not document.
- Effort: S  ·  V1-risk: None
- Proposed bucket: V2+
- Rationale: Carries Phase 14.

#### DR-030 — Per-layer-stack Director config + per-node-type agent profiles
- Origin: TA §11 Phase 14
- Description: Data work: each layer_stack gets its own Director system prompt; each node_type gets its own agent profile. Closes the "academic-paper Director needs different reasoning to novel Director" hole.
- Effort: L  ·  V1-risk: None
- Proposed bucket: V2+
- Rationale: The biggest piece of Phase 14 — the actual differentiation between doc types lives here.

### 2.2 Document operations sub-system (Phase 3a per Product Roadmap)

#### DR-031 — chunk-analyzer
- Origin: TA V1 backlog → Phase 3a per Product Roadmap
- Description: Analyse arbitrary text chunks (e.g. for the Reports panel) outside the node tree.
- Effort: M  ·  V1-risk: None
- Proposed bucket: V2+
- Rationale: V1 author surface is node-tree-centric. Chunk-level analysis is the foundation for the Reports / scope-query Roadmap items.

#### DR-032 — document-operation-runner
- Origin: TA V1 backlog → Phase 3a
- Description: Background runner that executes document-scope operations (analyse the whole doc, find inconsistencies, etc.). Sibling to agent_jobs but doc-scoped.
- Effort: L  ·  V1-risk: None
- Proposed bucket: V2+
- Rationale: Non-trivial new subsystem; V1 has no doc-scope operations.

#### DR-033 — Reports panel
- Origin: TA V1 backlog → Phase 3a
- Description: A UI surface where the author requests doc-scope reports (style consistency, repetition flags, character-arc check, etc.) and the runner produces them.
- Effort: L  ·  V1-risk: None
- Proposed bucket: V2+
- Rationale: Depends on DR-031 + DR-032. Genuine V2 feature.

#### DR-034 — Scope query builder
- Origin: TA V1 backlog → Phase 3a
- Description: UI for the author to declaratively scope reports (this act, these chapters, scenes with status=draft, etc.).
- Effort: M  ·  V1-risk: None
- Proposed bucket: V2+
- Rationale: Depends on Reports panel landing first.

#### DR-035 — Style-consistency analysis profiles
- Origin: TA V1 backlog → Phase 3a
- Description: Pre-built analysis profiles (style consistency, dialogue tic detection, etc.) the Reports panel can run.
- Effort: M  ·  V1-risk: None
- Proposed bucket: V2+
- Rationale: Depends on the runner + Reports panel.

### 2.3 Other document-ops deferrals

#### DR-036 — JSON round-trip backup: export **and** import, designed together
- Origin: Phase 7 SHIPPED memo / CLAUDE.md v1.38; **rescoped 2026-06-13** alongside DR-042.
- Description: **The JSON export is being CUT from V1** (see DR-042) — a serialised internal-schema dump with no importer is a half-feature that delivers neither portability nor restore. JSON is re-homed here as a *single* deliberate future feature: a round-trip backup/restore where **export and import ship together**, never the export half alone. If/when built, design it as a versioned, documented backup contract (not a raw `SELECT *` of internal tables) with a matching importer, so it serves real disaster-recovery / account-migration scenarios.
- Effort: L (export format + importer + a stable backup schema contract)  ·  V1-risk: None (out of V1)
- Bucket: **V2+ / Backlog — LOCKED 2026-06-13.** Supersedes the prior split where JSON export was V1 and import was V2; both are now one backlog feature.
- Rationale: V1 has no consumer for it — the author has nothing to restore *from*, and data ownership / exit is served by the always-available Markdown backstop (DR-042). Exposing the internal DB shape as a user-facing file before there's an importer to consume it is a contract liability with no offsetting benefit.

#### DR-037 — PDF export
- Origin: Phase 7 SHIPPED memo
- Description: PDF as an export target alongside DOCX / EPUB / JSON / Outline.
- Effort: M  ·  V1-risk: None
- Proposed bucket: V2+
- Rationale: DOCX covers the print/publishing flow (Word → Acrobat). Native PDF needs a headless-office binary on Vercel (OA-2 hazard) or a third-party API; either is real V2 work.

#### DR-038 — KDP submission flow integration
- Origin: Phase 7 SHIPPED memo
- Description: Direct submission of DOCX / EPUB to Amazon KDP.
- Effort: L  ·  V1-risk: None
- Proposed bucket: V3
- Rationale: Genuine partner-API work; Amazon KDP API access has its own approval process. Niche enough that we'd ship after multiple users ask.

#### DR-039 — Per-export attachment bundling
- Origin: Phase 7 SHIPPED memo
- Description: Bundle related assets (cover art, fonts, etc.) into the export.
- Effort: M  ·  V1-risk: None
- Proposed bucket: V2+
- Rationale: V1 exports are text-only. Cover/asset bundling is publishing-prep work.

#### DR-040 — Cloud backup auto-export
- Origin: Phase 7 SHIPPED memo / Product Spec §4.14
- Description: Scheduled auto-export to user-configured cloud storage (Dropbox / GDrive / S3).
- Effort: L  ·  V1-risk: Low
- Bucket: **V1.x — LOCKED 2026-06-10**, full third-party-integration shape (option c)
- Rationale: Author chose the full third-party integration in V1.x over the smaller platform-storage middle path. Launch-day safety net is manual JSON export + Phase 11 platform-side backup drill.

#### DR-041 — ExportProfileEditor full UI
- Origin: Phase 7 SHIPPED memo
- Description: V1 ships built-in seed profiles + author-save RPCs. UI editor for author-saved profiles deferred.
- Effort: S  ·  V1-risk: None
- Proposed bucket: V1.x
- Rationale: V1 author can launch with built-in seeds; editor adds polish.

#### DR-042 — Export format lineup rework: per-book publishing + Markdown backstop, JSON cut
- Origin: Phase 7 SHIPPED memo; **rescoped 2026-06-13** after a design discussion that started on size-limit banners and reframed the whole export model.
- **Bucket: V1 — LOCKED 2026-06-13** (Phase 10 build).
- **What changed and why:** the original DR-042 was "wrap the size-limit validator messages in dedicated banner components." Tracing the actual export pipeline reframed the problem. Three findings drove the rework: (1) a "Series" is **one document** in V1 (`Series → Book → Act → …` tree), so a whole-series export is one giant file — but **per-book is the real unit of publishing** (you submit each book to KDP separately, and you export the book you just finished, not the omnibus); (2) the **JSON export is a half-feature** — it serialises the internal DB shape (node_versions, locks, context-link rows, ordinal paths) yet **has no importer** (DR-036) and isn't even on the backlog with one, so it delivers neither portability (too internal to be usable elsewhere) nor backup (can't be restored); exposing the internal schema also couples future schema changes to files on users' disks; (3) the genuine launch need is **data ownership / exit** — a user must always be able to walk away with their work in an open, usable form, needing nothing from Stelavox.
- **Locked V1 export lineup:**
  - **DOCX** + **EPUB** = *publishing* artifacts → **per-book**. For a Series document the modal shows a **book picker** (the Series root's Book children); selection is a **deliberate pick** (nothing checked by default — author selects one, several, or all). Output is always one file per selected book, never a merged series file. New mechanism: a **subtree-scoped tree walk** via `export_jobs.root_node_id = <bookId>`; N independent export jobs reusing the existing `ExportProgressStack` / per-job retry / history. Filename pattern: **`{Series} — {NN} {Book Title}.{ext}`** (zero-padded book ordinal so a multi-select set is self-sorting). A Novel document is already one book — no picker.
  - **Markdown manuscript** (NEW) = the *own-your-data / walk-away* backstop → **whole-document**, structure as headings (`# Book` / `## Act` / `### Chapter` / `#### Scene`) + **final prose only, no history, no internal ids**. Trivial renderer (walk tree → headings + prose). Genuinely unlimited at realistic scale (prose-only ≈ 6 bytes/word → a 1.5M-word 10-book epic ≈ ~9 MB), so it answers "a format with no realistic limit" by construction. Always available; the guaranteed escape hatch. Satisfies data-portability ("commonly-used machine-readable format") better than internal JSON.
  - **Outline** (Markdown, structure only) = planning snapshot → unchanged, whole-document, tiny.
  - **JSON** = **CUT from V1.** Removed from the export modal + renderer. Re-homed as a single deliberate future feature paired with its importer — see DR-036 (export + import designed together, never the export half alone).
- **What this retires / simplifies:** the whole-series single file (for publishing formats); the pre-flight-disable + EPUB-fallback dance (mostly moot once everything is book-sized); and the entire JSON size-engineering thread (memory ceiling on the in-memory pretty-printed string; the **latent silent-truncation bug** — `node_versions` read has no pagination, PostgREST caps at ~1000 rows, so a large backup could drop history unnoticed; the single-request upload fragility; the 50 MB Supabase Storage default). None of it is needed once JSON is gone and every other file is bounded by a single book.
- **Runtime no-silent-failure (retained, all formats):** if a render fails, the progress chip must show a concrete reason routed through the 9.E `classifyFailure` / FailureBanner surfaces — never a silent fail; if a format is provably unrecoverable for a document, it's dropped from that document's options.
- **Effort:** M (subtree walk + book-picker modal UI + Markdown renderer + JSON removal). Wireframe-first: the book-picker modal gets a wireframe + short Tier-B note before code, built in the Phase 10 export pass.

### 2.4 Document-ops V1 partial closures

#### DR-043 — BulkUnlockConfirmModal wiring ✅ SHIPPED 2026-06-13
- Origin: Phase 6 SHIPPED memo
- Description: Backend ships in Phase 6 (lock release per bulk_operation_id RPC + API route). UI listed in wireframe but not wired into NodeMoreMenu.
- Effort: S  ·  V1-risk: Medium
- Bucket: **V1 — SHIPPED Phase 9.E (E.5)**
- Rationale: Phase 6 polish that didn't quite land. If author author-locks a subtree in V1 launch, they'll want to unlock as a unit. Small finish-the-job task.
- **Closeout:** New `BulkUnlockConfirmModal` offers two scopes — "Unlock all N" (DELETE `/api/nodes/[id]/lock/bulk-operation/[bulkOpId]`) and "Unlock just this one" (DELETE `/api/nodes/[id]/lock`). `NodeMoreMenu` reads the target lock's `bulk_operation_id` + batch count directly from `node_author_locks` (RLS allows org-member reads) when the self-blocker is `author_locked`; a non-null bulk id swaps the Unlock item to open the modal, otherwise unlock proceeds direct. The Unlock label surfaces the batch size: "🔓 Unlock… (N in batch)".

#### DR-044 — Brief-aware lock conflict (Brief amendments-in-flight check)
- Origin: Phase 6 SHIPPED memo
- Description: Lock conflict modal doesn't recognise Brief amendments in flight as conflicting. Treats them as ignorable.
- Effort: S  ·  V1-risk: Low
- Proposed bucket: V1.x
- Rationale: Edge case; the V1.x-A.1 simplification removed amendments anyway. Re-evaluate post-launch if mid-flight scenarios surface.

#### DR-045 — /settings/locks admin page UI
- Origin: Phase 6 SHIPPED memo
- Description: API route GET /api/admin/locks ships; page UI deferred.
- Effort: S  ·  V1-risk: None
- Proposed bucket: V1.x
- Rationale: Backend is queryable manually; UI is admin convenience.

#### DR-046 — Editor 423-handling refinement ✅ SHIPPED 2026-06-13
- Origin: Phase 6 SHIPPED memo
- Description: Falls back to existing Phase 3 conflict-toast pattern when a write 423s due to author-lock. Could be more explicit.
- Effort: S  ·  V1-risk: Low
- Bucket: **V1 — SHIPPED Phase 9.E (E.2)**
- Rationale: Author launch test will encounter this if they edit while a lock changes. Refinement is small.
- **Closeout:** Refined the existing `ConflictBanner` (already mounted in NodeDetailPanel, already consuming the editor-store `lockedReason`) rather than adding a parallel banner — a parallel FailureBanner on 423 would double-render. The lock branch now distinguishes author-lock from parent-lock, guides the author to "⋯ → Unlock", states that edits up to the lock are saved, and labels the action "Reload" (vs "Use latest" for a 409 content conflict). TC-U-11 updated to assert the Reload label + unlock guidance.

#### DR-047 — VersionHistory restore UI editor 423-handling
- Origin: project_phase3_restore_deferral memory
- Description: Restore action shipped Phase 6 (`restore_node_version` RPC). UX edge cases for restore-while-locked vs restore-while-agent-in-flight may need polish.
- Effort: S  ·  V1-risk: Low
- Proposed bucket: V1.x
- Rationale: Core flow works; refinement candidate.

---

## 3. Author UX

> **✅ CATEGORY LOCKED 2026-06-10:**
>
> | Item | Locked bucket |
> |---|---|
> | DR-048 full sample novel | V2+ |
> | DR-049 Phase 5d test long-tail | V1.x |
> | DR-050 injection-scanner rejection UX | **V1 — rescoped: NO override; clear security warning only** |
> | DR-051 Director context create + link | **V1 — ✅ SHIPPED 2026-06-11** |
> | DR-052 empty-summary expand guard | V1.x |
> | DR-053 BriefViewer concurrent indicator | **DROPPED** — multi-active briefs removed by simplification; no concurrent state left to indicate |
> | DR-054 stage-membership pill | V2+ |
> | DR-055 lock-line copy review | V1.x |
> | DR-056 merge-gate CI/CD | V1.x |

### 3.1 Onboarding (Phase 8.3 carry-overs)

#### DR-048 — Real "Cartographer's Apprentice" sample novel content
- Origin: Phase 8.01 wireframe-lock 2026-05-31
- Description: V1 author has approved dropping in a very small functional sample for Phase 8 onboarding tests. Full 24k-word "Cartographer's Apprentice" sample is V2 (substantial content + licence work).
- Effort: L (the full version)  ·  V1-risk: None
- Proposed bucket: V2+
- Rationale: V1 ships with a tiny placeholder sample. The full 24k-word novel as sample content needs author writing time + licence framing.

### 3.2 Phase 5d JB UI sweep deferrals (~10 cases)

#### DR-049 — Phase 5d UI test long-tail (canary mocks, mouse-drag, comment surfaces)
- Origin: Phase 5d v1.0 absorption note in CLAUDE.md
- Description: ~10 Playwright cases involving canary mocks, mouse-drag selection, version-trigger via API path, comment-thread surface variants, two-tab simulations.
- Effort: M  ·  V1-risk: Low
- Proposed bucket: V1.x
- Rationale: Test coverage gaps; not user-visible features.

### 3.3 V1 polish carry-overs

#### DR-050 — SU-J11-1 — Injection scanner rejection UX (security warning, NO override) ✅ SHIPPED 2026-06-13
- Origin: Phase 5d Mars-series investigation memo
- Description: Injection scanner flags legitimate fictional content (e.g. a notebook scene mimicking prompt-injection). **Rescoped 2026-06-10 by author decision:** there will be NO override mechanism — security is paramount and is not compromised. The deliverable is a clear, well-written security warning explaining WHY the content was rejected, so the author understands their options: rewrite the flagged text to something benign, or write that prose manually without AI assistance.
- Effort: S (was M — override machinery dropped from scope)  ·  V1-risk: Medium
- Bucket: **V1 — SHIPPED Phase 9.E (E.3)** (LOCKED 2026-06-10)
- Rationale: Author: "Security is paramount and we can not compromise on security. The author is completely free to manually enter the prose themselves and not use the AI." The scanner's behaviour is correct; only the explanation surface is missing.
- **Closeout:** New `SecurityWarningBanner` on the FailureBanner chassis — `--color-status-review` left border (caution, not error-red, because the scanner firing is the system working as intended), ⛊ icon, title "Content blocked by security check". Copy comes from `platform_config` (`failure.injection_blocked_message`, M-224) via the failure-message bundle so it's admin-tunable; the locked copy states there is no override and lists the two options (rewrite the flagged text / write the prose manually). `isInjectionBlockedError()` recognises the runner-persisted `injection_blocked:<field>` shape; AgentTab routes injection failures to the dedicated banner (never the generic FailureSurface) and its `friendlyError()` injection branch had its stale "override is on the V1.x roadmap" promise removed to match the author lock. **No override affordance anywhere.**

#### DR-051 — Director context-node capability: create + link ✅ SHIPPED 2026-06-11
- Origin: Phase 5d Mars-series Bug 4 memo (SU-J11-2), scope broadened 2026-06-10
- Description: **Author-locked V1 scope:** the Director must be able to (a) generate a context node — create-and-fill as one user-perceived action (Option B executor auto-create resolves the original semantics gap), AND (b) link a context node to an appropriate content node (context_links creation as a Director-plannable step). Original SU-J11-2 only covered (a); the author added (b) as a requirement.
- Effort: M  ·  V1-risk: Medium
- Bucket: **V1 — LOCKED 2026-06-10 — SHIPPED 2026-06-11**
- Rationale: Author: "The director needs to be able to generate a context node and also needs to be able to link a context node to an appropriate content node." Both halves are needed for context workflows to function end-to-end through the Director. Touches the Director tool registry (H-08 propose-only discipline applies) — needs a Tier-B design pass before build.
- **Closeout (2026-06-11):** Substrate was already live at `lib/director/workflow-executor.ts:496-578` (SU-J11-2 Option B landed at some point after the May-2026 memo without a CLAUDE.md changelog entry; both create AND link halves were shipped in that same code block — the executor creates the context node and inserts a `node_context_links` row of type `structural_to_context`). The remaining work was prompt + documentation parity: M-218 publishes Director config **v1.29** with the prompt rewritten in two passages (Step shapes line for generate_context + Trust-the-specialists block) to teach the model the auto-create + auto-link behavior. Tool registry unchanged (17 tools). Verification: 3 new integration cases in `tests/unit/workflow-executor-context.test.ts` + 1 drift-guard case in `tests/unit/director-prompt-vs-schema-drift.test.ts`. SU-J11-2 memo closed. H-08 preserved (executor's auto-create runs at dispatch time, not inside the tool-use loop). Apply-time discovery: v1.25/v1.26/v1.27/v1.28 had each shipped without changelog — back-documented in TA v2.20 §3.6 and Director Architecture v2.10.

#### DR-052 — SU-J11-3 — Validate non-empty target summary before expand dispatch
- Origin: Phase 5d Mars-series memo (raised as low-priority)
- Description: Expand on a node with empty summary provides nothing for the LLM to base children on. Should be caught at dispatch.
- Effort: S  ·  V1-risk: Low
- Proposed bucket: V1.x
- Rationale: Edge case; conservative behaviour is to fail loudly. Worth tightening but won't move launch.

### 3.4 V1.x-D UI extensions deferred

#### DR-053 — BriefViewer concurrent-Brief indicator
- Origin: V1.x-D SHIPPED memo
- Description: BriefViewer doesn't surface when other concurrent active Briefs exist. SchedulerPanel does via ConcurrentBriefsNote, but the in-Brief view doesn't.
- Effort: S  ·  V1-risk: Low
- Proposed bucket: V1.x
- Rationale: Director simplification 2026-05-21 removed multi-active Briefs (one-active partial-unique-index restored). This indicator is now obsolete unless multi-active returns. **Possibly Drop — verify against current state.**

#### DR-054 — Stage membership pill on NodeRow lifecycle badges
- Origin: V1.x-D SHIPPED memo
- Description: NodeRow already shows queued/run/new badges. Showing which Brief stage a node is owned by was deliberately deferred (brief_stages cross-fetch adds non-trivial complexity).
- Effort: M  ·  V1-risk: Low
- Proposed bucket: V2+
- Rationale: Author can see Brief state from the Director panel; stage-membership on the tree row is convenience, not core.

### 3.5 Phase 8 deferrals + carry-overs

#### DR-055 — Lock-line copy accuracy review at scale
- Origin: Phase 8.01 wireframe lock
- Description: `YoursTile` lock-line copy `ENCRYPTED AT REST · PRIVATE TO YOUR ACCOUNT` accurate but should be reviewed when other tile/copy surfaces land.
- Effort: S  ·  V1-risk: Low
- Proposed bucket: V1.x
- Rationale: Small copy polish.

### 3.6 PR merge-gate CI/CD (split from Phase 8.7 → Backlog)

#### DR-056 — Merge-gate CI/CD (lint + type-check + test must pass before merge)
- Origin: Phase 8 closeout (v1.50)
- Description: GitHub action that runs lint + type-check + unit tests on every PR and blocks merge if any fail.
- Effort: S  ·  V1-risk: Low
- Proposed bucket: V1.x
- Rationale: Author currently runs these manually before commits. Automated gating prevents regressions but works fine manually for V1. Easy V1.x add.

---

## 4. Brand + Design System

> **✅ CATEGORY LOCKED 2026-06-10:** DR-057 + DR-058 both **V1**, executed as one combined half-session "Inviolable audit close" task. The Inviolable #2 enumeration must be exact before launch.

### 4.1 Open Inviolable audit items

#### DR-057 — YoursTile decorative verdigris dot — audit
- Origin: Phase 8.01 wireframe lock (CLAUDE.md v1.46)
- Description: Decorative verdigris dot strictly counts as a 10th use category. Recommended treating as brand-mark reinforcement under use #1 family pending audit.
- Effort: S  ·  V1-risk: None
- Proposed bucket: V1
- Rationale: Inviolable #2 lives or dies on the precise enumeration. Resolve before launch — either fold into use #1 explicitly or drop the verdigris from the tile.

#### DR-058 — Mentioned-node tree-row left border — audit
- Origin: Phase 8.01 wireframe lock (CLAUDE.md v1.46)
- Description: Reuses the active-node use #9 treatment. Logically a second function under the same use; no broadening but worth recording.
- Effort: S  ·  V1-risk: None
- Proposed bucket: V1
- Rationale: Same as DR-057; lock the Inviolable enumeration before launch.

---

## 5. Data + Infra

> **✅ CATEGORY LOCKED 2026-06-10:**
>
> | Item | Locked bucket |
> |---|---|
> | DR-059..DR-062, DR-064, DR-065 (scale-dependent) | V1.x — Day-1 observability guaranteed by DR-121 |
> | DR-063 cloud scheduler listener cutover | **V1 — cloud-cutover package** |
> | DR-066 "Director interrupted — resume?" UI | **V1** |
> | DR-067 cloud DB sync (~150 migrations) | **V1 — cloud-cutover package** |
>
> **Cloud-cutover package:** DR-063 + DR-067 + DR-117 (Vercel-Cron probe schedule) are one pre-launch mini-phase, not three scattered tasks. DR-063 needs a design session first (listener's cloud home: always-on worker vs Supabase queues vs alternative).

### 5.1 V1.x-B.2 deferrals to operational launch test

#### DR-059 — CK-6/7 fairness ratios at scale
- Origin: V1.x-B.2 SHIPPED memo
- Description: WFQ fairness checkpoints can't be validated in test substrate — need real multi-user concurrent load to observe.
- Effort: M  ·  V1-risk: Low
- Proposed bucket: V1.x
- Rationale: V1 launch is one user (the author). Fairness only matters with multiple users; observable when traffic arrives.

#### DR-060 — CK-9 1000-concurrent FOR UPDATE SKIP LOCKED stress
- Origin: V1.x-B.2 SHIPPED memo
- Description: Validation that the dispatcher's FOR UPDATE pattern holds at 1000 concurrent claim attempts.
- Effort: M  ·  V1-risk: None
- Proposed bucket: V1.x
- Rationale: V1 won't see 1000 concurrent. Worth proving before scaling.

#### DR-061 — CK-13 aging promotion under load
- Origin: V1.x-B.2 SHIPPED memo
- Description: Class-4 aging promotion observable under sustained load only.
- Effort: M  ·  V1-risk: None
- Proposed bucket: V1.x
- Rationale: Same as DR-060.

#### DR-062 — H-22 VFT virtual clock periodic re-zero job
- Origin: V1.x-B.2 SHIPPED memo (CLAUDE.md v1.29 + hazard table)
- Description: Virtual clock can overflow over time; periodic re-zero job mitigates. Deferred to V1.x-D was the original plan; never landed.
- Effort: S  ·  V1-risk: Low
- Proposed bucket: V1.x
- Rationale: H-22 is documented; mitigation is a small pg_cron job. Won't fire in V1 timescales but is correct-completeness work.

#### DR-063 — Cloud cutover for the TS scheduler listener

> **✅ SHIPPED 2026-06-11** — Phase 9.1+9.2. See `stelavox_phase9_1_2_test_report_v1_0.md`.
- Origin: V1.x-B.2 SHIPPED memo
- Description: lib/scheduler/listener.ts is currently local-dev-only. Cloud cutover (running it on Vercel / dedicated worker / Supabase Edge Function) is the deferred path to real deployment.
- Effort: L  ·  V1-risk: High
- Proposed bucket: V1
- Rationale: **V1 cannot deploy to cloud without this.** Currently every cloud-deployed user hits a dead scheduler. Big unresolved deployment dependency.

#### DR-064 — Per-profile estimated_input_tokens / output_tokens
- Origin: V1.x-B.2 SHIPPED memo
- Description: V1.x-B.2 uses DEFAULT_TICKET_COST=2500 for all profiles. Per-profile values would improve WFQ accuracy.
- Effort: S  ·  V1-risk: None
- Proposed bucket: V1.x
- Rationale: Default works; tuning per-profile improves dispatch fairness once we have real cost data per profile.

#### DR-065 — BYOK batched_24h submission
- Origin: V1.x-B.2 SHIPPED memo
- Description: Batch API submission for BYOK calls (not just platform). Anthropic supports this.
- Effort: M  ·  V1-risk: None
- Proposed bucket: V1.x
- Rationale: Platform batched_24h ships in V1.x-B.2. BYOK extension is mirror work; needed for BYOK users who can afford the 24h latency.

#### DR-066 — CK-2 "Director was interrupted; resume?" UI ✅ SHIPPED 2026-06-13
- Origin: V1.x-B.2 SHIPPED memo
- Description: When the cooperative-abort happens mid-iteration, the user should see "Director was interrupted; resume?" — substrate ships, UI surface deferred.
- Effort: S  ·  V1-risk: Medium
- Bucket: **V1 — SHIPPED Phase 9.E (E.4)**
- Rationale: Author will hit this in V1 launch test. Crash recovery without the resume prompt looks like data loss.
- **Closeout:** The conversation GET route already computed `interrupted_message_id` (Phase 5b I-12) but nothing consumed it. Threaded it through `useDirectorConversation` (new `interruptedMessageId` field) and mounted the existing `StoppedFollowOnBanner` in DirectorPanel with a new `variant="interrupted"` (title "Director was interrupted" + "resume to continue from where it left off" copy) when an interrupted turn is present and no stream is live. Resume/Cancel/View machinery + the resume endpoint are shared with the V1.x-D stopped variant; `iterationCount` became optional for the interrupted case (not cheaply available from the GET payload).

### 5.2 Data store realtime / performance

#### DR-067 — Cloud DB sync (~150 missing migrations to stelavox-dev)

> **✅ SHIPPED 2026-06-11** — Phase 9.1+9.2. See `stelavox_phase9_1_2_test_report_v1_0.md`.
- Origin: 2026-06-10 cloud diagnosis (M-214 attempt)
- Description: Cloud stelavox-dev is at migration 20260512104456 (V1.x-LB ship date). Missing ~150 migrations covering V1.x-A onward, Phase 6, 7, 8, and the realtime fix M-214.
- Effort: L  ·  V1-risk: High
- Proposed bucket: V1
- Rationale: **Hard blocker for V1 cloud deploy.** Single operation but needs careful pre-sync data check + decision on whether existing cloud rows survive.

---

## 6. LLM Cost Model

(See DR-011..DR-017 under Agent System for calibration items, and DR-070 Stripe under Multi-tenancy. No further unique items in this category — pricing / plans / cache / batched_24h all shipped V1.x-B.2 / V1.x-C.)

---

## 7. Failure UX + Observability

(DR-019 push-model notifications + DR-020 per-surface adoption captured under Agent System. DR-066 resume-prompt UI captured under Data + Infra. Audit-log themes captured below.)

#### DR-121 — Day-1 admin observability of scheduler calibration metrics
- Origin: Category 1 lock discussion 2026-06-10 (author requirement attached to the Group B calibration deferral)
- Description: The Group B tunings (DR-011..DR-014, DR-016, DR-017) are V1.x because they need traffic data — but that data must be *accumulating and visible from Day 1*. Verify the V1.x-E admin dashboard + metrics rollup actually surface everything needed to do those tunings later: WFQ fairness per class, per-pool bucket utilisation, class distribution of dispatches, queue ages, conversation-window hit rates, probe outcomes. Close any gaps as small admin-dashboard additions.
- Effort: S–M  ·  V1-risk: Medium (if data isn't captured from Day 1, the V1.x tuning window starts late)
- Bucket: **V1 — LOCKED 2026-06-10**
- Rationale: Author: "I want to have observability in the admin in V1 so that from Day 1, I have visibility of what is going on." Most substrate exists (metrics_minute_buckets, dispatcher_tick_samples, route_capacity_samples, anthropic_rate_limit_samples); this item is the verification-and-gap-close pass, naturally slotting into Phase 10 or 11.

---

## 8. Multi-tenancy + Accounts

> **✅ CATEGORY LOCKED 2026-06-10.** **Product-scope lock: V1 = single-user orgs only.** No multi-user orgs in V1 — that's V2. But Stripe + paying customers ARE V1.
>
> | Item | Locked bucket |
> |---|---|
> | DR-068 org settings UI | V1.x — subscription management via **Stripe hosted Customer Portal** (linked from Account page as part of DR-070 build; near-zero custom UI) |
> | DR-069 invitation flow | **V2+** (moved from V1.x — follows the single-user-org lock; invitations only make sense with multi-user orgs) |
> | DR-070 Stripe | **V1 — ✅ SHIPPED 2026-06-11** |
> | DR-071 document read-sharing | V2+ |
> | DR-072 audit log UI (user/org-facing) | V2+ — but an **admin-only audit viewer ships V1 under DR-096** |

### 8.1 TA V2 backlog items

#### DR-068 — Organisation settings UI
- Origin: TA V2 backlog
- Description: Admin surface for editing org name, billing details, member roles, etc.
- Effort: M  ·  V1-risk: None
- Proposed bucket: V1.x
- Rationale: V1 single-author launch can settings-via-DB. Real users will need self-serve.

#### DR-069 — Invitation flow
- Origin: TA V2 backlog
- Description: Invite users to an org via email; accept-invite → join membership.
- Effort: M  ·  V1-risk: None
- Proposed bucket: V1.x
- Rationale: V1 launch is one user; invitations matter once teams join. Soon after launch.

#### DR-070 — Stripe integration ✅ SHIPPED 2026-06-11
- Origin: TA V2 backlog
- Description: Real billing — collect payment, manage subscriptions, handle webhooks, dunning.
- Effort: L  ·  V1-risk: High
- Bucket: **V1 — LOCKED 2026-06-10 — SHIPPED 2026-06-11 (Phase 9.B, two sessions)**
- Rationale: Author decision: every plan including BYOK pays a platform cost through Stripe, so payment rails are unconditionally required for launch. Plan upgrade + BYOK-conversion flows ride on the same rails (they're the credit-exhaustion escape paths per DR-015). Major implementation — needs its own phase slot in 9.E.
- **Closeout (2026-06-11):** Phase 9.B shipped in **three** sessions on `claude/phase9-b-stripe-substrate` + `claude/phase9-b-session2-webhook` + `claude/phase9-b-yearly-cadence`. **Session 1 (B.1-B.4):** substrate (M-219 platform_config keys, M-220 `organisations.trial_expires_at` + `stripe_price_id`, `stripe@22.2.0`, `lib/stripe/{config,client,customers,sessions}`); trial-expiry redirect in `(app)/layout.tsx`; Checkout + Portal routes. **Session 2 (B.5-B.8):** webhook handler with signature verification + 11 event types + idempotency via M-221 unique index; plan transitions in `webhook-handlers.ts` (priceIdToPlan reverse-lookup; American↔British status normalisation); UI polish (status banners on `/settings/plan`); Tier-A bumps. **Session 3 (yearly cadence follow-up):** M-222 adds 8 yearly Price ID slots; `lib/stripe/config.ts` gains `Cadence='monthly'|'yearly'` + `STRIPE_CADENCES` + `DEFAULT_CADENCE='monthly'`; `getStripePriceId(mode, plan, cadence)` + `requireStripeConfigured` validates BOTH cadences; `createCheckoutSession({plan, cadence})`; `priceIdToPlan` returns `{plan, mode, cadence}`; `/api/billing/checkout` accepts cadence in body (defaults to monthly); webhook surfaces cadence in audit; PlanPanel becomes a client component with `CadenceToggle` (Monthly · Annual save 20%); SubscribeButton plumbs cadence. Per-month credit resets locked for both cadences. **Locks made during scoping:** test mode for V1 launch with live-swap via `stripe.mode` UPDATE (no deploy); trial expiry redirects to plan-buy page, no data loss; BYOK flat $15/month subscription; comprehensive webhook scope; Price IDs in platform_config (DB-auditable, mode-aware); per-month credit resets regardless of cadence; monthly is the default UI cadence. **35 Vitest PASS** (10 stripe-config + 12 trial-expiry + 9 stripe-plans incl. yearly + 4 stripe-webhook-handlers). Substrate-only state ships safely (503 `stripe_not_configured` with `missing` list until account provisioned). End-to-end activation gated by user-driven Stripe account setup — checklist in Session 1 Test Report §6 now requires 8 Price IDs per mode (4 monthly + 4 yearly). **Session 4 (admin payments page, 2026-06-13):** author triaged the payment surface and pulled the last hardcoded parameter out + a comprehensive admin page in. M-223 extracts `STRIPE_API_VERSION` from `lib/stripe/client.ts:17` into `stripe.api_version` config; drift-guard Vitest forbids re-introduction. 3 new Checkout-option keys (`automatic_tax_enabled`, `allow_promotion_codes`, `billing_address_collection`) wired into Checkout Session creation. Past-due gate at both layers (D4.c) — credit gate refuses dispatch when `subscription_status='past_due'`; AppShell + /settings/plan show banners with `billing.payment_failure_grace_days` driving the copy. 3 new webhook event types — `charge.dispute.created` / `charge.refunded` / `invoice.payment_action_required` — write to `audit_log` (D5.a: dispute=critical, refund=high). `/admin/payments` page with 5 tabs (Configuration · Price IDs · Subscription health · Events · Failures); `PLATFORM_ADMIN_EMAILS` env-var allowlist; inline edits via `/api/admin/payments/config` Server Action with per-key validators, audit_log on every write, masked-secret storage, double-entry webhook-secret confirmation (D1.a), `_clearConfigCache()` + `_clearStripeClientCache()` side effects. 26 new Vitest cases. Migration count 222 → 223. CLAUDE.md v1.55 → v1.56.

#### DR-071 — Document read-sharing
- Origin: TA V2 backlog
- Description: Share a document for read-only access (public link or per-user grant).
- Effort: M  ·  V1-risk: None
- Proposed bucket: V2+
- Rationale: Author launch test is private. Sharing surfaces when an author has a beta-reader workflow.

#### DR-072 — Audit log UI
- Origin: TA V2 backlog
- Description: User-facing view of audit log events (who did what, when).
- Effort: M  ·  V1-risk: None
- Proposed bucket: V2+
- Rationale: Audit log writes happen V1; viewing them is admin convenience.

---

## 9. Deployment + Operations

(Phase 11 covers operational hardening + runbooks + DR; specific deliverables get assigned at Phase 11 kickoff. Will populate further from spec sweep.)

---

## 10. Documentation + Meta

> **✅ CATEGORY LOCKED 2026-06-10:** DR-073, DR-074, DR-076 → V1.x. DR-075 → V1.x, merged into the existing `stelavox_deployment_setup_v1_0.md` rather than a new doc.

### 10.1 Developer documentation backlog (moved from Phase 12)

#### DR-073 — Architecture overview (dev docs)
- Origin: Phase 12 scope narrowing 2026-05-19 (CLAUDE.md v1.36)
- Description: Developer-facing overview of how the substrate fits together. Replaces ad-hoc Tier-A reading.
- Effort: M  ·  V1-risk: None
- Proposed bucket: V1.x
- Rationale: V1 has one developer (the author). Architecture docs help when a second person ever touches the code.

#### DR-074 — Contribution guide
- Origin: Phase 12 scope narrowing
- Description: How to clone, branch, work, commit, merge. Conventions captured.
- Effort: S  ·  V1-risk: None
- Proposed bucket: V1.x
- Rationale: Same as DR-073.

#### DR-075 — Local-dev setup guide
- Origin: Phase 12 scope narrowing
- Description: Step-by-step local environment setup (Supabase local, .env.local, ports, tests, etc.). Some of this lives in `stelavox_deployment_setup_v1_0.md` already.
- Effort: S  ·  V1-risk: None
- Proposed bucket: V1.x
- Rationale: Closer to existing deployment setup doc; could just be merged with that.

#### DR-076 — Ongoing Tier-A drift audits
- Origin: Phase 12 scope narrowing
- Description: Periodic audit that Tier-A specs haven't drifted from shipped code. Process discipline, not a feature.
- Effort: M (ongoing)  ·  V1-risk: None
- Proposed bucket: V1.x
- Rationale: Has compounding value as the spec library grows. Schedule monthly or per-release.

---

## 11. Security

(See Round-3 audit themes T-7 + T-14 in §12. Active V1.x security work clusters around the injection-frame discipline and DB-layer invariant enforcement.)

#### DR-095 — F-74 — Rate-limit fail-policy: FAIL-CLOSED

> **✅ SHIPPED 2026-06-11** — Phase 9.1+9.2. See `stelavox_phase9_1_2_test_report_v1_0.md`.
- Origin: Round-3 audit (deferred from Batch B5 to deep dive)
- Description: Rate-limit query failure currently fails-open. **Decision locked 2026-06-10: fail-closed** — if the rate-limit state can't be verified, decline the dispatch with a Class-A retryable error. Costs an occasional spurious retry during DB blips; consistent with the no-compromise security posture (see DR-050).
- Effort: S  ·  V1-risk: Medium
- Bucket: **V1 — LOCKED 2026-06-10**
- Rationale: One of the 14 most-leveraged HIGH findings. Behaviour change + TA policy documentation together.

#### DR-096 — F-56 — audit_log writes on critical events + admin viewer

> **✅ SHIPPED 2026-06-11** — Phase 9.1+9.2. See `stelavox_phase9_1_2_test_report_v1_0.md`.
- Origin: Round-3 audit (B5.1 partial; spec gap); scope broadened 2026-06-10
- Description: TA §4.3/§4.5/§4.9 mandate audit_log writes for critical events (auth, RLS denials, agent failures). Code uses console.error in several sites. **Author-broadened scope:** also ship an admin-section audit-log viewer so the events are visible at /admin, not just queryable in the DB. (User/org-facing audit UI stays V2+ as DR-072.)
- Effort: M  ·  V1-risk: Medium
- Bucket: **V1 — LOCKED 2026-06-10** (writes + admin viewer)
- Rationale: Audit trail is a security + ops requirement; author: "I want to be able to see this in the admin section."

---

## 12. Round-3 audit themes (207 residual findings as theme-level items)

> **✅ CATEGORY LOCKED 2026-06-10:**
>
> | Item | Locked bucket |
> |---|---|
> | DR-097 T-1 silent failure | **V1 — scope-split:** lint rule (ban bare `catch {}`) + hot-path/user-facing sites (autosave, agent streams, SSE, accept paths) in V1; component-fetch long tail in V1.x |
> | DR-098 T-2 H-01 .single() sweep | **V1** — ESLint rule + mechanical sweep |
> | DR-099 T-3 two sources of truth | V1.x |
> | DR-100 T-4 billing race | **V1** — usage-records UPSERT minimum; with paying customers (DR-070) dropped usage rows = revenue bug |
> | DR-101 T-5 ORDER BY sweep | V1.x |
> | DR-102 T-6 spec/code security divergence | **V1** — F-89 fix is the live item; rest by spec amendment |
> | DR-103 T-7 injection-frame bypass | **V1** — centralised wrapping; raw user strings can't reach the LLM |
> | DR-104 T-8 H-04 atomicity RPCs | V1.x |
> | DR-105 T-9 H-12 config sweep | V1.x |
> | DR-106 T-10 ancestor-walk RPC | V1.x |
> | DR-107 T-11 typed error classes | V1.x |
> | DR-108 T-12 verdigris | ✓ closed |
> | DR-109 T-13 spec-citation lint | V1.x |
> | DR-110 T-14 DB-invariant cleanups | V1.x |
> | DR-111 getConfig validation | **V1** |
> | DR-112 decorateWithLeaf | **V1** |
> | DR-113 long-tail (~140 LOW) | Opportunistic — no schedule; fix when touching files for other reasons |

The audit's biggest signal is the recurring patterns, not the individual findings (per `99-themes.md`). Capturing each theme as one DR item gives correct decision-granularity: a fix targeting a theme closes 10–20+ individual findings. Per-finding capture would produce 207 rows that each require the same conceptual decision.

#### DR-097 — Theme T-1 — Silent failure on transport / error / race (26+ sites)

> **✅ SHIPPED 2026-06-11** — Phase 9.1+9.2. See `stelavox_phase9_1_2_test_report_v1_0.md`.
- Origin: Round-3 audit Theme T-1
- Description: Dominant audit theme. Functions return null, drop events, swallow errors, or resolve cleanly when underlying operations broke. 26+ sites across Anthropic streams, SSE encoders, autosave, fetch helpers, component-layer fetches.
- Effort: L  ·  V1-risk: High
- Proposed bucket: V1
- Rationale: Project-wide convention change required. ESLint rule banning bare `} catch { }` + every catch must re-throw / log with context / emit typed error event. Author launch test WILL hit silent-failure surfaces; debugging them post-hoc will be painful.

#### DR-098 — Theme T-2 — H-01 violations (.single() where .maybeSingle() is correct, 10+ sites)

> **✅ SHIPPED 2026-06-11** — Phase 9.1+9.2. See `stelavox_phase9_1_2_test_report_v1_0.md`.
- Origin: Round-3 audit Theme T-2
- Description: H-01 documented in TA but not enforced. 10+ sites use `.single()` on UPDATE / fetch-by-id paths where zero rows is a legitimate outcome.
- Effort: M  ·  V1-risk: Medium
- Proposed bucket: V1
- Rationale: ESLint rule `no-supabase-single` + per-site sweep. Each violation produces a misleading "0 rows" error on what should be a graceful empty result.

#### DR-099 — Theme T-3 — Two sources of truth (15+ sites)
- Origin: Round-3 audit Theme T-3
- Description: Parallel implementations of the same concept that must stay in sync, no compile-time guard. F-19 BYOK ✓ closed; F-81 Zod→JSON Schema ✓ closed; remaining: manual row types vs generated DB types, duplicate `getOrgId` (3 sites), duplicate `extractJson*` helpers, duplicate NodePicker components, metadata-schemas vs agent_profile_library, F-251 verdigris-backdoor (dormant after B-Inviol close).
- Effort: M  ·  V1-risk: Low
- Proposed bucket: V1.x
- Rationale: Drift is real but slow-moving. Per-pair consolidation work; can land post-launch as cleanup.

#### DR-100 — Theme T-4 — Race conditions without UPSERT/atomic primitive

> **✅ SHIPPED 2026-06-11** — Phase 9.1+9.2. See `stelavox_phase9_1_2_test_report_v1_0.md`.
- Origin: Round-3 audit Theme T-4
- Description: 5 SELECT-then-INSERT-or-UPDATE patterns that race under concurrency. F-99 `getOrCreateConversation` and F-133 `updateUsageRecords` partially closed (DB UNIQUE landed via M-038/M-039 but F-134 still swallows the error → billing-data-loss). F-96 `nextSequence`, F-154 `createNode` (M-038 added UNIQUE; race now rejects silently), F-188 `renumberSiblingsAfterDelete` remain.
- Effort: M  ·  V1-risk: High
- Proposed bucket: V1
- Rationale: Billing-data-loss is unacceptable on launch. UPSERT for `updateUsageRecords` (F-133) closes it. Other sites can land V1.x.

#### DR-101 — Theme T-5 — Find-first without ORDER BY (6+ sites)
- Origin: Round-3 audit Theme T-5
- Description: `.limit(1).maybeSingle()` over multi-row results without deterministic ordering. F-143 `getOrgId` returns arbitrary org for multi-org users (rare in V1; matters at multi-tenancy scale).
- Effort: S  ·  V1-risk: Low
- Proposed bucket: V1.x
- Rationale: Per-site `.order(...)` additions. Mechanical sweep.

#### DR-102 — Theme T-6 — V2 deferrals contradict V1 checklist

> **✅ SHIPPED 2026-06-11** — Phase 9.1+9.2. See `stelavox_phase9_1_2_test_report_v1_0.md`.
- Origin: Round-3 audit Theme T-6
- Description: F-56 audit_log (captured DR-096); F-78/F-115 `create_document_operation_step` Phase 5b carve-out; F-89 `assertConversationAuthor` admits any caller when no user messages exist.
- Effort: M  ·  V1-risk: Medium
- Proposed bucket: V1
- Rationale: Spec / code divergence on security-relevant surfaces. Either fix or amend spec; current ambiguity is dangerous.

#### DR-103 — Theme T-7 — escapeXml / injection-scan bypass on user content (5 sites)

> **✅ SHIPPED 2026-06-11** — Phase 9.1+9.2. See `stelavox_phase9_1_2_test_report_v1_0.md`.
- Origin: Round-3 audit Theme T-7
- Description: Sites that produce LLM input from user strings without going through the security frame. F-55 context-assembler metadata, F-73 tool-validator only walks top-level args, F-95 summariseConversation no escapeXml, F-113 workflow-executor auto-create context node, F-156 `.or()` filter (UUID-validated upstream — defence-in-depth gap).
- Effort: M  ·  V1-risk: High
- Proposed bucket: V1
- Rationale: Injection surface. Centralise the wrapping; brand-typed `WrappedUserText` so raw strings can't reach the LLM. Type-system enforcement is the durable fix.

#### DR-104 — Theme T-8 — H-04 atomicity violations in node operations
- Origin: Round-3 audit Theme T-8
- Description: F-154 createNode race; F-188 renumberSiblingsAfterDelete sequential UPDATEs. M-038 UNIQUE constraint added (rejects races silently). Need RPCs: `create_node_at_end` + `delete_node_with_renumber` analogous to existing `move_node`.
- Effort: M  ·  V1-risk: Medium
- Proposed bucket: V1.x
- Rationale: M-038 makes the race fail loudly at DB layer; routes need to handle the rejection. V1 small-traffic won't hit the race; post-launch RPC sweep closes it.

#### DR-105 — Theme T-9 — H-12 hardcoded operational values (6+ sites)
- Origin: Round-3 audit Theme T-9
- Description: H-12 spec interpreted narrowly. F-39 Anthropic temperature denylist, F-67 injection-scanner patterns, F-97/F-103 director session summariser values, F-128 hardcoded providerName, F-193 budget estimate, F-199 cron grace window, F-223 DirectorPanel widths.
- Effort: M  ·  V1-risk: Low
- Proposed bucket: V1.x
- Rationale: Per-site config seed migrations + call-site updates. Mechanical. Each is small.

#### DR-106 — Theme T-10 — Sequential parent-chain walks (N+1 perf, 4+ sites)
- Origin: Round-3 audit Theme T-10
- Description: F-44 fetchAncestors, F-51 fetchLinkedContextNodes, F-164 listAncestorLinksForNode, F-190 ancestorChainLocked — all walk parent chain as N queries. Single `walk_ancestors(node_id)` Postgres function would replace all.
- Effort: S  ·  V1-risk: Low
- Proposed bucket: V1.x
- Rationale: Perf concern at depth. V1's shallow trees don't trigger; V1.x cleanup with measurable benefit.

#### DR-107 — Theme T-11 — Generic catch-all error wrappers (5 sites)
- Origin: Round-3 audit Theme T-11
- Description: F-71, F-101, F-105, F-119, F-129 — try/catch produces generic error label, hiding actual failure. Typed error classes with discriminated unions would preserve causes.
- Effort: M  ·  V1-risk: Low
- Proposed bucket: V1.x
- Rationale: Hurts forensic reconstruction post-incident; doesn't break behaviour. Cleanup.

#### DR-108 — Theme T-12 — Inviolable #2 verdigris violations (CLOSED)
- Origin: Round-3 audit Theme T-12
- Description: F-213 DirectorInput Send, F-214 PlanCard step checkbox, F-251 verdigris-backdoor — all closed via Inviolable broadening (use #7 → "Affirmative-action triggers") + globals.css remap.
- Effort: —  ·  V1-risk: None
- Proposed bucket: ✓ Closed
- Rationale: Tracked here for completeness; no action.

#### DR-109 — Theme T-13 — Spec staleness on rapid-iteration files (cross-cutting LOW)
- Origin: Round-3 audit Theme T-13
- Description: ~13 sites cite stale spec versions in source comments. Spec citations are static strings; version bumps don't auto-update them. Lint rule that flags `_v\d+_\d+\.md` references mismatching CLAUDE.md current version.
- Effort: S  ·  V1-risk: None
- Proposed bucket: V1.x
- Rationale: Or drop versions from inline citations entirely — cite section number only, assume live spec is canonical. Either is a process discipline change.

#### DR-110 — Theme T-14 — DB-layer doesn't enforce same invariants as API layer
- Origin: Round-3 audit Theme T-14
- Description: Validation discipline is Zod at API boundary. Direct DB writes (service-role from runner, workflow-executor auto-create, migrations, admin) bypass. F-267 `nodes.node_type` no CHECK (M-040 closed), F-268 created_by TEXT not UUID FK, F-269 summary/prose/notes TEXT not JSONB (M-042 closed).
- Effort: M  ·  V1-risk: Medium
- Proposed bucket: V1.x
- Rationale: Most of T-14 closed via M-038/039/040/042 (B4 batches). Remaining items are smaller per-field cleanups.

### 12.1 Additional named HIGH residuals from audit

#### DR-111 — F-07 — `getConfig<T>` casts without validation (most-leveraged single fix)

> **✅ SHIPPED 2026-06-11** — Phase 9.1+9.2. See `stelavox_phase9_1_2_test_report_v1_0.md`.
- Origin: Round-3 audit (per 99-themes.md closing observations)
- Description: Generic cast in platform_config reader. Cascades to F-20, F-21, F-32, F-50, F-138. Single fix adds runtime validation across entire platform_config layer.
- Effort: S  ·  V1-risk: Medium
- Proposed bucket: V1
- Rationale: The audit's stated "single most-leveraged fix." Closes a 6-finding cascade.

#### DR-112 — F-152 / F-160 — `decorateWithLeaf` returns is_leaf=false on layer_stack fetch failure

> **✅ SHIPPED 2026-06-11** — Phase 9.1+9.2. See `stelavox_phase9_1_2_test_report_v1_0.md`.
- Origin: Round-3 audit (per 99-themes.md)
- Description: Silent fallback when layer_stack fetch fails. Cascades to F-195 affecting every node-API response.
- Effort: S  ·  V1-risk: Medium
- Proposed bucket: V1
- Rationale: Second-most-leveraged audit fix per the close-out report.

#### DR-113 — Round-3 audit Phase 8+ long-tail
- Origin: Round-3 audit PROGRESS.md Phase 8+
- Description: Remaining LOW + low-leverage MEDIUM findings (~140) flagged as "rolling, open." Cleanup work — naming, dead code, vague comments, premature abstraction.
- Effort: L  ·  V1-risk: None
- Proposed bucket: V1.x / V2+ mixed
- Rationale: Treat as opportunistic cleanup — whenever an engineer is in a file for unrelated reasons, address adjacent findings. Don't schedule a dedicated phase.

---

## 13. Additional items from CLAUDE.md changelog sweep

> **✅ CATEGORY LOCKED 2026-06-10:** DR-114 → V3 · DR-115 → V2+ · DR-116 → V2+ · DR-117 → V1 (cloud package, locked with Cat 5) · DR-118 → V1.x · DR-119 → V2+ · DR-120 → V1.x

### 13.1 V1.x-A.1 architectural lesson absorption

#### DR-114 — Brief amendments as a future focused tool (post-launch)
- Origin: Director simplification 2026-05-21 (CLAUDE.md v1.39)
- Description: V1.x-B.3 amendment surface was removed because the LLM kept getting it wrong. "If a real mid-flight edit scenario emerges post-V1 launch, it lands as a fresh focused tool, not a rebuild of the old surface."
- Effort: M  ·  V1-risk: None
- Proposed bucket: V3
- Rationale: Soft-drop. Only revisit if real users hit the gap; explicit author rationale was that simplicity matters more than the feature.

#### DR-115 — Scheduled_at + compound stage trigger types
- Origin: V1.x-A.1 simplification (CLAUDE.md v1.39)
- Description: Stage trigger CHECK narrowed to (after_stage, manual). scheduled_at + compound never exercised in V1.x; trigger_config JSONB column stays schema-flexible.
- Effort: M  ·  V1-risk: None
- Proposed bucket: V2+
- Rationale: No real V1 use case. Land if a real scheduled scenario surfaces.

#### DR-116 — Multi-active briefs per document
- Origin: V1.x-B.3 → V1.x-A.1 simplification
- Description: V1.x-B.3 shipped multi-active; M-126 partial unique index dropped. M-183 reversed it. One active per document is now the rule. Multi-active is V2 if needed.
- Effort: M  ·  V1-risk: None
- Proposed bucket: V2+
- Rationale: Per-document Director can be busy with one Brief at a time; rarely a real bottleneck.

### 13.2 Other deferrals captured

#### DR-117 — Cloud cutover for synthetic probes

> **✅ SHIPPED 2026-06-11** — Phase 9.1+9.2. See `stelavox_phase9_1_2_test_report_v1_0.md`.
- Origin: V1.x-F SHIPPED memo
- Description: pg_cron schedule for probes is local-only. Cloud cron is via Vercel-Cron fallback POST `/api/cron/run-probes` (CRON_SECRET) which the user wires manually in Vercel.
- Effort: S  ·  V1-risk: Low
- Proposed bucket: V1
- Rationale: Carries to cloud cutover (DR-067 family). Probe machinery exists but needs the Vercel-Cron schedule set up before launch.

#### DR-118 — SU-22 — window.prompt / window.confirm sites (3 remaining)
- Origin: Phase 5d SU-22 (per CLAUDE.md changelog v1.19)
- Description: Three sites still use native dialogs (link prompts in SelectionTooltip, NotesEditor; one other). Closed 3 of 5 sites in Phase 5d round-3 (Add Child / Rename / Delete via shadcn Dialog); SU-22 remained partial.
- Effort: S  ·  V1-risk: Low
- Proposed bucket: V1.x
- Rationale: Native dialogs block renderer thread and are undriveable from Playwright/MCP. Test-automation hostile but author can live with them in V1.

#### DR-119 — Phase 14 layer-stack pure-data follow-ups
- Origin: TA §11 Phase 14 + project_layer_stack_generalisation memory
- Description: Admin-define new layer_stacks for Anthology, Paper, TV Series, Non-fiction Series, Screenplay etc. as user demand emerges. Pure data work post-Phase 14 code substrate (DR-025..DR-030).
- Effort: M (per stack)  ·  V1-risk: None
- Proposed bucket: V2+ (depends on DR-025..DR-030 landing)
- Rationale: Carries with Phase 14.

#### DR-120 — Inviolable amendment audit at scale
- Origin: CLAUDE.md v1.46 (Phase 8.01 round-2 Brand Identity v2.4 → v2.5 walk-back)
- Description: The Inviolable boundaries (esp. #4 typeface family) have been refined multiple times. As V1 traffic produces signal, audit whether the refinement vocabulary holds or needs further sharpening.
- Effort: S  ·  V1-risk: None
- Proposed bucket: V1.x
- Rationale: Brand stability check; not blocking launch.

---

# Summary tally — FINAL (all categories locked 2026-06-10)

**Total items: 121** (DR-001..DR-121). All buckets ratified by the author across one review session. The 207 Round-3 audit residual findings are represented at theme-level (DR-097..DR-113).

## Final bucket distribution

| Bucket | Count | Contents |
|---|---|---|
| **V1 shipped** | 19 | Phase 9.1 (9 items) + Phase 9.2 (3 items) + Phase 9.D DR-051 (1 item) + Phase 9.B DR-070 (1 item, two sessions) + Phase 9.E work package E (5 items: DR-020/043/046/050/066) — see Test Reports + register entries; 9.E merged 2026-06-13 |
| **V1 remaining** | 3 | 3 Phase-10 folds (DR-042 size banners, DR-057/058 Inviolable audit close, DR-121 Day-1 admin observability verification) |
| **V1.x** | ~42 | Calibration, audit cleanup themes, polish, dev docs, cloud auto-backup, org settings, push notifications |
| **V2+** | ~40 | Director extensions, Phase 14, Document Operations, multi-user orgs + invitations, top-up, read-sharing |
| **V3** (soft-drop) | 2 | DR-038 KDP submission, DR-114 brief amendments |
| **Dropped** | 2 | DR-044 Brief-aware lock conflict, DR-053 BriefViewer concurrent indicator (both obsoleted by the Director simplification) |
| ✓ Closed | 1 | DR-108 verdigris T-12 |

## The V1 work list (22 items) — execution status

**Work package A — Cloud cutover ✅ SHIPPED 2026-06-11 (Phase 9.2):**
1. ~~DR-063 — scheduler listener cloud home~~ ✅ — solved via pg_net Option E (M-216 + M-217), not an always-on worker
2. ~~DR-067 — cloud DB sync (~150 migrations)~~ ✅ — reset + 208 migrations applied; surfaced + fixed 7-file date-stamp inversion bug
3. ~~DR-117 — cron probe schedule~~ ✅ — rides the same pg_net transport (no Vercel-Cron slots consumed)

**Work package B — Stripe + commercial model ✅ SHIPPED 2026-06-11 (Phase 9.B):**
4. ~~DR-070 — Stripe integration~~ ✅ — substrate (M-219 + M-220 + M-221), `lib/stripe/*`, `lib/billing/trialExpiry.ts`, Checkout + Portal + Webhook routes, SubscribeButton + ManageSubscriptionButton, trial-expiry redirect, 11 webhook event types, idempotency via UNIQUE index. Substrate-only state ships safely (503 stripe_not_configured) until Stripe account provisioning (checklist in `stelavox_phase9_b_session1_test_report_v1_0.md` §6).

**Work package C — Security + correctness hardening ✅ SHIPPED 2026-06-11 (Phase 9.1):**
5. ~~DR-095 — rate-limit fail-closed~~ ✅
6. ~~DR-096 — audit_log writes + admin viewer~~ ✅ (incl. wireframe-driven viewer)
7. ~~DR-097 — silent-failure lint rule + hot-path sites~~ ✅ (recon confirmed sites pre-closed; guard rule shipped)
8. ~~DR-098 — H-01 .single() sweep + ESLint rule~~ ✅ (recon confirmed both pre-closed)
9. ~~DR-100 — usage-records UPSERT (billing race)~~ ✅ M-215 atomic RPC
10. ~~DR-102 — F-89 assertConversationAuthor fix~~ ✅ (fallback to org-membership)
11. ~~DR-103 — injection-frame centralisation~~ ✅ (recon confirmed all 5 sites pre-closed)
12. ~~DR-111 — getConfig runtime validation~~ ✅ (recon confirmed pre-closed)
13. ~~DR-112 — decorateWithLeaf silent-fallback fix~~ ✅ (recon confirmed pre-closed)

**Work package D — Director capability ✅ SHIPPED 2026-06-11 (Phase 9.D):**
14. ~~DR-051 — Director context-node create + link~~ ✅ — substrate already live at workflow-executor.ts:496-578 (SU-J11-2 Option B); M-218 publishes Director config v1.29 with prompt parity (both halves — create + link — were always shipped together in the executor's `node_context_links insert`)

**Work package E — UX finish-the-job batch ✅ SHIPPED 2026-06-13 (Phase 9.E):**
15. ~~DR-020 — FailureToast/Banner per-surface adoption~~ ✅ — FailureSurface wrapper + classifier; adopted in AgentTab + SchedulerPanel (AppShell-global satisfied by RealtimeBadge)
16. ~~DR-043 — BulkUnlockConfirmModal wiring~~ ✅ — modal + NodeMoreMenu bulk-membership read + unlock-all / unlock-one scopes
17. ~~DR-046 — editor 423-handling refinement~~ ✅ — refined the existing ConflictBanner lock branch (Reload + unlock guidance)
18. ~~DR-050 — injection-scanner rejection warning UX (no override)~~ ✅ — SecurityWarningBanner; M-224 admin-tunable copy; NO override anywhere
19. ~~DR-066 — "Director interrupted — resume?" UI~~ ✅ — StoppedFollowOnBanner `variant="interrupted"` mounted in DirectorPanel via the conversation GET's `interrupted_message_id`

**Folded into Phase 10 (pre-launch test) rather than standalone — OPEN:**
20. DR-042 — export size-limit banners
21. DR-057 + DR-058 — Inviolable audit close (one combined task)
22. DR-121 — Day-1 admin observability verification + gap-close

## Product-scope locks made during this review

- **V1 plan lineup (locked 2026-06-10):** (1) free trial, one month; (2) single-user platform plans — writer / author / pro on the credit-allocation gate; (3) single-user BYOK plan — `byok_solo`, paying the platform fee via Stripe. **`byok_team` is NOT in V1** — multi-user plan, follows multi-user orgs to V2; plan row stays as dormant data with no Stripe product and no signup path.
- **Stripe is V1; every plan including BYOK pays a platform cost.** Credit exhaustion locks Director/agent dispatch only — **never writing.** Escape paths: upgrade plan or convert to BYOK.
- **V1 = single-user orgs only.** Multi-user orgs + invitations are V2.
- **No injection-scanner override, ever.** Security warning UX explains rejection; author rewrites or writes manually.
- **Rate-limit failures fail closed.**
- **Director must create AND link context nodes** (V1 capability).
- Subscription management via Stripe hosted Customer Portal, not custom UI.

## Phase 9 status

- **9.A inventory** ✅
- **9.B/9.C triage + lock** ✅ — 121 items bucket-assigned 2026-06-10
- **9.D propagate** ✅ — TA v2.18, Director Architecture v2.8, Product Spec v1.19, CLAUDE.md v1.51; register adopted as Tier-A planning artefact
- **9.E slot** ✅ — five work packages numbered (A cloud · B Stripe · C hardening · D Director context · E UX batch)
- **9.1 work package C (hardening)** ✅ SHIPPED 2026-06-11 — see `stelavox_phase9_1_2_test_report_v1_0.md`
- **9.2 work package A (cloud cutover)** ✅ SHIPPED 2026-06-11 — same Test Report
- **9.B work package B (Stripe)** ✅ SHIPPED 2026-06-11/13 — substrate + yearly cadence + admin payments page
- **9.D work package D (Director context)** ✅ SHIPPED 2026-06-11
- **9.E work package E (UX batch × 5)** ✅ SHIPPED 2026-06-13 — DR-020/043/046/050/066; merged `claude/phase9-e-ux-batch`
- **Open:** 3 Phase-10 folds (DR-042 / DR-057+058 / DR-121) — all V1, addressed during Phase 10 pre-launch test rather than standalone

---

# How to use this register

- **Single source of truth.** Items not in this register don't exist. Tier-A specs point here (post-9.D).
- **Living document.** Items can change bucket; new items get the next DR number. Each change adds a changelog note.

# Changelog

**v3.4 — 2026-06-13** **DR-042 rescoped + DR-036 re-homed — export format lineup LOCKED (Phase 10 build).** A design discussion that opened on export size-limit banners reframed the whole export model. **Decision locked by the author:** (1) **DOCX + EPUB go per-book** — a "Series" is one document in V1, but per-book is the real publishing unit; the modal gets a **book picker** (deliberate pick, nothing checked by default; one/several/all), output is one file per selected book via a new subtree-scoped walk (`export_jobs.root_node_id`), filename `{Series} — {NN} {Book Title}.{ext}`. (2) **NEW Markdown manuscript export** (structure + final prose only, no history, no internal ids) = the always-available, whole-document, **own-your-data / walk-away backstop**; trivial renderer, genuinely unlimited at realistic scale (~9 MB for a 1.5M-word epic), answers "a format with no realistic limit" by construction. (3) **Outline** unchanged. (4) **JSON CUT from V1** — it serialised the internal DB shape with no importer (a half-feature that's neither portable nor restorable, and couples schema changes to users' files); **re-homed into DR-036** as a single deliberate future feature where export + import ship *together*. Findings that drove it: JSON's only real consumer (round-trip restore) was never built and isn't bounded — whole-document JSON hits a Vercel-function-memory ceiling, a single-request-upload fragility, the 50 MB Storage default, and a **latent silent-truncation bug** (the `node_versions` read has no pagination; PostgREST caps ~1000 rows, so a large backup could drop history unnoticed). Cutting JSON deletes that entire engineering thread. **No bucket-count change** (DR-042 was already V1-remaining; DR-036 was already V2+) — this is a scope + lineup lock, not a new item. **No code yet** — Phase 10 build, wireframe-first for the book-picker modal. Runtime no-silent-failure (route export failures through the 9.E classifyFailure/FailureBanner surfaces) retained for all formats.

**v3.3 — 2026-06-13** **Phase 9.E SHIPPED — work package E (UX finish-the-job batch).** All five items closed on `claude/phase9-e-ux-batch`: **DR-020** (FailureToast/Banner per-surface adoption) — new `FailureSurface` wrapper + `lib/ui/classifyFailure.ts` status→class mapping + `/api/failure-messages` route; adopted in AgentTab + SchedulerPanel; AppShell-global judged satisfied by the existing RealtimeBadge; classifier deliberately excludes 423 + 422-injection so dedicated surfaces own them. **DR-046** (editor 423-handling) — refined the already-mounted `ConflictBanner` lock branch (Reload label + "⋯ → Unlock" guidance + "edits saved" reassurance) rather than double-rendering a parallel banner. **DR-050** (injection-scanner rejection UX) — new `SecurityWarningBanner` on the FailureBanner chassis, `--color-status-review` caution border, copy from `platform_config` (`failure.injection_blocked_message`, M-224); **NO override anywhere** per the author lock; AgentTab's stale "override on the roadmap" promise removed. **DR-066** ("Director interrupted — resume?") — threaded the conversation GET's pre-existing `interrupted_message_id` through `useDirectorConversation` and mounted `StoppedFollowOnBanner variant="interrupted"` in DirectorPanel. **DR-043** (BulkUnlockConfirmModal) — new modal + `NodeMoreMenu` bulk-membership read from `node_author_locks` + unlock-all / unlock-one scopes against the existing bulk-operation DELETE route. **Verification:** type-check clean; new + extended Vitest (classify-failure, injection-warning, phase6b DR-043 membership cases) PASS; the only full-suite failure is the documented `m173-m174-h26-audit #12` local-DB-state flake (unrelated — no director_turns rollup code touched). **Migration count 223 → 224.** **No Inviolables changed; verdigris-use count remains 12** (feedback surfaces use neutral / status-review / error tokens only). Bucket distribution: V1 shipped 14 → 19; V1 remaining 8 → 3 (only the 3 Phase-10 folds remain, all addressed during the Phase 10 pre-launch test). **All five V1 work packages (A–E) are now SHIPPED.**

**v3.2 — 2026-06-11** **Phase 9.B SHIPPED (DR-070).** Stripe integration in two consecutive sessions: substrate + trial-gate + Checkout/Portal (Session 1) → webhook handler + plan transitions + UI polish + Tier-A close (Session 2). 3 migrations (M-219/220/221), `stripe@22.2.0`, `lib/stripe/*`, 3 API routes, 11 webhook event types, idempotency via UNIQUE index, trial-expiry redirect, 32 new Vitest PASS. Substrate-only ships safely (503 stripe_not_configured until Stripe account provisioned). Apply-time discoveries: subscription_status CHECK uses British spelling (handled via normaliseSubscriptionStatus); platform_config cross-test race surfaced 60s in-process cache + warranted `_clearConfigCache` test helper. Locks made during scoping: test mode default with `stripe.mode` live-swap; trial expiry redirects (no data loss); BYOK flat $15/mo; comprehensive webhook scope; Price IDs in platform_config; monthly cadence only. Bucket distribution: V1 shipped 13 → 14; V1 remaining 9 → 8. Work-package B marked SHIPPED. End-to-end activation gated by user-driven Stripe account setup — checklist in Session 1 Test Report §6.

**v3.1 — 2026-06-11** **Phase 9.D SHIPPED (DR-051).** Director context-node create + link closed. Diagnosis surfaced that the substrate was already live at `lib/director/workflow-executor.ts:496-578` (SU-J11-2 Option B landed at some point after the May-2026 memo without a CLAUDE.md changelog) — both halves (create + auto-link via `node_context_links` row of type `structural_to_context`) shipped together in that block. The remaining work was prompt + documentation parity: M-218 publishes Director config v1.29 with the prompt rewritten in two passages to teach the model the supported path. Apply-time discovery: v1.25/v1.26/v1.27/v1.28 had each shipped without changelog entries — back-documented in TA v2.20. Bucket distribution: V1 shipped 12 → 13; V1 remaining 10 → 9. Work-package D marked SHIPPED. SU-J11-2 memo closed; latent executor transition-event bug flagged as follow-up.

**v3.0 — 2026-06-11** **Phase 9.1 + 9.2 SHIPPED.** 12 V1 register items closed (DR-063 / DR-067 / DR-095 / DR-096 / DR-097 / DR-098 / DR-100 / DR-102 / DR-103 / DR-111 / DR-112 / DR-117). Each carries an inline `✅ SHIPPED 2026-06-11` badge pointing at `stelavox_phase9_1_2_test_report_v1_0.md`. V1 work-list section reorganised by execution status. Bucket distribution: V1 split into "shipped" (12) + "remaining" (10). Work packages B (Stripe), D (Director context), E (UX batch × 5), and 3 Phase-10 folds remain. Phase 9 status section updated — 9.A–9.E all complete; 9.1 + 9.2 shipped.

**v2.1 — 2026-06-10** V1 plan lineup locked: free trial month + single-user platform plans (writer/author/pro) + single-user BYOK (`byok_solo`). `byok_team` explicitly out of V1 (follows multi-user orgs to V2; dormant data, no Stripe product, no signup path).

**v2.0 — 2026-06-10** **ALL CATEGORIES LOCKED — Phase 9.B/9.C complete.** Categories 8/10/11/12/13 ratified: single-user-orgs V1 product lock; DR-069 invitations → V2+; Stripe Customer Portal approach; DR-095 fail-closed; DR-096 broadened (+admin viewer); six audit themes → V1 (DR-097 scope-split, DR-098, DR-100, DR-102, DR-103, DR-111+DR-112); eight themes → V1.x; Cat 13 per proposal. Final tally: 22 V1 items in five work packages + 3 Phase-10 folds; ~42 V1.x; ~40 V2+; 2 V3; 2 dropped. Remaining: 9.D propagation + 9.E phase-slotting.

**v1.4 — 2026-06-10** Categories 4 + 5 LOCKED. DR-057/058 → V1 (one combined Inviolable-audit-close task). Cloud-cutover package ratified as V1 mini-phase (DR-063 + DR-067 + DR-117). DR-066 resume-prompt UI → V1. Six scale-dependent infra items → V1.x.

**v1.3 — 2026-06-10** Category 3 (Author UX) LOCKED. DR-050 → V1 RESCOPED: no override mechanism ever — security warning UX only (author: "Security is paramount and we can not compromise on security"). DR-051 → V1 BROADENED: Director must create context nodes AND link them to content nodes. DR-053 → DROPPED (second drop; multi-active briefs gone). DR-056 merge-gate CI → V1.x. Bulk items per proposal.

**v1.2 — 2026-06-10** Category 2 (Document Operations) LOCKED. Phase 14 cluster + Phase 3a chain → V2+; export deferrals → V2+/V3 per proposal; DR-040 auto-backup → V1.x (full third-party shape, middle path skipped); DR-041 profile editor → V1.x; DR-042 size banners → V1 (folded into Phase 10 polish); DR-043 bulk-unlock + DR-046 423-handling → V1; DR-044 → DROPPED (first drop of the review).

**v1.1 — 2026-06-10** Category 1 (Agent System) LOCKED. All 24 items ratified: Group A → V2+ except DR-008 → V1.x; Group B calibration → V1.x with new V1 requirement DR-121 (Day-1 admin observability); DR-015 top-up → V2+; DR-070 Stripe → V1 (commercial model locked: BYOK also pays platform cost via Stripe; exhaustion locks Director only, never writing; escape = upgrade or BYOK-convert). DR-020 FailureToast adoption → V1 confirmed. Register now at 121 items.

**v1.0 — 2026-06-10** Initial Phase 9.A inventory. 120 items captured across 11 categories + 14 audit themes. Proposed buckets pending discussion.

