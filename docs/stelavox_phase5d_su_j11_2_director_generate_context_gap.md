# SU-J11-2 — Director-planned `generate_context` against structural target

> Phase 5d cloud-investigation finding (2026-05-09). Mars-series doc surfaced an architectural gap between Director's workflow planning and workflow_executor's dispatch semantics.

## The finding

User created a Series document ("Mars"). The Series root node had an empty summary. The user opened Director and asked it to expand into books + generate thematic / world context.

Director generated a well-formed 3-step workflow per `GenerateContextStepProposalSchema`:

| Step | Operation | Target | Parameters |
|---|---|---|---|
| 1 | `expand` | Series root | `child_count_target: 3` |
| 2 | `generate_context` | Series root | `context_type: theme, seed_content: "..."` |
| 3 | `generate_context` | Series root | `context_type: world, seed_content: "..."` |

Step 1 failed (Bug 1 + Bug 2 — now both fixed in commit `e1628f6`).

Steps 2 + 3 failed with `no_system_profile_for_generate_context_series` because the workflow_executor's profile resolution looked up `(generate_context, series)` which doesn't exist. The Director's intent was clear (`context_type: theme`) but the executor didn't read that parameter.

Cloud workflow ID: `db0874ed-a053-44d4-9dfc-bd8a3a0a3aec` (paused).

## What I fixed

**Two-part fix in `lib/director/workflow-executor.ts`:**

1. **Profile resolution** now reads `step.parameters.context_type` for `generate_context` operations and uses that as the lookup key — `generate_context_theme`, `generate_context_world`, etc., resolve correctly.

2. **Safety check** before dispatch: if the target node is structural (not context-category), fail the step with `generate_context_requires_context_target` instead of dispatching. This prevents the agent_job from running and writing theme content to a structural node's summary on Accept (which would corrupt the Series root).

The user can still resume the Mars-series workflow:
- After redeploy, Step 1 (expand) will succeed (creates the 3 books)
- Steps 2 + 3 (generate_context) will fail with the new clearer error: `generate_context_requires_context_target`. The user will need to manually create theme + world context nodes under the series, then run generate_context against them individually.

## What's still architecturally missing

The Director's planning model assumes `generate_context` can be dispatched against a structural parent and the system will create-and-fill the context node in one step. The system's actual model is "generate_context fills an existing context node."

These two views need reconciliation. Options:

### Option A — Two-step planning (Director-side)

Update Director's prompts + tool definitions so generate_context proposals always come paired with a preceding `add_context_node` step. Requires:
- New `add_context_node` tool / step type in `WorkflowStepProposalSchema`
- Director system prompt updates
- Workflow executor support for `add_context_node`

### Option B — Auto-create context node (executor-side)

When workflow_executor dispatches `generate_context` against a non-context target, FIRST insert a stub context node with:
- `node_category: 'context'`
- `node_type: params.context_type`
- `parent_id`: target_node_id (or null for project-scope context)
- `scope`: derived from parent (probably 'document')
- `name`: derived from `params.seed_content` first line OR `params.context_type` capitalized
- Stub summary from `params.seed_content` if present

Then dispatch the agent_job pointing at the new context node. Accept writes the LLM result to the new node, not the parent.

Pros: works with existing Director planning; no Director-side changes needed.
Cons: substantial new logic in workflow_executor; needs careful RLS/scope/layer-index handling; "phantom" context node created on workflow approval (not on user accept) is a UX commitment.

### Option C — Defer node creation to Accept time

The agent_job runs against the parent target with a `result_metadata` that includes the proposed context node shape. At Accept time, create the new context node and write to it (not to the parent). Requires changes to the Accept route's logic for generate_context jobs whose target is structural.

### Recommendation

**Option B** is the cleanest user experience — the Director plans intuitively, the user sees the new context node appear when they approve the workflow, and Accept writes content to the right node. But it's a larger change.

For V1, the **safety check + clear error message** (this PR) is the conservative correct behavior. The user must manually create context nodes before asking Director to fill them. Option B is a V1.x candidate.

## Phase 5d disposition

- **Bug 4 (profile resolution)**: FIXED (commit lands with this doc)
- **Architectural gap**: SU-J11-2, V1.x candidate
- **Test coverage**: 3 new unit tests in `tests/unit/workflow-executor-profile.test.ts` cover the new generate_context profile resolution + the safety check
- **User's stuck Mars workflow**: will partially resume after redeploy (expand succeeds, generate_context steps fail clearly)

## Other observations

The user's Mars Series root has an empty summary (Tiptap stub `{"type":"doc","content":[{"type":"paragraph"}]}` — 47 chars). Asking Director to expand a Series with no synopsis is a valid stress-test of the system, but the LLM has nothing to base the books on. The Director's plan included a thematic seed_content field but the seed_content doesn't make it to the expand operation's prompt. This is a **separate small gap** — when the user has empty summaries, the LLM should refuse with a clear error rather than producing low-quality output OR returning prose-shaped content the parser can't handle.

Captured as **SU-J11-3** (lower priority): consider validating that the expand target has a non-empty summary before dispatching, with a clear error otherwise.
