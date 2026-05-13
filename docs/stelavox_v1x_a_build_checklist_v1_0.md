# Stelavox — V1.x-A Build Checklist
## Version 1.0

> **Tier-B per-phase document.** Frozen for V1.x-A build. Defines the ordered task list, prerequisites, checkpoint criteria, and merge gates for V1.x-A — Brief + Stage substrate. Architectural source is `docs/stelavox_director_architecture_v2_0.md` (Tier-A canonical, v2.0.2). Companion to `stelavox_v1x_a_api_contract_v1_0.md` and `stelavox_v1x_a_test_plan_v1_0.md` (authored alongside this doc).

**Phase:** V1.x-A — Brief + Stage substrate. Brief is the Director's canonical durable memory for the life of a project; Stage is the milestone within a Brief's roadmap. Every document gets exactly one Brief.

**Scope locked 2026-05-13** per CLAUDE.md v1.22 + Director Architecture v2.0.2 §16.1:
- IN — Brief + Stage data model; `lib/brief/` module; `get_brief_state` (read) + `propose_brief` + `propose_brief_amendment` (write-proposals); BriefViewer + BriefProposalCard + StageCard + ConversationClearButton; Director system prompt v1.4; conversation rolling window.
- OUT — per-iteration Director-turn decomposition (V2 doc §8.1a → V1.x-B); stage-trigger-invokes-Director (V2 doc §8.4 → V1.x-B); scheduler queue + throttle + WFQ + per-user buckets (→ V1.x-B); `batched_24h` execution intent (→ V1.x-B); `get_scheduler_state` (→ V1.x-B); plan + cost meter (→ V1.x-C).

**Substrate available at V1.x-A start:** master HEAD `735b6c1` (V1.x-LB + cascading content-discipline + variety verification). 62 migrations applied. Director system prompt v1.3. Director executor uses messages-array tool-use protocol (SU-47 absorbed). `agent.director_max_concurrent_dispatch=1` holding pattern in place (replaced in V1.x-B). The Shadow Protocol test document (1 book + 3 acts + 5 chapters + 15 scenes + 22 beats + context nodes) is restored locally from `snapshots/stelavox_local_2026-05-12_post_v1x_lb_shadow_protocol.dump`.

---

## 1. Pre-Build Prerequisites

These must be green before T-1.1. Verify in order. The session-start procedure memory `feedback_phase_session_procedure.md` is the authority — anything below that conflicts with it defers to that file.

### PB-1 — Worktree and branch

A worktree exists at `.claude/worktrees/busy-colden-6c14b0` on branch `claude/busy-colden-6c14b0` (or renamed in-place to `claude/v1x-a-brief`). Master tip is `735b6c1`.

```
git -C C:/dev/stelavox_2 worktree list
git status     # clean
git log --oneline -3 master
```

### PB-2 — Supabase stack health

The +10-shifted local stack is running (per `project_worktree_ports.md`). Studio at `http://127.0.0.1:54333`; API at `http://127.0.0.1:54331`. Windows port exclusion (54321-54340) is in place (added 2026-05-13 to defeat Hyper-V dynamic port reservation per `feedback_supabase_stop_no_backup.md` companion).

```
supabase status     # all services healthy
curl -s -o /dev/null -w "%{http_code} %{time_total}s\n" http://127.0.0.1:54331/auth/v1/health
# Expect: 200 in <0.05s. If slow (>1s), stop supabase_vector_stelavox_2 — see V1.x-LB session memory.
```

### PB-3 — Stray dev server check

```
netstat -ano | grep ':3000\s.*LISTENING'
```

If a process is listening from a previous worktree, stop it before `npm run dev` in this worktree.

### PB-4 — Migration baseline clean

The 62 migrations replay cleanly against the local stack. This is the pre-V1.x-A baseline.

```
supabase db reset     # only on a disposable DB; do NOT run on a DB with test data you need
# Verify all 62 migrations apply in order with no errors
```

