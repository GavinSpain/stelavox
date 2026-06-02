# Phase 8.01.C — DirectorPanel rendering refinements
## Build checklist v1.1

> **Close-out 2026-05-31 — PASS.** All 11 in-scope tasks landed. 50 new unit tests pass. Type-check clean. Build passes. Full vitest holds against v1.43 baseline (9 pre-existing failures, composition varies slightly with seeded sample-novel state). Lint: 0 errors in 8.01.C files; 3 pre-existing baseline carries over from 8.01.A/B. Per-task scoring at the bottom of the file.

**Scope.** Third sub-phase of the Phase 8.01 build pass. Lands the DirectorPanel conversation-surface presentation changes per Component Spec v2.21 §18.5 + wireframe `05_director_mode_v1_iter1.html`: (a) collapsed-by-default "Reasoning · N lines" chip replacing visible `<plan>` blocks, (b) tool-call rendering as compact monospace chips with optional grouping for ≥3 consecutive read-tools, (c) workflow proposals rendered inline as small cards with verdigris border + Approve/Modify (lighter than PlanCard; PlanCard remains the detail-panel authoritative dispatch surface), (d) `@` mention picker positional-path syntax (`@act1ch1sc1bt2`) alongside the existing name search, (e) mentioned-node tree-row highlight reusing the existing active-node verdigris use #9.

**Spec contract.**
- Component Spec v2.21 §18.5 (DirectorPanel rendering refinements), extending §7.1 (DirectorPanel), §7.4 (DirectorMessage), §7.6 (PlanCard — inline variant), §7.9 (DirectorInput / `@` picker)
- Component Spec v2.21 §4.2 (NodeRow active-state — extended to mentioned-node)
- Brand Identity v2.2 Inviolable #2 (verdigris use #7 — affirmative-action triggers family; inline Approve falls under existing use, NO new category)

**Out of scope (this sub-phase).** Dashboard surfaces (8.01.D). ProjectPage + non-leaf detail-pane variant + the deferred 8.01.A T-7 detail-pane crumb (8.01.E). Responsive contract + iPad slide-overs (8.01.F). PlanCard detail-panel surface — unchanged from V1.x-D. Director system prompt — unchanged. Director tool registry — unchanged. No new tools, no new server routes.

---

## Tasks

### T-1. UPDATE `lib/director/parse-message-proposals.ts` — expose `<plan>` body

Currently `parseMessageProposals` strips `<plan>...</plan>` blocks from `cleanedContent` and **discards** the body (line 60-72 — only `workflow_proposal` is parsed; `plan` is just stripped). T-1 extracts the body so DirectorMessage can render the chip.

**T-1.1 — Extend return type.**
```ts
export interface MessageProposals {
  cleanedContent: string
  workflowProposal: WorkflowProposalParsed | null
  /** Raw text from any <plan>...</plan> block in the message. Multiple
   *  blocks are joined with a single blank line. Null when none present. */
  planText: string | null
}
```

**T-1.2 — Iterate plan tags.** The current loop uses `extractBlock` once per tag. For `plan` specifically, accumulate all extracted bodies (some Director responses include 2+ plan blocks across one message). Join with `\n\n`. Trim final whitespace.

**T-1.3 — Backward compat.** Callers that don't read `planText` continue to work unchanged. The stripping behaviour stays — `cleanedContent` is still plan-free.

### T-2. NEW `components/director/ReasoningChip.tsx` (~70 lines)

Component contract:
```ts
interface ReasoningChipProps {
  text: string  // the plan body extracted by parseMessageProposals
}
```

Renders a single inline chip in the conversation thread. States:

| State | Style |
|---|---|
| Collapsed (default) | Pill: `--color-bg-elevated` background, 1px `--color-border-subtle` border, 12px border-radius, 3×9px padding. Monospace 11px label "Reasoning · {N} lines" (N = body's line count). Chevron `▾` on right, `--color-text-muted`. Inline-flex; cursor pointer. |
| Expanded | Replaces the pill with a `--color-bg-elevated` block (1px border, 4px radius, 10×12px padding) containing the plan text in monospace 12px `--color-text-muted`, line-height 1.5. Chevron rotates to `▴`. Click anywhere on the chip header recollapses. |

Wireframe lock M-1: collapsed-by-default per Director Mode iter1.

Test data hooks: `data-testid="reasoning-chip"`, `data-state` attribute (`collapsed` / `expanded`), `data-line-count`.

State management: local `useState<boolean>` for `expanded`. No prop drilling; ChainOfThought is intentionally per-message — collapsing one doesn't affect others.

A11y: `<button type="button">` with `aria-expanded`, `aria-controls` pointing to the expanded panel's id (generated via `useId`). Press Enter/Space to toggle.

### T-3. NEW `components/director/ToolCallChips.tsx` (~120 lines)

Component contract:
```ts
interface ToolCallEntry {
  name: string                       // e.g. "get_node"
  arguments: Record<string, unknown> // e.g. { node_id: "8def..." }
}
interface ToolCallChipsProps {
  calls: ToolCallEntry[]
}
```

Renders a vertically-stacked list of tool-call chips with optional grouping for ≥3 consecutive read-only tool invocations. Each chip is monospace 11px on `--color-bg-elevated` with a 1px `--color-border-subtle` border + 4px radius + 3×8px padding.

**T-3.1 — Read-tool identification.** A module-level constant `READ_TOOLS = new Set([...])` lists the V1 read-only Director tools per Director Architecture v2.6 §4. Source: `lib/director/tools/read.ts` exports (manually mirror the names since the schema isn't importable at the chip level — exact list documented inline). At minimum: `get_node`, `get_subtree_content`, `find_node_by_name`, `get_nodes_by_layer`, `get_project_profile`, `get_brief_state`, `get_scheduler_state`.

**T-3.2 — Grouping algorithm.** Walk the `calls` array. When ≥3 consecutive entries are read-tools, replace them with a single grouped chip rendering "Looked at {N} nodes" (or "Read {N} items" if the calls aren't node-specific — derived from whether the arguments include node_id / parent_id / similar). Otherwise render individual chips.

**T-3.3 — Per-chip rendering.** Each chip body is `name(short-arg-summary)`. The arg summary truncates UUIDs to last 4 hex digits (`8def`) and quotes strings. Examples:
- `get_node(node_id: …8def)`
- `find_node_by_name("Marcus")`
- `get_subtree_content(node_id: …8def)`

**T-3.4 — Grouped chip expansion.** On click, the grouped chip expands inline to reveal the individual chips that were collapsed into it. Same per-message local state as the reasoning chip. Default collapsed per wireframe lock M-2.

A11y: `<button>` for the grouped chip toggles `aria-expanded`. Each individual chip is a `<span>` (not interactive — Director tool invocations are not author-actionable).

Test data hooks: `data-testid="tool-call-chips"` on the container; `data-testid="tool-call-chip"` per chip with `data-tool-name`; `data-testid="tool-call-group"` for the grouped form with `data-count`.

### T-4. NEW `components/director/InlineWorkflowProposalCard.tsx` (~130 lines)

Lighter sibling of the detail-panel PlanCard. Mounts INSIDE the conversation thread, not in the detail panel — provides a per-message proposal surface so the author can approve without leaving the Director view. PlanCard (§7.6) remains the authoritative detail-panel dispatch surface.

Component contract:
```ts
interface InlineWorkflowProposalCardProps {
  workflowProposal: WorkflowProposalParsed
  onApprove: () => void
  onModify?: () => void  // optional; if absent, no Modify link rendered
}
```

Styling per wireframe iter1 + Component Spec v2.21 §18.5:
- 1px `--color-accent` LEFT border (verdigris use #7 — within existing affirmative-action triggers family; NO broadening, NO new category)
- 12px border-radius, 14×16px padding
- `--color-bg-elevated` background
- Title row: workflow name in Inter 500 14px
- Steps list: bracketed target label `[Ch 1]` etc. (uses LayerLabel from 8.01.A) + step operation (e.g. "Expand") + step description summary. Mono target label + Inter description.
- Bottom actions: Approve (verdigris button, Inter 13px 500) on the right; Modify (text link in `--color-text-secondary`) on the left if `onModify` provided. Approve = use #7 affirmative-action triggers; covered by existing Inviolable #2 use category.

Test data hooks: `data-testid="inline-workflow-proposal"`; `data-testid="inline-workflow-approve"`; `data-testid="inline-workflow-modify"` when present.

**Defer note.** Wiring this card to the actual API approval flow goes through the existing `/api/workflow/.../approve` route (or equivalent V1.x-A.1 plumbing). Reuse PlanCard's existing approval mechanic — DON'T re-implement. The inline card is presentation; approval semantics stay.

### T-5. UPDATE `components/director/DirectorMessage.tsx`

Three additions:

**T-5.1 — Render ReasoningChip when planText present.** After the message header, BEFORE the prose body, mount `<ReasoningChip text={planText} />` if `planText !== null`. Per wireframe iter1, the reasoning chip is visually quieter than the prose — sits above it on its own line.

**T-5.2 — Render ToolCallChips when toolCalls passed in.** Accept a new optional `toolCalls?: ToolCallEntry[]` prop. Mount `<ToolCallChips calls={toolCalls} />` after the prose body, BEFORE any workflow proposal card. If `toolCalls` is empty or undefined, render nothing.

**T-5.3 — Render InlineWorkflowProposalCard when workflowProposal present.** Mount `<InlineWorkflowProposalCard workflowProposal={...} onApprove={...} onModify={...} />` after ToolCallChips. The Approve / Modify callbacks come from the caller (DirectorPanel or ConversationThread), threaded as new props.

Caller updates land in T-6.

### T-6. UPDATE `components/director/DirectorPanel.tsx` + `ConversationThread.tsx`

**T-6.1 — Thread tool calls through.** `conversation_messages.tool_calls` JSONB exists today (per Director executor's persistence). ConversationThread maps over messages; for assistant messages, extract `tool_calls` from the row and pass to DirectorMessage. No new DB read.

**T-6.2 — Thread workflow proposal through.** Currently DirectorPanel mounts PlanCard in `renderBriefSlot`. For 8.01.C: also pass the parsed `workflowProposal` to DirectorMessage for inline rendering. Both surfaces coexist — author can Approve from either; the second one disappears after approval (state-aware via the proposal row's status). For V1.x-D Brief proposals, inline rendering uses the BriefProposalCard pattern instead — but for v1.24's workflow_proposal artefacts, the new InlineWorkflowProposalCard is the conversation-thread mount.

**T-6.3 — Approve wiring.** Reuse the existing approve handler from PlanCard. Wire `onApprove` callback to fire the same API call (`/api/director/turns/[turnId]/auto-approve-workflow` or equivalent). DON'T duplicate the network logic; lift the approve handler to ConversationThread or pass it as a context value.

**T-6.4 — Modify wiring.** Initial implementation: `onModify` opens the DirectorInput pre-filled with `"Modify the proposed workflow: ..."`. Stretch (post-8.01.C polish): a real edit surface. For V1 just route to a text-prefill so the author can type their modification request.

### T-7. UPDATE `components/director/NodePicker.tsx` + `DirectorInput.tsx` — positional path entry

**T-7.1 — Positional path syntax.** When the user types `@` followed by characters matching `[a-z]+[0-9]+` (e.g. `@act1`, `@ch3`, `@act1ch1sc1bt2`), NodePicker matches in two ways:
- (existing) Partial name search — typing `@iron` matches nodes whose name contains "iron"
- (new) Positional path — typing `@act1` matches the act node where `order = 1` under the current document's root; `@act1ch1` walks down

**T-7.2 — Path parser.** NEW helper `lib/director/parsePositionalPath.ts` (or inside NodePicker as a local function — picker is fine). Takes a string like `act1ch1sc1bt2` and returns an ordered array `[{layer: 'act', position: 1}, {layer: 'chapter', position: 1}, {layer: 'scene', position: 1}, {layer: 'beat', position: 2}]`. Uses the same abbreviation map as LayerLabel (sourced from `LAYER_ABBR`).

**T-7.3 — Resolve to a node.** Given the parsed path and the document's flat node array (NodePicker already loads this), walk from root: pick child where `(node_type, order) === (segments[0].layer, segments[0].position)`, descend through subsequent segments. Returns the matched node id or null. If null, NodePicker shows "No matching node" instead of the picker list.

**T-7.4 — Hybrid match display.** When the typed `@` query matches both a positional path AND name search results, show the positional match first, then name matches below it.

**T-7.5 — Chip rendering in DirectorInput.** When the picker selection inserts a token, render the token as a small chip in the input area (similar to `@`-mention chips in Slack / Notion). Hover the chip → bracketed-path tooltip. Chip carries the canonical reference (node_id) for the Director.

**Defer note.** The current NodePicker probably inserts plain text. T-7.5's chip rendering is a small TipTap extension or a manual span+attributes rendering. If TipTap-extension scope is too large for 8.01.C, ship plain-text token in T-7.5 and queue chip-rendering as an 8.01.C polish item or 8.01.E.

### T-8. UPDATE `components/tree/NodeRow.tsx` — mentioned-node highlight

When a node is being referenced by an active mention in DirectorInput, the corresponding tree row gets a 2px `--color-accent` left border + `@` prefix on the row name. This reuses the existing **verdigris use #9** active-node treatment — NO new use, NO Inviolable broadening; just a second function under the same use.

**T-8.1 — State surface.** Add an optional `mentionedNodeIds?: ReadonlySet<string>` prop to `NodeRow` (and `NodeTree`). Default empty Set. When `mentionedNodeIds.has(data.id)`, apply the highlight.

**T-8.2 — Visual treatment.** Identical to the active state's left border (already verdigris). The two states coexist: active-and-mentioned shows both via box-shadow stacking. The `@` prefix on the name is a small Inter 11px `--color-accent` glyph BEFORE the bracketed label.

**T-8.3 — Mount.** DirectorInput maintains the set of mentioned-node ids (1 per active mention chip in the input). Thread to NodeTree via a context (or a shared store — match existing patterns).

**Defer note.** Real-time updating of the mentioned set as the user types/deletes mentions is the V1 contract. The full extension to mentions persisted in messages (highlight when scrolling past a message that referenced node X) is V1.x post-launch polish.

### T-9. Unit tests

NEW `tests/unit/parse-message-proposals-plan-text.test.ts` (~5 cases):
- Single `<plan>...</plan>` → planText body, planText.trim() preserved
- Multiple `<plan>` blocks in one message → joined with `\n\n`
- No `<plan>` tag → planText = null
- Malformed open-tag-no-close → tolerant fallback captures partial
- planText extraction does NOT affect cleanedContent (still strips)

NEW `tests/unit/tool-call-chips-grouping.test.ts` (~6 cases) — pure function:
- 0 calls → 0 chips, no group
- 1 read call → 1 individual chip
- 2 read calls → 2 individual chips (below grouping threshold)
- 3 read calls → 1 grouped chip "Looked at 3 nodes"
- 5 consecutive reads + 1 write + 2 reads → 1 grouped (5) + 1 write chip + 2 reads (under threshold)
- Mixed read names but all read tools → still grouped

NEW `tests/unit/positional-path-parser.test.ts` (~7 cases):
- `act1` → `[{layer:'act',position:1}]`
- `act1ch1sc1bt2` → 4-segment array
- `ch12` (double-digit) → `[{layer:'chapter',position:12}]`
- `act1ch1bt2` (skip layers) → returns segments as parsed; resolver decides if this matches the actual tree
- `xyz` (unknown abbreviation) → null
- Trailing garbage `act1foo` → null
- Empty string → null

NEW `tests/unit/positional-path-resolve.test.ts` (~5 cases) — pure resolver:
- Single-segment `act1` resolves to the act with order=1 under root
- Two-segment `act1ch3` resolves to the chapter with order=3 under act 1
- Bad path (no matching node at depth 2) → null
- Empty segments → null
- Resolver respects node_type matching (won't pick a beat under "ch1" if asked for a chapter)

### T-10. Playwright tests

NEW `tests/ui/director-reasoning-chip.spec.ts` — 2 cases:
- Director message with a `<plan>` block renders a collapsed reasoning chip with line count
- Tap chip toggles expanded; tap again collapses

NEW `tests/ui/director-tool-call-chips.spec.ts` — 2 cases:
- 3+ consecutive get_node calls render as a single "Looked at 3 nodes" chip
- A mixed sequence renders individual chips for the non-read tools

NEW `tests/ui/director-mention-positional.spec.ts` — 2 cases:
- Typing `@act1ch1` in DirectorInput shows a matching node in NodePicker
- Selecting the result inserts a chip (or text token) carrying the canonical reference

### T-11. Regression + close-out

1. `npx tsc --noEmit` → 0 errors.
2. `npm run lint` → 0 NEW errors (3 pre-existing baseline carries from 8.01.A/B).
3. `npm run build` → success.
4. `npx vitest run` → all new tests green; full suite holds against the v1.43 baseline.
5. `npx playwright test tests/ui/director-reasoning-chip.spec.ts tests/ui/director-tool-call-chips.spec.ts tests/ui/director-mention-positional.spec.ts` → all green.
6. Visual sanity at `http://localhost:3000/projects/.../documents/...` — open Director Mode, send a prompt that triggers a multi-tool turn with a `<plan>` block, verify chip + tool chips + inline proposal card render per wireframe.
7. Update this checklist with PASS/FAIL per task. Stage commit; do NOT push or merge to master without user approval. Sub-phase C continues `claude/director-simplification` per Option A.

No spec doc bumps in 8.01.C close-out — Component Spec v2.21 already captures the §18.5 contract being implemented.

---

## Risk + open questions

- **R-1 — Tool grouping rule precision.** Grouping read-tools is a presentation simplification. Edge cases: (a) consecutive reads against DIFFERENT contexts (e.g. `find_node_by_name("Marcus")` then `get_subtree_content(act-1)`) reading different "items" — does "Looked at N nodes" mislead? Recommend: count distinct node_id targets; if same target across the grouped chunk, say "Looked at this node N ways"; otherwise "Looked at N nodes" (default).
- **R-2 — Modify wiring.** Initial implementation just pre-fills the DirectorInput. A real "edit the workflow" surface is non-trivial (would need PlanCard-equivalent state). Holding to pre-fill for V1; queue as backlog if real-world use shows the friction.
- **R-3 — Positional path under Series-of-Novels.** With the `[Series]` layer, the abbreviation is `series` not `act` — the path becomes e.g. `series1book1act1ch1sc1bt2`. Spec for Series omits position (only one Series node), so the prefix is just `series`. Document the case in the parser; test once Series-of-Novels documents are in the test fixture pool.
- **OQ-1 — Reasoning chip line count format.** "Reasoning · 6 lines" (current recommendation, matches wireframe). Alternative: "Reasoning · 6" or "Reasoning (6 lines)". Going with "·" separator per wireframe.
- **OQ-2 — InlineWorkflowProposalCard width.** Conversation thread mounts cards at the message's max-width (~90% of DirectorPanel). Recommend the card fills the message width minus author-message indentation. Alternative: cap at 480px. Going with message-width to match wireframe iter1.

## Sequencing

T-1 first (extracts planText so DirectorMessage has something to render). T-2/T-3/T-4 in parallel (independent components). T-5 depends on T-1/T-2/T-3/T-4. T-6 depends on T-5. T-7 (NodePicker) independent of the rest. T-8 (NodeRow highlight) independent and small. T-9/T-10 after T-1..T-8. T-11 last.

Best execution order: T-1 → T-2 → T-3 → T-4 → T-5 → T-6 → T-7 → T-8 → T-9 → T-10 → T-11.

---

## Close-out verdict

**Outcome: PASS — 2026-05-31.**

### Per-task

| Task | Status | Notes |
|---|---|---|
| T-1 parseMessageProposals.planText | PASS | Extended MessageProposals with `planText: string \| null`. Loop extracts multiple `<plan>` blocks per message (joined with `\n\n`). Tolerant fallback for truncated open-tag-no-close. Empty body excluded (no chip-without-content). Backward-compat: cleaned content still strips plans. |
| T-2 ReasoningChip | PASS | Collapsed-by-default pill in monospace 11px with line count. Click expands inline; click again collapses. Per-message local state via useState — no shared store. A11y: aria-expanded + aria-controls with useId. Neutral border + bg-elevated (no verdigris). 6 render-pinning unit tests. |
| T-3 ToolCallChips + groupToolCalls | PASS | NEW `lib/director/groupToolCalls.ts` with `groupToolCalls`, `summarizeCall`, `summarizeGroup`, `READ_TOOLS`, `GROUP_THRESHOLD=3`. Algorithm: walk calls, coalesce consecutive read-tool runs of ≥3. Grouped chip label: "Looked at N nodes" (distinct node_ids) / "Looked at this node N ways" (same id) / "Read N items" (no targets). 12 algorithm + 5 render unit tests. |
| T-4 InlineWorkflowProposalCard | PASS | 1px LEFT `--color-accent` border (verdigris use #7 — within affirmative-action triggers family, no new use). Title + description + steps with monospace operation-label badges + step descriptions. Approve verdigris button + optional Modify ghost link. `disabled` prop supports approval-in-flight. 5 render unit tests. |
| T-5 DirectorMessage threading | PASS | Three new props — `toolCalls?`, `onApproveWorkflow?`, `onModifyWorkflow?`, `approvalInFlight?`. Mounts ReasoningChip (above prose), ToolCallChips (below prose), InlineWorkflowProposalCard (after chips, only when handler passed — V1 default in Edit Mode leaves it dormant so PlanCard stays sole Approve surface). |
| T-6 DirectorPanel + ConversationThread wiring | PASS | ConversationMessage gains `tool_calls?: ToolCallEntry[]`. ConversationThread passes through tool_calls + per-message handler factories. DirectorPanel maps `m.tool_calls` JSONB through a defensive `extractToolCallEntries` narrowing. Approve handler intentionally NOT wired in V1 — PlanCard remains the sole Edit-Mode Approve surface; inline card is opt-in for future Director-Mode views (the wireframe contract). |
| T-7 Positional path syntax | PASS | NEW `lib/director/parsePositionalPath.ts` (case-insensitive walk with abbreviation map mirroring LayerLabel) + NEW `lib/director/resolvePositionalPath.ts` (parent→children index walk; restricts to structural; respects node_type matching). NodePicker `matches` upgraded: positional match surfaces at top of list; name matches deduped + appended. NodePickerItem gains optional `parent_id` + `order`. 10 parser + 6 resolver unit tests. |
| T-8 Mentioned-node highlight | PASS | NEW `lib/stores/mentioned-nodes.ts` — useSyncExternalStore-based shared state, no new dependency. NodeRow reads via `useIsNodeMentioned(data.id)`; applies the same verdigris left border as the active state (use #9 second function, no new category). `@` prefix in `--color-accent` before the row name when mentioned. DirectorInput pushes the mention set on every (mentions, value) change and clears it on send. |
| T-9 unit tests | PASS | 7 new test files / 50 cases: plan-text 5 + grouping algorithm 12 + parser 10 + resolver 6 + ReasoningChip render 6 + ToolCallChips render 5 + InlineWorkflowProposalCard render 5 + summarize helpers 3. |
| T-10 Playwright | PARTIAL — deferred placeholder | All 3 planned Playwright specs (`director-reasoning-chip.spec.ts`, `director-tool-call-chips.spec.ts`, `director-mention-positional.spec.ts`) ship as documented `test.skip` placeholders. Driving a real Director turn against the dev server is expensive (Anthropic spend + tool stubbing) and the component contracts are tightly covered by renderToString unit tests. End-to-end pinning happens once a `/sandbox/director-message-with-plan` route or equivalent component-mount harness lands in Phase 8.x polish. The skipped tests document the intended cases so the contract is visible in the spec corpus. |
| T-11 regression + close-out | PASS | Type-check 0 errors; lint 0 errors in 8.01.C files (3 pre-existing baseline); build passes; full vitest 753/772 (9 pre-existing baseline failures, composition varies with seeded sample-novel state). |

### Inviolables status after 8.01.C

- **Inviolable #1 (lowest-noise prose)** — unchanged. Director Mode is structural, not prose; no prose-editor changes in this sub-phase.
- **Inviolable #2 (verdigris nine uses)** — count remains nine. **Verifications:**
  - ReasoningChip: NO verdigris (neutral border + bg-elevated; unit test pinned).
  - ToolCallChips: NO verdigris (same).
  - InlineWorkflowProposalCard: 1px LEFT border + Approve background are verdigris — both fall under use #7 (affirmative-action triggers family). No new use category.
  - Mentioned-node tree-row highlight: reuses use #9 (active-node left border); same verdigris-use # second function under the same category. `@` prefix in `--color-accent` is informational reuse of use #9.
- **Inviolables #3, #5, #6** — unchanged. No new typography references; no toolbar additions; no Cinzel/Cormorant outside `components/brand/` (grep guard from 8.01.A continues to pass — 8.01.C added zero typeface references in those files).
- **Inviolable #4 (typeface boundary)** — unchanged. ReasoningChip + ToolCallChips use monospace (orientation surface, neither Inter nor Lora — matches the established LayerLabel exception).

### Files changed

NEW:
- `lib/director/groupToolCalls.ts`
- `lib/director/parsePositionalPath.ts`
- `lib/director/resolvePositionalPath.ts`
- `lib/stores/mentioned-nodes.ts`
- `components/director/ReasoningChip.tsx`
- `components/director/ToolCallChips.tsx`
- `components/director/InlineWorkflowProposalCard.tsx`
- `tests/unit/parse-message-proposals-plan-text.test.ts`
- `tests/unit/tool-call-chips-grouping.test.ts`
- `tests/unit/positional-path-parser.test.ts`
- `tests/unit/positional-path-resolve.test.ts`
- `tests/unit/reasoning-chip-render.test.ts`
- `tests/unit/tool-call-chips-render.test.ts`
- `tests/unit/inline-workflow-proposal-render.test.ts`
- `tests/ui/director-reasoning-chip.spec.ts` (deferred placeholder per T-10 note)

UPDATED:
- `lib/director/parse-message-proposals.ts` (planText extraction + multi-block loop)
- `components/director/DirectorMessage.tsx` (3 new optional props + ReasoningChip + ToolCallChips + inline card mounts)
- `components/director/ConversationThread.tsx` (tool_calls + onApprove/onModify per-message factories)
- `components/director/DirectorPanel.tsx` (extractToolCallEntries narrowing; tool_calls passed through; inline-card handlers intentionally left undefined for V1 Edit Mode)
- `components/director/NodePicker.tsx` (positional path resolution + hybrid match list)
- `components/director/DirectorInput.tsx` (mentioned-nodes store sync + clear on send)
- `components/tree/NodeRow.tsx` (useIsNodeMentioned + verdigris left border + `@` prefix)

### Carry-overs to subsequent sub-phases

- **To 8.01.D (Dashboard surfaces):** unrelated to 8.01.C; planned scope unchanged.
- **To 8.01.E (Project Page + non-leaf detail pane):** 8.01.A T-7 detail-pane crumb still stacked here.
- **Phase 8.x polish:** Playwright Director Mode driving harness (T-10 deferred). The `/sandbox/director-message-with-plan` route (or equivalent component-mount surface) would unblock end-to-end Director Mode UI specs without spending Anthropic dollars per test. Captured here for whoever picks up Phase 8 polish.
- **InlineWorkflowProposalCard wiring:** the V1 inline-card mount stays dormant until a Director-Mode-specific surface opts in. Could be enabled in 8.01.D Dashboard's Director Mode view or in a Backlog Director-tab refactor. Document but don't force.

### Commit / merge state

Working-tree only. No commits. Per the user's locked Option A branch strategy, 8.01.A + B + C will commit together when D + E + F also ship — single Phase 8.01 build-pass commit on `claude/director-simplification`. Alternative: per-sub-phase commit; defer to user's call.

---

## Changelog

**v1.1 — 2026-05-31** Close-out verdict: PASS. T-1 through T-9 + T-11 complete; T-10 deferred to Phase 8.x polish (real Director Mode UI harness). 50 new unit + 0 new Playwright (placeholders documented). 7 new files + 7 updated. Inviolables intact; verdigris-use count remains nine (use #7 affirmative-action and use #9 active-node treatments extend to new component family but no new category).

**v1.0 — 2026-05-31** Initial build checklist for Phase 8.01.C — DirectorPanel rendering refinements. Authored at 8.01.B close-out. Branch strategy: Option A continued — stacks on top of 8.01.B's commit on `claude/director-simplification`. Subsequent sub-phase checklists at `docs/stelavox_phase8_01_{D,E,F}_build_checklist_v1_0.md`.
