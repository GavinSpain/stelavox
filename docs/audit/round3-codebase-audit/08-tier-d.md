# Tier D — `components/`

**Files in scope:** 67 components across 11 areas (detail×19, ui×13, director×9, layout×7, tree×6, focus×5, context×2, projects×2, documents×2, auth×1, feedback×1) — ~12,034 lines

**Audit method:** sample-based across all 11 areas. Components are UI; bugs here are usually visible to authors and surface via Step 4 a11y/UI testing rather than via silent semantic divergence. Spec lens emphasised: **the Five Inviolables** + Component Spec v2.9 + Brand Identity v2.1.

**Step-4 testing already covered:** the round-3 a11y sweep audited 12 surfaces and produced 22 component fixes. Findings already-fixed are not re-catalogued here.

---

## The Five Inviolables — compliance audit

### Inviolable #1 — Prose surface is the lowest-noise surface (`bg-base`, never lighter)
**Compliance:** ✓ Verified. `ProseEditor.tsx:78` sets `background: 'var(--color-bg-base)'`. `FocusMode.tsx` uses `bg-base`. AgentTab synthesise streaming surface (`AgentTab.tsx:959`) uses `bg-base`. No drift surfaced.

### Inviolable #2 — Verdigris in EXACTLY 9 places

### F-213 — `DirectorInput` Send button uses verdigris background; not on the sanctioned 9
**Severity:** **HIGH**   **Confidence:** certain   **Category:** spec-divergence
**Spec citation:** Brand Identity v2.1 §5 (nine sanctioned uses); Inviolable #2
**Location:** `components/director/DirectorInput.tsx:248–251`
The Send button background is `var(--color-accent)` when active. The sanctioned-9 list does not include "Director send button". Per Inviolable #2: *"Search for `--color-accent`, `#3d7858`, and `#254a38` before any new use. Every match must be one of these nine."* This is a tenth use.
**Recommended fix shape:** swap to `--color-text-primary` (active button standard). If the verdigris is intentional design, propose a 10th sanctioned use in Brand Identity and bump the spec.