If preserving test data (e.g. the restored Shadow Protocol corpus), skip the reset and verify head only:

```
docker exec supabase_db_stelavox_2 psql -U postgres -d postgres -c "SELECT max(version) FROM supabase_migrations.schema_migrations;"
# Expect: 20260512000062
```

### PB-5 — Type baseline clean

```
npm install
npm run type-check     # exit 0
npm run lint           # exit 0
npm run build          # exit 0
```

### PB-6 — V1.x-LB close-out absorbed in source

Verify the spec library matches V1.x-LB's close-out:

```
ls docs/stelavox_director_architecture_v2_0.md           # exists; v2.0.2
ls docs/stelavox_technical_architecture_v2_3.md          # exists; v2.3.1
ls docs/stelavox_product_specification_v1_9.md           # exists
ls docs/stelavox_component_specification_v2_10.md        # exists
grep -m1 "## Version 1.22" CLAUDE.md
diff CLAUDE.md docs/CLAUDE_stelavox_project.md           # empty diff
```

### PB-7 — Test data baseline

Confirm the Shadow Protocol document is present (used as backfill target for Migration 073):

```
docker exec supabase_db_stelavox_2 psql -U postgres -d postgres -c "SELECT count(*) AS docs FROM documents; SELECT node_type, count(*) FROM nodes GROUP BY node_type ORDER BY node_type;"
# Expect: 1 doc; 22 beats / 15 scenes / 5 chapters / 3 acts / 1 book + context nodes
```

If absent, restore from `snapshots/stelavox_local_2026-05-12_post_v1x_lb_shadow_protocol.dump` per the recovery procedure in `feedback_supabase_stop_no_backup.md`.

### PB-8 — Environment variables

No new server secrets are required by V1.x-A. The carryover set is unchanged: `ANTHROPIC_API_KEY`, `PROMPT_CANARY_TOKEN`. `unset ANTHROPIC_API_KEY` before any `tsx` invocation per `reference_anthropic_key_shell_override.md`.

### PB-9 — Cheap-model override

Per `feedback_haiku_default.md`, every LLM call during V1.x-A build-test uses Haiku 4.5. Director config's runtime model_id (currently `claude-opus-4-6`) is the launch default; tests override to Haiku.

---

## 2. Phase Checkpoint Criteria

V1.x-A is COMPLETE when all CKs are green.

### CK-1 — Every document has exactly one Brief

```
docker exec supabase_db_stelavox_2 psql -U postgres -d postgres -c "
  SELECT d.id, d.name, b.id AS brief_id, b.status, b.goal_text IS NOT NULL AS has_goal
  FROM documents d LEFT JOIN briefs b ON b.document_id = d.id;
"
```

Every document row has a non-null `brief_id`. `documents.brief_id` is NOT NULL FK. The 1:1 invariant is enforced both directions (FK + unique constraint on `briefs.document_id`).

### CK-2 — `get_brief_state` returns the §6.3 flattened shape

For the Shadow Protocol document (and any other test document):

```
curl -s -H "Authorization: Bearer <jwt>" "http://localhost:3000/api/brief/<doc-brief-id>" | jq
```

Returns `{ goal, status, current_stage, stages[], preferences{}, recent_amendments[] }`. Matches V2 doc §6.3 schema.

### CK-3 — Director proposes a Brief on first macro-intent message against an empty Brief

Open a fresh document (or one with `briefs.goal_text IS NULL`). Send Director a macro-intent message ("write a 90,000-word literary noir set in 1970s Sydney"). The Director:

1. Calls `get_brief_state` (reads empty Brief).
2. Emits `<brief_proposal>` artefact in the next iteration.
3. The DirectorPanel renders a `BriefProposalCard` with goal + stages + preferences + Approve button.
4. On Approve: `POST /api/brief/proposals/[id]/approve` writes `briefs.goal_text`, `briefs.preferences`, and inserts `brief_stages` rows.

### CK-4 — Director proposes an amendment when a durable preference is stated mid-conversation

Against a populated Brief, send a durable-preference message ("Make sure the protagonist never uses contractions in dialogue"). The Director:

1. Calls `get_brief_state` (sees no such constraint).
2. Emits `<brief_amendment_proposal>` with `amendment_type=add_constraint`.
3. UI renders the amendment card with before/after preview + Approve.
4. On Approve: `POST /api/brief/amendments/[id]/approve` writes a `brief_amendments` row and updates `briefs.preferences`.

### CK-5 — Conversation rolling window slices to N turns

Send N+5 turns to a fresh conversation (N = `getConfig('agent.director_conversation_window_turns')`, default 10). The next Director turn assembles a `messages` array containing only the most recent N turns (verifiable via executor logs or a Vitest unit assertion). Older turns are not in the prompt body.

### CK-6 — BriefViewer renders against a seeded Brief

The Shadow Protocol document's project header shows the BriefViewer panel with: goal text (initially empty placeholder, then populated post-Brief-approval), stage progress list, preferences block, recent amendments. Inter typography only. No verdigris (the only verdigris affordance is the StageCard Approve button on a `proposed` stage — use #7, no new Inviolable).

### CK-7 — ConversationClearButton clears the rolling window but not the Brief

Click Clear in DirectorPanel header. Confirmation dialog matches spec verbatim. On confirm: `conversation_messages` for this conversation are deleted (or marked archived per chosen mechanism); `briefs` and `brief_stages` rows untouched. Next Director turn sees an empty conversation window and a populated Brief.

### CK-8 — Director executor unchanged

The existing T-2 / T-3 / T-9 paths (Phase 5b/5c) still pass. No regression in the agentic loop. `npm run script tests/director/j5-director-turn.spec.ts` PASS.

### CK-9 — Pre-merge invariants

```
npm run type-check     # exit 0
npm run lint           # exit 0
npm run build          # exit 0
diff CLAUDE.md docs/CLAUDE_stelavox_project.md   # empty
```

### CK-10 — Hazards ratified

H-18 (Brief preference type drift) implemented via `lib/brief/preferencesValidator.ts` and called from every amendment-write path. H-19 (Stage trigger cycles) implemented via cycle detection in the proposal validator even though V1.x-A doesn't fire triggers — guard is for V1.x-B-readiness.

### CK-11 — Test Report v1.0 + close-out absorption