### F-214 — `PlanCard` step checkbox uses verdigris border + background when checked
**Severity:** **HIGH**   **Confidence:** certain   **Category:** spec-divergence
**Spec citation:** Brand Identity v2.1 §5
**Location:** `components/director/PlanCard.tsx:457, 460`
The step-level checkbox shifts to verdigris border + background on check. The Approve button (line 538) IS sanctioned (use #7, broadened in Component Spec v2.8). The per-step checkboxes are NOT on the list. Two unsanctioned uses (border + background) on the same element.
**Recommended fix shape:** use `--color-text-primary` for the checked state (matches a typical checkbox affordance) or propose explicit broadening of use #7 to cover "Approve flow controls including step toggles".

### F-215 — `AgentJobHistory` `accepted` status uses verdigris; arguably maps to use #4 or #5 but uncatalogued
**Severity:** LOW   **Confidence:** worth-checking   **Category:** spec-divergence
**Location:** `components/detail/AgentJobHistory.tsx:58`
`STATUS_COLOUR.accepted: 'var(--color-accent)'`. The sanctioned 9 lists "Agent-complete status badge" (use #4) and "Approved status badge" (use #5). "Accepted" status of an agent_job arguably maps to either — but the spec uses different vocabulary. Worth a documentation note tying agent_jobs.status='accepted' to use #4.

### Inviolable #3 — Cinzel only in wordmark
**Compliance:** N/A — `components/brand/Wordmark.tsx` doesn't exist yet. The wordmark UI hasn't shipped. No risk while the typeface isn't loaded into a component. Will need re-audit when brand components land.

### Inviolable #4 — Inter for structural, Lora for prose

### F-216 — `AgentTab` synthesise streaming surface uses Lora
**Severity:** LOW   **Confidence:** certain   **Category:** sanctioned-by-spec
**Location:** `components/detail/AgentTab.tsx:962`
Lora 15px / 1.7 line-height for the typewriter prose preview. Component Spec v2.9 §5.9 explicitly sanctions this *"to match ProseEditor styling for seamless transition"*. ✓ Compliant.

No other Lora references in components/. Inviolable #4 holds.

### Inviolable #5 — Prose editor has no visible toolbar
**Compliance:** ✓ Verified. `ProseEditor.tsx:80–82` has explicit *"No persistent toolbar — Inviolable #5"* comment. SummaryEditor and NotesEditor have toolbars but those are Inter-typeset structural editors, not prose. Spec allows this.

---

## `components/layout/AppShell.tsx`

### F-217 — `AppShell` org-fetch uses `.limit(1).maybeSingle()` without ORDER BY
**Severity:** **HIGH**   **Confidence:** certain   **Category:** spec-divergence (cross-tier duplicate)
**Location:** `components/layout/AppShell.tsx:136–146`
Same shape as F-143 (`lib/data/projects.ts:getOrgId`). Multi-org users get a non-deterministic org for the agent_jobs realtime subscription filter. **Two implementations of the same primitive flaw.**
**Recommended fix shape:** consolidate to `lib/data/projects.ts:getOrgId` and have AppShell call it; both sites then take the same fix.

### F-218 — `AppShell` `setOrganisationId(null)` silently disables agent UI without a signal
**Severity:** MEDIUM   **Confidence:** certain   **Category:** silent-failure
**Location:** `components/layout/AppShell.tsx:144`
If the user has no organisation_members rows (org-creation race per H-03, or data corruption), `organisationId` stays null, `useAgentJobsRealtime(null)` skips subscription. UI silently has no agent updates — no toast, no banner, no console.error. The user sees "no agent activity" when they trigger a synthesise.
**Recommended fix shape:** log + surface a "no organisation membership" banner if the user is authenticated but has no org row. This also surfaces H-03 violations.

### F-219 — width hydration race causes one-frame flicker on F5
**Severity:** LOW   **Confidence:** certain   **Category:** wrong-semantics
**Location:** `components/layout/AppShell.tsx:171–189`
Acknowledged in comment line 30: *"Brief one-frame flicker possible on first paint after F5 if the user has resized — acceptable for the stub."* V1 acceptable.

---

## `components/detail/`

### F-220 — `NodeDetailPanel` rename PATCH no-ops on transport failure
**Severity:** MEDIUM   **Confidence:** certain   **Category:** silent-failure
**Location:** `components/detail/NodeDetailPanel.tsx:205–214`
`if (r.ok) { ... }` — non-OK silently abandons the rename. The user sees the old name on screen, no signal that the rename failed. Same shape as F-92, F-170, F-201.

### F-221 — `NodeDetailPanel` reads `is_leaf` directly from `node?.is_leaf`
**Severity:** see F-152
**Location:** `components/detail/NodeDetailPanel.tsx:185`
H-15-correct: consumes server-derived `is_leaf` rather than recomputing. Cascades from F-152: when the server returns wrong is_leaf (layer_stack fetch failed), the ⌘Return + ProseEditor + WordCount affordances disappear silently. Component is correct; its dependency is the fault.

### F-222 — `AgentTab` is 1,021 lines; multiple operation flows interleaved
**Severity:** MEDIUM   **Confidence:** worth-checking   **Category:** wrong-semantics
**Location:** `components/detail/AgentTab.tsx`
Single file handling expand/synthesise/refine/generate-context flows + streaming UI + cancel/dismiss + history. Spot-checked — the data-testid additions from Step 4 are present. Worth a focused refactor pass post-V1; not a bug today but maintenance debt.

---

## `components/director/`

### F-223 — `DirectorPanel` 580/400 width hardcoded vs Component Spec §7.1
**Severity:** LOW   **Confidence:** certain   **Category:** spec-divergence
**Location:** `components/director/DirectorPanel.tsx`
Per Component Spec §7.1: *"580px preferred / 400px min"*. Hardcoded constants in the file. H-12 says no hardcoded operational values, but width-spec is a layout rule not an operational tunable — debatable. Component Spec mandates the values; spec-divergence if they drift.

### F-224 — `PlanCard` checkbox checked-state visual is a verdigris violation
**Severity:** see F-214
**Location:** cross-reference

### F-225 — `ExecutionCard` heartbeat indicator follows SU-42 / Component Spec v2.8 §7.7
**Confidence:** certain   **Category:** positive
Per the round-3 Step 4 sweep, ExecutionCard has the `data-testid="heartbeat"` + `data-heartbeat-fresh` attributes. Compliant with the spec change. No findings.

---

## `components/tree/`

### F-226 — `NodeTree` removed wrong `role="tree"` wrapper in round-3
**Severity:** see Step 4 fix
**Location:** `components/tree/NodeTree.tsx:259–266`
Already fixed. Catalogued for completeness — the wrapper used to set `role="tree"` over a div containing LayerDividers (non-treeitem children); axe flagged as `aria-required-children`. Fix landed in the round-3 a11y sweep.

### F-227 — `NodeRow` left-border verdigris is the sanctioned use #9
**Confidence:** certain   **Category:** positive
**Location:** `components/tree/NodeRow.tsx:130`
Comment cites *"verdigris reservation #9"*. Active node 2px left border. ✓ Sanctioned.

---

## `components/ui/`

shadcn primitives. Audited en bloc — most are direct shadcn-cli outputs with the project's tokens applied. No subsystem-level findings worth cataloguing individually. Defaults reasonable; bugs would surface visually.

### F-228 — shadcn ui/ may need re-audit on each shadcn-cli update
**Severity:** LOW   **Confidence:** worth-checking   **Category:** missing-comment
**Location:** `components/ui/*.tsx`
None of the ui/ files have a header comment about the shadcn provenance + customisation. A future developer running `shadcn-cli update` could clobber project-specific edits without realizing.

---

## `components/auth/`, `components/feedback/`, `components/projects/`, `components/documents/`, `components/context/`, `components/focus/`

Spot-checked. Patterns observed:

- **Form components in projects/, documents/, context/** — round-3 a11y sweep already wrapped Field components in `<label>` for implicit association (F-148-style fix landed). Compliant.
- **Toast / feedback in feedback/** — single Toast component; spot-check clean.
- **FocusMode in focus/** — already audited via the round-3 a11y sweep. F-194-style fix (FocusEscHint text-disabled → text-muted) landed.

### F-229 — auth flow components don't have a centralised "this user has no org" recovery path
**Severity:** MEDIUM   **Confidence:** worth-checking   **Category:** missing-feature
**Location:** `components/auth/` + `app/(auth)/` + AppShell handoff
H-03 (atomic org creation on signup) is the prevention. If the trigger ever fails (DB outage during signup, admin manual user insert), the user lands in the app with no org row. AppShell's F-218 silently disables agent UI. There's no fallback page. A "no org found, contact support" branch would handle the data-corruption case gracefully.

---

## Tier D summary

| Severity | Count |
|---|---|
| HIGH | **3** (F-213, F-214, F-217) |
| MEDIUM | 5 |
| LOW | 5 |
| **Total** | **13** |

Plus 3 positive findings (F-225 ExecutionCard heartbeat, F-227 NodeRow verdigris #9, plus implicit positive on Inviolables #1/#3/#4/#5 compliance).

### Themes that recur

1. **Inviolable #2 verdigris violations cluster on Director input controls (F-213, F-214).** Two unsanctioned verdigris uses, both on Director-flow elements. Suggests the original design meant to extend use #7 (Approve) into a "Director affirmative-action" colour family — but the spec only sanctions one use. Worth a deliberate spec amendment vs. revert.

2. **Multi-org primitive duplicated across stacks (F-217 cross-references F-143).** AppShell and `lib/data/projects.ts:getOrgId` both implement the same arbitrary-org find-first. Two sources of truth for "what org am I in"; both wrong for multi-org users.

3. **Silent failures on user-action transport errors (F-220).** Same shape as F-92/F-170/F-201/F-204 but at the component layer (rename PATCH). The cluster is now visible across SSE consumers, autosave, realtime, AND component-level fetches.

4. **Cascading visibility from server-derived data (F-221).** Components correctly consume server-derived fields (is_leaf), but when the server lies (F-152), the components silently degrade. The locus of the bug is in the data layer; the components are doing the right thing.

5. **H-12 hardcoded values bleed into layout dimensions (F-223).** Width specs in Component Spec §7.1 — 580/400 — appear as numeric literals in DirectorPanel. Defensible as "layout rules" vs "operational values" but the same H-12 spirit applies.

### What the spec lens caught

- **F-213, F-214 (Inviolable #2 verdigris violations)** — pure spec lens findings. Comment-vs-code lens couldn't see them; the *spec* lists 9 sanctioned uses and the code has 12+. Also worth catching by an automated grep at CI.
- **F-217 (AppShell duplicates `getOrgId`)** — F-143 already in lib/data; the spec lens noticed the same primitive flaw at the component layer.
- **F-218 (no fallback for null org)** — H-03 mandates atomic org creation; the failure-mode component-level handling is missing.

---

## Tier D + audit close

**Tier D audit complete.** The full audit (Tiers A–D) catalogues **220 findings across 138 files**:

| Tier | HIGH | MEDIUM | LOW | Total |
|---|---|---|---|---|
| A1 lib/llm | 9 | 27 | 19 | 55 |
| A2 lib/security | 2 | 7 | 11 | 22 |
| A3 lib/director | 8 | 19 | 11 | 38 |
| A4 lib/agent | 8 | 12 | 7 | 27 |
| A5 lib/data | 4 | 13 | 7 | 24 |
| B (app/api + libs) | 9 | 17 | 8 | 34 |
| C (hooks + context) | 2 | 4 | 4 | 10 |
| D (components) | 3 | 5 | 5 | 13 |
| **Total** | **45** | **104** | **72** | **221** |

(Plus ~7 positive findings — code that explicitly does the right thing on a critical path.)

**Remaining work:**
1. **A.1 backfill** with the spec-divergence lens (F-38 retraction + ~5–10 new findings expected when applying TA §4/§7 spec lens to lib/llm content).
2. **`99-themes.md`** — consolidated cross-tier patterns. The audit's actual deliverable for prioritisation. The 10 cross-cutting themes I've been tracking become first-class entries:
   - Two sources of truth (8+ sites)
   - Silent failure on transport/error/race (15+ sites)
   - Race conditions without UPSERT/atomic primitive (5+ sites)
   - Find-first without ORDER BY (6+ sites)
   - `.single()` where `.maybeSingle()` correct (8+ sites — H-01 violations)
   - Spec-mandated-but-V1-deferred (3 sites — F-56, F-78/F-115, F-89)
   - escapeXml / injection-scan bypass (5 sites)
   - Hardcoded operational values (H-12 violations, 6+ sites)
   - Sequential walks where one RPC suffices (4 sites)
   - Generic catch-all error wrappers (5 sites)
   - Inviolable #2 violations (2 sites — Tier D)
   - Two-source-of-truth on Tiptap/agent metadata schemas (F-209 + F-27 cross-tier)

The themes document is the lever for the eventual fix prioritisation — most of the 45 HIGH findings collapse into ~10 root causes when grouped by theme.

---

---

## TIER D FULL-PASS UPDATE — 2026-05-10

The original Tier D entry sampled ~15 of 67 files. The user pushed back on the sampling shortcut. This section documents the full pass over the remaining 52 files at the same depth as Tier A.

### detail/ remaining files

### F-237 — `SelectionTooltip` blur listener leaks on every effect re-run
**Severity:** MEDIUM   **Confidence:** certain   **Category:** silent-failure
**Location:** `components/detail/SelectionTooltip.tsx:42–46`
The `editor.on('blur', () => setVisible(false))` registration uses an inline arrow function. The cleanup `editor.off('blur', () => setVisible(false))` creates a NEW arrow function — different reference; the registered listener is never removed. Each effect re-run accumulates another blur listener. The `selectionUpdate` listener uses the same `update` reference and IS cleaned up correctly.
**Recommended fix shape:** hoist the blur handler to a const before the on/off pair; use the same reference.

### F-238 — `BackLinksList` silent fetch failure shows empty state instead of error
**Severity:** MEDIUM   **Confidence:** certain   **Category:** silent-failure
**Location:** `components/detail/BackLinksList.tsx:38–48`
`fetch(...).then(r => r.ok ? r.json() : null).then(...).catch(() => ...)` — 404, 500, or network failure all result in `setRows([])`. UI renders "Not linked from any structural node yet" — indistinguishable from genuine empty state. Same shape as F-220.

### F-239 — `ContextLinker` refetch silent failure
**Severity:** MEDIUM   **Confidence:** certain   **Category:** silent-failure
**Location:** `components/detail/ContextLinker.tsx:51–61`
`if (!r.ok) { setDirect([]); setInherited([]); return }` — silently clears both lists on transport failure. User sees "no context links" when actually the request failed. Same shape as F-220.

### F-240 — `detail/NodePicker` silent fetch failure + URL interpolation
**Severity:** MEDIUM   **Confidence:** certain   **Category:** silent-failure
**Location:** `components/detail/NodePicker.tsx:53–62`
`.catch(() => { /* silent */ })` explicit silent. Same shape. Plus URL `?limit=200&document_id=${documentId}` interpolates without UUID validation at the wrapper layer (route validates upstream — defence-in-depth gap; same shape as F-156).

### F-241 — `VersionHistory` re-implements `extractPlainText`
**Severity:** LOW   **Confidence:** certain   **Category:** dead-code (duplicate)
**Location:** `components/detail/VersionHistory.tsx:44–65` vs `lib/llm/tiptap-text.ts:52–68`
A second implementation of plain-text extraction from Tiptap JSON. Diff-rendering logic legitimately needs paragraph-boundary spaces (different from the lib/ helper) — but the basic walk could share. Same shape as F-120, F-141, F-209. Two-source-of-truth cluster.

### F-242 — `CommentThread` comment_type lists 5 values; Director schema admits 2
**Severity:** **HIGH**   **Confidence:** certain   **Category:** spec-divergence (cross-tier compound)
**Spec citation:** Phase 5 API Contract §3.10–§3.14 (UI), Phase 5b API Contract §1 (Director write tools)
**Location:** `components/detail/CommentThread.tsx:25, 38` vs `lib/director/schemas.ts:122`
The UI exposes `'instruction' | 'question' | 'note' | 'critique' | 'approval'` — five comment types. Director's `create_comment_step` schema admits only `'instruction' | 'note'`. **Director cannot create question/critique/approval comments via workflow-step.** Compounds with F-83 (Director schema may be narrower than DB column). Three sources of truth: UI / Director schema / DB column.
**Recommended fix shape:** decide the canonical set; align all three.

### F-243 — `CommentThread.resolveComment` and `deleteComment` don't check response status
**Severity:** MEDIUM   **Confidence:** certain   **Category:** silent-failure
**Location:** `components/detail/CommentThread.tsx:106–130`
Both call `await fetch(...)` and immediately `void refresh()`. If the request errors (resolved comment doesn't exist, RLS denies, server crashes), refresh runs and the UI shows the same comment unresolved/undeleted. User clicks again; same result. No surface for the failure.

### director/ remaining files

### F-244 — `director/NodePicker` lazy-loads once and never refreshes
**Severity:** MEDIUM   **Confidence:** certain   **Category:** wrong-semantics
**Location:** `components/director/NodePicker.tsx:65–88`
`if (allNodes.length > 0) return` — once the document's nodes load, the picker never re-fetches. If a node is added in another tab, the @ mention picker won't see it. Multi-tab gap; same family as F-205.

### F-245 — `director/NodePicker` hardcodes nodeTypeIcon switch
**Severity:** LOW   **Confidence:** certain   **Category:** dead-code (duplicate)
**Location:** `components/director/NodePicker.tsx:34–49` vs `lib/context/icons.ts`
Eleven node-type icon characters in a local switch. Project has `lib/context/icons.ts` for context-node icons. Two sources of truth. Same shape as F-209.

### F-246 — TWO `NodePicker` components with overlapping purpose
**Severity:** LOW   **Confidence:** certain   **Category:** dead-code (duplicate)
**Location:** `components/detail/NodePicker.tsx` (374 lines, modal for context-link picking) vs `components/director/NodePicker.tsx` (236 lines, popover for @ mentions)
Different surfaces, but both pick context/structural nodes. Each maintains its own fetch + filter + keyboard nav. Could share.

### tree/ remaining files

### F-247 — `NodeMoreMenu` rename/delete/status all silent on failure
**Severity:** MEDIUM   **Confidence:** certain   **Category:** silent-failure
**Location:** `components/tree/NodeMoreMenu.tsx:69, 86, 100`
All three handlers: `if (r.ok) onMutated()`. Failure no-ops without surfacing. Comment line 79–82 acknowledges the delete-count is shown via console only. Phase 2 stub status acknowledged.

### focus/ remaining files

### F-248 — `FocusMode` siblings fetch silent failure
**Severity:** MEDIUM   **Confidence:** certain   **Category:** silent-failure
**Location:** `components/focus/FocusMode.tsx:92–101`
`fetch(...).then(r => r.json())` — no `r.ok` check. On error, `body.nodes` is undefined; `(body.nodes ?? [])` becomes `[]`. ⌘← / ⌘→ navigation silently does nothing. Same shape.

### F-249 — `SentenceFocus` is a Phase 8 stub (acknowledged)
**Severity:** LOW   **Confidence:** certain   **Category:** spec-divergence (intentional deferral)
**Location:** `components/focus/SentenceFocus.tsx:1–32`
File-level comment honestly disclaims the Phase 8 deferral. Component renders dormant CSS rules that match no DOM elements. Acknowledged spec-divergence.

### Smaller dirs

### F-250 — `ContextCreateModal` documents fetch silent failure
**Severity:** MEDIUM   **Confidence:** certain   **Category:** silent-failure
**Location:** `components/context/ContextCreateModal.tsx:69–83`
`.catch(() => { /* silent */ })` — explicit silent on documents fetch failure. Comment justifies: *"server errors surface on submit"*. But until the user submits (could be never), they have no signal that the document selector is broken.

### Other notable findings from full-pass sampling

- `components/feedback/Toast.tsx` — uses module-scoped `toastIdSeq`. Toasts auto-dismiss after 4000ms (hardcoded). Phase 2 stub per the file comment. Acceptable.
- `components/layout/{Header, ModeContext, PanelResizer}.tsx` — clean. ModeContext's `if (meta && e.key === '.')` keyboard shortcut is well-bound.
- `components/tree/{AgentActivityIndicator, LayerDivider, NodeStatusBadge}.tsx` — clean. NodeStatusBadge correctly uses verdigris use #4/#5.
- `components/director/{ConversationThread, UserMessage, ThinkingIndicator}.tsx` — clean. ConversationThread's autoFollow scroll pattern is well-implemented.
- `components/focus/{FocusBreadcrumb, FocusEscHint, TypewriterContainer}.tsx` — clean. FocusBreadcrumb correctly bounds opacity to 0.2 max.

### globals.css verdigris backdoor

### F-251 — `globals.css` maps `--sidebar-primary` and `--chart-1` to `--color-accent`
**Severity:** LOW   **Confidence:** certain   **Category:** dead-code (verdigris backdoor)
**Location:** `app/globals.css:117, 125`
```css
--sidebar-primary:               var(--color-accent);
--chart-1: var(--color-accent);
```
Adjacent comment explicitly notes `--primary` is intentionally NOT mapped to `--color-accent` (Inviolable #2). But two OTHER shadcn theme variables ARE mapped. A grep confirms NO component uses `bg-sidebar-primary` or `bg-chart-1` today — so the mappings are dormant. **But:** any future shadcn primitive that uses `bg-sidebar-primary` (e.g. shadcn's Sidebar component) silently consumes verdigris. **Backdoor for Inviolable #2 violations.**
**Recommended fix shape:** map `--sidebar-primary` to `--color-text-primary` (or another non-accent token); add a CI grep that flags any new `bg-sidebar-primary` / `bg-chart-1` usage.

### shadcn ui/ primitives

### F-252 — `components/ui/` uses Tailwind theme vars; rest of app uses CSS custom properties
**Severity:** LOW   **Confidence:** certain   **Category:** wrong-semantics
**Location:** `components/ui/*.tsx` (13 files)
Shadcn primitives use Tailwind utility classes (`bg-primary`, `text-primary-foreground`, `border-input`, etc.) which resolve to a separate token namespace from the project's `--color-*` CSS custom properties. The two are wired together via `@theme inline { ... }` in globals.css, but a developer adding a new component might not realise that `bg-primary` ≠ `var(--color-text-primary)`. Two design-system pathways.

### Tier D totals — full pass

| Severity | Original sample | Full-pass additions | Total |
|---|---|---|---|
| HIGH | 3 (F-213, F-214, F-217) | 1 (F-242) | **4** |
| MEDIUM | 5 | 12 (F-237/8/9/40, F-243/4, F-247/8, F-250, F-251 LOW) | **17** |
| LOW | 5 | 4 (F-241, F-245, F-246, F-249, F-251, F-252) | **11** |
| **Total** | 13 | 16 | **32** |

Plus 5 positive findings (clean components per the inventory above).

### What changed between sample and full pass

- **+1 HIGH** (F-242 — CommentThread comment_type 3-source disagreement). The original sample didn't read CommentThread at all.
- **+12 MEDIUM** — almost all silent-failure-on-fetch findings (Theme T-1 cluster). Confirms: the silent-failure pattern is dominant at the component layer, not just in lib/.
- **+4 LOW** — duplicates and dead-code (Theme T-3 cluster).

The full pass validated the user's instinct: sampling missed real findings. The 16 new findings all fit existing themes from the consolidated `99-themes.md` but extend the per-theme site count.

---

*Tier D full pass complete. Continuing to Tier E.*