Test Report `stelavox_v1x_a_test_report_v1_0.md` records every CK above as PASS or explicit deferral. Tier-A specs absorb V1.x-A's deltas — Director Architecture v2.0.2 stays (no v2.0.3 needed; V1.x-A is the first implementation of its §6 design without architectural change). TA v2.3.1 may need a §3.6 amendment if migration numbers differ from the doc's table-shape entries (the §3.6 entries are non-numbered; numbers assigned at implementation per the doc's own note).

---

## 3. Ordered Task List

### 3.1 Migrations + types

#### T-1.1 — Author the V1.x-A Director system prompt seed (v1.4)

`prompts/director_v1_4_system_prompt.md` — copy v1.3 as baseline, add three new sections:

- **Brief-as-canonical-memory framing.** "The Brief is your canonical durable memory for this project. Call `get_brief_state()` at the start of any substantive planning turn. Voice preferences, project constraints, named decisions, and the stage roadmap live in the Brief — not the conversation. The conversation is a rolling window of the most recent turns."
- **Macro-intent recognition heuristic.** "If the current Brief has no goal_text set AND the user's request implies whole-document or multi-workflow work (e.g. 'write the whole book', 'plan all the acts', 'develop characters and then draft chapters one through five'), propose a Brief via `propose_brief` instead of a single workflow. Once the Brief has goal_text, do not re-propose — amend via `propose_brief_amendment` for delta changes."
- **Durable-preference promotion heuristic.** "When the user states a durable preference, constraint, or decision in conversation (voice rules, named entities, structural constraints), propose a Brief amendment via `propose_brief_amendment`. Ephemeral commentary stays in conversation."

#### T-1.2 — Author Migration 070 — `briefs` table

`supabase/migrations/20260513000070_briefs_table.sql`:

```sql
CREATE TABLE briefs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id     UUID NOT NULL UNIQUE REFERENCES documents(id) ON DELETE CASCADE,
  organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  status          TEXT NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active','completed','cancelled','archived')),
  goal_text       TEXT,
  preferences     JSONB NOT NULL DEFAULT '{}'::jsonb,
  current_stage_id UUID,  -- FK added in M-071 (forward ref to brief_stages)
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at    TIMESTAMPTZ
);

ALTER TABLE briefs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can read briefs in their organisation"
  ON briefs FOR SELECT TO authenticated
  USING (organisation_id IN (
    SELECT organisation_id FROM organisation_members WHERE user_id = auth.uid()
  ));

-- INSERT / UPDATE policies via SECURITY DEFINER functions (see T-1.7)
```

#### T-1.3 — Author Migration 071 — `brief_stages` table + FK back to `briefs.current_stage_id`

`supabase/migrations/20260513000071_brief_stages_table.sql`:

```sql
CREATE TABLE brief_stages (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brief_id       UUID NOT NULL REFERENCES briefs(id) ON DELETE CASCADE,
  "order"        INT NOT NULL,
  title          TEXT NOT NULL,
  description    TEXT,
  trigger_type   TEXT NOT NULL
                 CHECK (trigger_type IN ('after_stage','scheduled_at','manual','compound')),
  trigger_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  status         TEXT NOT NULL DEFAULT 'planned'
                 CHECK (status IN ('planned','proposing','proposed','approved','scheduled','running','completed','cancelled','skipped')),
  started_at     TIMESTAMPTZ,
  completed_at   TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (brief_id, "order")
);

ALTER TABLE brief_stages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can read stages of briefs in their organisation"
  ON brief_stages FOR SELECT TO authenticated
  USING (brief_id IN (
    SELECT id FROM briefs WHERE organisation_id IN (
      SELECT organisation_id FROM organisation_members WHERE user_id = auth.uid()
    )
  ));

ALTER TABLE briefs
  ADD CONSTRAINT briefs_current_stage_fk
  FOREIGN KEY (current_stage_id) REFERENCES brief_stages(id) ON DELETE SET NULL
  DEFERRABLE INITIALLY DEFERRED;
```

#### T-1.4 — Author Migration 072 — `brief_amendments` table (append-only)

`supabase/migrations/20260513000072_brief_amendments_table.sql`:

```sql
CREATE TABLE brief_amendments (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brief_id              UUID NOT NULL REFERENCES briefs(id) ON DELETE CASCADE,
  proposed_by           TEXT NOT NULL CHECK (proposed_by IN ('user','director')),
  amendment_type        TEXT NOT NULL,
  before                JSONB NOT NULL,
  after                 JSONB NOT NULL,
  approved_at           TIMESTAMPTZ,
  approved_by_user_id   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reason                TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE brief_amendments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can read amendments for briefs in their organisation"
  ON brief_amendments FOR SELECT TO authenticated
  USING (brief_id IN (
    SELECT id FROM briefs WHERE organisation_id IN (
      SELECT organisation_id FROM organisation_members WHERE user_id = auth.uid()
    )
  ));
```

No UPDATE/DELETE policies — append-only by design.

#### T-1.5 — Author Migration 073 — `documents.brief_id` FK + backfill + NOT NULL

`supabase/migrations/20260513000073_documents_brief_id.sql`:

```sql
ALTER TABLE documents ADD COLUMN brief_id UUID;

-- Backfill: create an empty Brief for each existing document.
INSERT INTO briefs (document_id, organisation_id, status, preferences)
SELECT d.id, d.organisation_id, 'active', '{}'::jsonb
FROM documents d
WHERE NOT EXISTS (SELECT 1 FROM briefs b WHERE b.document_id = d.id);

UPDATE documents d
SET brief_id = b.id
FROM briefs b
WHERE b.document_id = d.id AND d.brief_id IS NULL;

ALTER TABLE documents
  ALTER COLUMN brief_id SET NOT NULL,
  ADD CONSTRAINT documents_brief_id_fk
  FOREIGN KEY (brief_id) REFERENCES briefs(id) ON DELETE RESTRICT;

-- documents.brief_id is also UNIQUE (1:1 with briefs.document_id, both directions).
CREATE UNIQUE INDEX documents_brief_id_unique ON documents(brief_id);
```

#### T-1.6 — Author Migration 074 — extend `create_document_with_layer_stack` RPC to create Brief

`supabase/migrations/20260513000074_create_document_with_brief.sql`:

Modify the existing RPC (Migration 015/020) to:
1. Create the document row.
2. Create the layer_stack.
3. Create the root node.
4. **Create an empty Brief row** with `document_id = new.id`, `organisation_id = new.organisation_id`, `status='active'`, empty preferences.
5. Update `documents.brief_id` to the new Brief's id.

All wrapped in a single transaction. `SECURITY DEFINER` with `SET search_path = public` per H-13.

#### T-1.7 — Author Migration 075 — Brief / Stage / Amendment write SECURITY DEFINER functions

`supabase/migrations/20260513000075_brief_write_functions.sql`:

- `apply_brief_proposal(p_brief_id UUID, p_goal_text TEXT, p_preferences JSONB, p_stages JSONB[])` — atomic: writes `briefs.goal_text`, `briefs.preferences`, inserts `brief_stages` rows, sets `briefs.current_stage_id` to the first stage, writes a `brief_amendments` row capturing the initial state for audit. Validates organisation membership via auth.uid().
- `apply_brief_amendment(p_amendment_id UUID)` — atomic: looks up the unapproved `brief_amendments` row, applies its `after` JSONB to the target Brief or Stage, sets `approved_at` + `approved_by_user_id`. Validates organisation membership and that the amendment is unapproved.

Both `SECURITY DEFINER`, `SET search_path = public`, RAISE on policy violation.

#### T-1.8 — Author Migration 076 — realtime publication + platform_config + Director config v1.4

`supabase/migrations/20260513000076_realtime_config_director_v1_4.sql`:

```sql
-- Realtime publication ADDs per TA §3.6
ALTER PUBLICATION supabase_realtime ADD TABLE briefs;
ALTER PUBLICATION supabase_realtime ADD TABLE brief_stages;

-- New config key
INSERT INTO platform_config (key, value, value_type, description) VALUES
  ('agent.director_conversation_window_turns', '10', 'integer',
   'Rolling window of most-recent Director conversation turns to include in the prompt. Older turns are dropped.');

-- Director config v1.4 — replaces v1.3 prompt body
UPDATE director_configs
SET system_prompt = $$<paste from prompts/director_v1_4_system_prompt.md>$$,
    config_version = '1.4',
    tool_suite = $$<v1.4 tool_suite JSON including get_brief_state + propose_brief + propose_brief_amendment>$$,
    updated_at = now()
WHERE id = (SELECT id FROM director_configs ORDER BY created_at DESC LIMIT 1);
```

#### T-1.9 — Apply migrations + regenerate types

```
supabase db push    # or apply individually with supabase db execute --file <path>
supabase gen types typescript --linked > lib/types/database.ts
```

Verify per H-10. `npm run type-check` must pass.

### 3.2 Library module — `lib/brief/`

#### T-2.1 — `lib/brief/types.ts`

TypeScript types mirroring the schema. Includes:
- `Brief` (row shape).
- `BriefStage` (row shape).
- `BriefAmendment` (row shape).
- `BriefStatePayload` — the §6.3 flattened response of `get_brief_state`.
- `BriefPreferences` — `{ voice?: string; constraints?: string[]; decisions?: string[]; named_entities?: Record<string,string>; }` with `Record<string, unknown>` fallthrough.
- `BriefProposal` — payload for `propose_brief` (full Brief shape).
- `BriefAmendmentProposal` — payload for `propose_brief_amendment` (delta shape: `{ amendment_type, target_path, before, after, reason }`).

#### T-2.2 — `lib/brief/preferencesValidator.ts`

Lightly-typed Zod validator for `BriefPreferences`. Called from every amendment-write path. H-18 mitigation.

Rules:
- `voice` is string if present.
- `constraints` is `string[]` if present.
- `decisions` is `string[]` if present.
- `named_entities` is `Record<string, string>` if present.
- Unknown top-level keys allowed (forward-compat); unknown nested shapes warn but don't reject (logged, surfaced in admin dashboard at V1.x-E).

#### T-2.3 — `lib/brief/getBriefState.ts`

Server-side reader. Takes `briefId` (UUID). Returns `BriefStatePayload`. Joins `briefs` + `brief_stages` + last 5 `brief_amendments`. Uses the server Supabase client (RLS-gated). Returns `null` if not found (caller maps to 404). Caches NOT applied — Brief read fresh on every Director turn.

#### T-2.4 — `lib/brief/proposalBuilder.ts`

Two pure functions:
- `buildBriefProposal(input)` — validates a `propose_brief` tool call, returns a `BriefProposal` artefact for the Director's `<brief_proposal>` block. Runs `preferencesValidator` on the input. Runs `detectStageTriggerCycles(stages)` per H-19.
- `buildBriefAmendmentProposal(input)` — validates a `propose_brief_amendment` tool call, returns a `BriefAmendmentProposal` artefact. Runs `preferencesValidator` on the `after` JSONB.

No DB writes — proposals are inert until user approves. H-08 discipline.

#### T-2.5 — `lib/brief/applyProposal.ts` + `lib/brief/applyAmendment.ts`

Thin wrappers around the SECURITY DEFINER RPCs from Migration 075. Used by the approval API routes. Both throw on RPC failure with structured errors mapped to HTTP 400/403/404.

#### T-2.6 — `lib/brief/cycleDetector.ts`

`detectStageTriggerCycles(stages: BriefStageInput[]): { ok: boolean; cycle?: string[] }`. DFS over `after_stage:N` and `compound` trigger dependencies. Returns the cycle path if found. H-19 mitigation.

### 3.3 Director tool registry

#### T-3.1 — `lib/director/tools/read.ts` — register `get_brief_state`

Add tool definition matching V2 doc §4.1. Input schema (auto-gen from Zod per Round-3 audit B6.1): `{ }` (no parameters — the Brief is scoped to the current document, which the executor already knows). Output: `BriefStatePayload`.

Server-side handler reads `documents.brief_id` for the current `document_id` in scope, then calls `getBriefState(brief_id)`.

#### T-3.2 — `lib/director/tools/write.ts` — register `propose_brief` + `propose_brief_amendment`

Two new write-proposal tools. Both produce artefacts only — no DB writes inside the agentic loop per H-08.

- `propose_brief` input: `{ goal_text, preferences, stages: [{ order, title, description, trigger_type, trigger_config? }] }`. Output: emits a `<brief_proposal>` content block via `buildBriefProposal`.
- `propose_brief_amendment` input: `{ amendment_type, target_path, after, reason }`. Output: emits a `<brief_amendment_proposal>` content block via `buildBriefAmendmentProposal`.

`input_schemas` auto-generated from Zod.

#### T-3.3 — Update `tool_suite` JSON in `director_configs` v1.4 (part of M-076)

Add the three new tool definitions to the tool_suite. Deprecate `get_conversation_history` per V2 doc §17.1 (was already flagged in Director V2 design; this is the implementation point).

### 3.4 Conversation rolling window

#### T-4.1 — Slice in `lib/director/executor.ts`

Where the executor currently fetches conversation history for the next turn, slice to the most recent N turns where `N = await getConfig('agent.director_conversation_window_turns')`. Turns are user+assistant pairs; the slice operates on conversation_messages.created_at DESC LIMIT 2*N (then re-ordered ASC for the prompt).

Default N=10 per Migration 076 seed. Adjustable per the V2 doc §12.3 calibration question.

#### T-4.2 — Sanity test

Vitest unit: seed 30 conversation_messages (15 turns), call executor's `assembleMessages()`, assert returned messages count ≤ 2*N.

### 3.5 API routes

#### T-5.1 — `GET /api/brief/[briefId]`

Auth required. RLS via server client. Returns `BriefStatePayload` JSON. 404 if not found / not visible.

#### T-5.2 — `POST /api/brief/proposals/[proposalId]/approve`

Auth required. Loads the unapproved `<brief_proposal>` artefact (stored in `conversation_messages` content as part of an assistant turn — same mechanism used for `<workflow_proposal>` today). Validates the user's organisation membership. Calls `applyProposal()` (RPC). Returns the updated `BriefStatePayload`.

#### T-5.3 — `POST /api/brief/amendments/[amendmentId]/approve`

Auth required. Loads the `brief_amendments` row by id. Validates org membership + unapproved status. Calls `applyAmendment()` (RPC). Returns the updated `BriefStatePayload`.

#### T-5.4 — `POST /api/conversations/[id]/clear`

Auth required. Deletes (or archives — TBD; recommend hard delete for now, simpler) all `conversation_messages` rows for the conversation. Does NOT touch `briefs` or `brief_stages`. Returns `{ cleared: N }`.

### 3.6 UI components

#### T-6.1 — `components/director/BriefViewer.tsx`

Per Component Spec v2.10 §17.2. Read-only project-header panel. Subscribes to `briefs` + `brief_stages` realtime channels for the current document. Renders:
- Goal text (Inter 400 14px, multi-line, 4-line truncate with "show more").
- Stage progress list (StageCard per stage).
- Preferences block (Inter 400 12px label / 13px value).
- Recent amendments log (Inter 300 11px muted, last 5).

Empty Brief (no goal_text yet) shows a placeholder: "No project goal set yet. The Director will propose one when you describe what you want to work on."

#### T-6.2 — `components/director/StageCard.tsx`

Per Component Spec v2.10 §17.3. Nested in BriefViewer. Status badge + trigger type indicator + optional linked-workflow detail.

**Important V1.x-A note:** the `Approve` button on `proposed` status is implemented but won't fire in V1.x-A because stage-trigger-invokes-Director (V2 doc §8.4) is V1.x-B. The button can be wired to call `POST /api/brief/stages/[id]/approve` which marks the stage as `approved` but takes no action beyond that — the actual workflow proposal-and-dispatch happens once V1.x-B's scheduler lands. Verdigris use #7 applies to the button.

#### T-6.3 — `components/director/BriefProposalCard.tsx`

New component (no prior equivalent — analogous to PlanCard but for Brief proposals). Rendered in the DirectorPanel conversation thread when an assistant message contains a `<brief_proposal>` artefact.

Surface:
- Goal text preview.
- Stage list preview (each stage: order, title, brief description, trigger type).
- Preferences preview (voice, constraints, decisions).
- Single Approve button (verdigris use #7).
- Secondary "Show details" link to expand all fields.

On Approve: `POST /api/brief/proposals/[id]/approve`. On success: the BriefViewer in the project header updates via realtime; the BriefProposalCard collapses to a "Brief approved" marker.

Same pattern for `<brief_amendment_proposal>`: a `BriefAmendmentCard` (or shared component with a variant flag).

#### T-6.4 — `components/director/ConversationClearButton.tsx`

Per Component Spec v2.10 §17.10. Mounts in DirectorPanel header. Confirmation dialog text exactly: *"Clearing will discard recent conversation but keep your project Brief and document. Continue?"* On confirm: `POST /api/conversations/[id]/clear`. UI: refresh conversation thread (now empty), keep Brief visible.

#### T-6.5 — Mount BriefViewer in the project header

`app/(app)/projects/[projectId]/documents/[documentId]/layout.tsx` (or equivalent) — add BriefViewer above the existing header content. Behaviour for documents with empty Brief: render the placeholder per T-6.1.

### 3.7 Tests

#### T-7.1 — Vitest unit tests

- `lib/brief/preferencesValidator.test.ts` — schema rejects/accepts cases, unknown-key passthrough.
- `lib/brief/cycleDetector.test.ts` — finds cycles in after-stage and compound triggers; clean DAGs pass.
- `lib/brief/proposalBuilder.test.ts` — proposal artefacts well-formed; invalid prefs rejected.
- `lib/director/executor.rolling-window.test.ts` — window slicing.

#### T-7.2 — Playwright integration tests

- `tests/v1x-a/brief-auto-create.spec.ts` — every newly created document has a Brief (via the migration backfill AND via the modified `create_document_with_layer_stack` RPC for fresh creates).
- `tests/v1x-a/brief-proposal-flow.spec.ts` — Director proposes Brief on first macro-intent → user approves → DB writes correctly.
- `tests/v1x-a/brief-amendment-flow.spec.ts` — durable preference promoted via amendment.
- `tests/v1x-a/conversation-clear.spec.ts` — Clear button discards conversation, retains Brief.
- `tests/v1x-a/brief-viewer.spec.ts` — Brief renders correctly in header; updates via realtime.

#### T-7.3 — Backward-compatibility regression

Re-run `tests/director/j5-director-turn.spec.ts` + the V1.x-LB variety verification + Phase 5b/5c regression to confirm Director executor changes didn't break existing flows.

### 3.8 Close-out

#### T-8.1 — Test Report

Author `docs/stelavox_v1x_a_test_report_v1_0.md` recording each CK as PASS/FAIL + any SU items raised in the build.

#### T-8.2 — CLAUDE.md v1.23 bump

Add v1.23 entry: "V1.x-A shipped — Brief + Stage substrate." Update "Current phase tasks" cell to flag V1.x-A as shipped + V1.x-B as next. Bump master HEAD reference.

#### T-8.3 — Spec absorption check

- Director Architecture v2.0.2 — likely no version bump; V1.x-A is the first implementation of §6 design.
- TA v2.3.1 — possible §3.6 amendment if migration numbers differ from the doc's table-shape entries.
- Product Spec v1.9 — §11.10 V1.x-A row gains shipped-status marker.
- Component Spec v2.10 — no version bump expected; v2.10 §17.2/§17.3/§17.10 already document V1.x-A surfaces.
- Agent Profile Library v1.3 — no change (V1.x-A introduces no new agent profiles).

#### T-8.4 — Memory updates

- New project memory `project_v1x_a_shipped.md` mirroring the `project_v1x_lb_shipped.md` pattern.
- Update `MEMORY.md` index hook.
- Mark `project_v1x_lb_shipped.md` "Next code phase" line as superseded (V1.x-B is now next).

#### T-8.5 — Merge

Single merge commit `v1.x-a-brief → master`. PR title under 70 chars. Hook execution clean. Master HEAD becomes the V1.x-A close-out.

---

## 4. Changelog

**v1.0 — 2026-05-13** Initial version. Frozen for V1.x-A build. Scope per CLAUDE.md v1.22 + Director Architecture v2.0.2 §16.1.
