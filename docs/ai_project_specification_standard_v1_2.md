# AI-Native Project Specification Standard
## Version 1.2

---

### Document Purpose

This document defines the complete documentation library required to build a software project with an AI development agent (Claude Code or equivalent) as the primary implementer. It specifies what documents must exist, when each is written, what each must contain, and what bad looks like for each.

It is the result of post-implementation review on a working AI-native build (Stelavox Phase 1). Several Phase 1 bugs and debugging sessions traced back not to poor decisions by the AI, but to reasonable inferences drawn from incomplete or ambiguous specifications. This standard captures the lessons.

Any new project should adopt this standard before writing the first line of code. Stelavox is the reference implementation; this document is the pattern.

---

### Who This Is For

- The human owner of a project who will work with an AI coding agent across many sessions.
- The AI agent itself, which will read sections of this document at the start of any new project to understand what is expected of the documentation library before code is written.
- Any second human (a co-founder, a contractor, an auditor) who needs to understand how the project is being run.

---

### How to Use This Document

A new project follows three phases of adoption:

**Day 0 — Read Parts 1 and 4.** Understand the philosophy and the phase lifecycle. Decide the project is being set up in this style before writing anything else.

**Week 1 — Build the Tier-A documents.** The documents owned by the human and required before any phase begins: Product Specification, Technical Architecture (with AI assist), Brand Identity, Deployment & Setup Guide, Local Dev Setup Guide, the global CLAUDE.md, and the project CLAUDE.md. Use Part 2 as the structural reference for each.

**Per phase — Run the pipeline.** Generate the Tier-B documents (API Contract, Build Checklist, Pre-Phase Test Plan) before implementation begins. Implement. Test. Write the Test Report. Merge. Repeat. Use Part 4 as the operational guide.

The full templates are in Appendix A. Stelavox is mapped to this standard in Appendix B.

---

### Glossary

| Term | Definition |
|---|---|
| **AI-native development** | A workflow where an AI agent is the primary implementer of code, with a human acting as architect, reviewer, and approver. |
| **Coding agent** | The AI system that writes, edits, and executes code (e.g. Claude Code). |
| **Specification gap** | A missing, incomplete, or ambiguous statement in a spec document that forces the agent to infer rather than read. |
| **Implementation gap** | A correct spec where the implementation diverged from it. |
| **Phase** | A bounded body of work with a defined deliverable, a build checklist, a test plan, and a merge gate. |
| **Tier-A document** | Owned by a human, written before the project starts, foundational. |
| **Tier-B document** | Per-phase, written from Tier-A documents (often by the AI), regenerated each phase. |
| **Hazard** | A recurring implementation pitfall that has caused, or will cause, a bug if not anticipated in the spec. |

---

### Table of Contents

- [Part 1 — Philosophy](#part-1--philosophy)
- [Part 2 — The Complete Document Library](#part-2--the-complete-document-library)
- [Part 3 — CLAUDE.md Standard](#part-3--claudemd-standard)
- [Part 4 — Phase Lifecycle](#part-4--phase-lifecycle)
- [Part 5 — Document Quality Criteria](#part-5--document-quality-criteria)
- [Part 6 — Adoption Path for a New Project](#part-6--adoption-path-for-a-new-project)
- [Appendix A — Templates](#appendix-a--templates)
- [Appendix B — Stelavox as Reference Implementation](#appendix-b--stelavox-as-reference-implementation)
- [Changelog](#changelog)

---

## Part 1 — Philosophy

### 1.1 The Core Claim

AI-native development requires *more* upfront specification than traditional human-only development, not less.

This is counter-intuitive. The promise of an AI coding agent is speed and the lifting of grunt work. The instinct is to write less, hand more over, and let the agent fill in the details. That instinct is correct about *boilerplate* but wrong about *intent*. The detail an agent needs is not boilerplate — it is the constraints, the trade-offs, the prior decisions, and the hazards. Those are exactly the things that live in a senior developer's head and never make it into a document on a human-only team. On an AI team, they must be written down.

### 1.2 The Inference Problem

A human developer fills gaps with judgement accumulated over years. They know that a `.single()` call on a Supabase client throws when zero rows are returned, because they have hit it before. They know that an RLS policy on a self-referential membership table will recurse, because they have debugged it before. They know that an authentication trigger needs to run before any operation that depends on membership, because they have seen the failure mode.

A coding agent fills gaps with inference from whatever is in front of it at that moment. The model is good — extremely good — at producing plausible code that solves the stated problem. It is not good at knowing what was *not* said. If the specification does not warn about `.single()` on zero rows, the agent will produce code that wraps the call in a try/catch that silences the error, treating the symptom as a bug instead of correct security behaviour. If the specification does not warn about RLS recursion, the agent will write the obvious policy and the obvious policy will recurse.

This is not the agent's fault. The agent did exactly what a thoughtful junior developer would do given the same brief. The problem is that the brief was incomplete.

### 1.3 The Cost of Ambiguity

In human-only development, ambiguity is resolved by conversation. A junior developer reads the spec, sees something unclear, walks across the room, and asks. The senior responds in thirty seconds. The cost of ambiguity is bounded by the speed of human conversation.

In AI-native development, ambiguity is resolved by inference, and inference becomes code, and code is executed, and the failure surfaces during testing — possibly hours or days later. The cost of ambiguity is bounded by the length of the debug cycle. That cycle is long. It involves regenerating the failure, reading logs, reading code, reading the spec, reasoning about what was actually intended, writing a fix, re-running tests. It is not unusual for a single ambiguity to cost half a day.

The cost of writing one extra paragraph of specification is roughly five minutes. The cost of an ambiguity that produces a bug is roughly four hours. The arithmetic is straightforward.

### 1.4 Specification as Risk Reduction

Treat every section of a specification as a risk allocation choice. Each sentence that exists in the spec is a sentence the agent does not have to invent. Each sentence that is missing is a sentence the agent will produce — sometimes correctly, sometimes not.

This means the right level of specification is not "as much as a human team would write." It is "enough that the agent does not have to invent anything load-bearing." Load-bearing inventions are the dangerous ones. An invented variable name in a one-off helper function does not matter. An invented column name in a database insert does. An invented assumption about RLS behaviour does. An invented authentication trigger dependency does.

The Stelavox post-implementation review found that every Phase 1 bug fell into one of three categories:

1. **Spec said X, code did Y.** Implementation gap. Fix the code, leave the spec.
2. **Spec didn't say.** Specification gap. The agent inferred, the inference was wrong. Fix the code AND add a paragraph to the spec so the next phase doesn't repeat it.
3. **Spec said X, but X was wrong.** Specification error. Fix the spec, then fix the code.

Categories 2 and 3 are both spec failures. They are the failures this standard exists to prevent.

### 1.5 The Hazard Document

Across both human and AI teams, a particular kind of knowledge tends to live only in heads: the recurring pitfall. Every framework, every database, every infrastructure stack has a small number of patterns that look right and are wrong. They produce subtle bugs that the same engineer will hit, fix, and forget — and the next engineer (or the same engineer six months later) will hit again.

In AI-native development, this knowledge must be externalised. The single most valuable section of the Stelavox Technical Architecture is the section titled "Known Implementation Hazards" — six entries, each three paragraphs long, each documenting a pitfall that had already caused a bug. After this section was added, the agent stopped reproducing those bugs. The cost was an hour of writing. The saving was many hours of re-debugging in subsequent phases.

Every project must have such a section. Every bug found during a phase must, if it represents a recurring pattern, be added to it. Section 5 of this standard treats this as a hard quality criterion.

### 1.6 The Specification Mindset

Adopt the following habits before writing a single document:

**Be authoritative or be silent.** If a spec mentions a column, it must be the correct column. If it cannot be verified, do not mention it — defer to the migration SQL. Half-correct specs are worse than no specs because the agent will trust them.

**Document the reason, not just the rule.** "Use `get_my_org_ids()` in policies on `organisation_members`" is a rule. "Use it because querying `organisation_members` from a policy on `organisation_members` causes recursion" is a reason. The rule alone teaches the agent to follow it; the reason teaches the agent to recognise the pattern in unfamiliar territory.

**Name what is locked.** Every project has decisions that are open and decisions that are closed. Mark the closed ones. The agent should not re-litigate "should we use Postgres or MongoDB?" in phase 7 because the answer was not visibly closed in phase 1. A "Locked Decisions" section in every architectural document earns its keep.

**Distinguish summary from authority.** A summary is a convenience; the authority is the original. When a build checklist lists database columns, it is summarising the migration SQL. The migration SQL is authoritative. The spec must say so explicitly so that the agent verifies against the SQL when in doubt, not against the checklist.

**Write down the hazards.** Every bug is a candidate hazard. Every hazard belongs in the spec. The cost of one paragraph is trivial; the value compounds across every subsequent phase.

These habits are the foundation of every document standard in Part 2.

---

## Part 2 — The Complete Document Library

### 2.0 Overview

The library has thirteen documents. Three are new additions to common practice and exist specifically because AI-native development exposed gaps that human-only development tolerated:

- **API Contract** — written before each phase, used as the single source of truth for what every endpoint accepts and returns.
- **Pre-Phase Test Plan** — written before any code is implemented for the phase, derived from the API Contract.
- **CLAUDE.md** — a two-layer instruction file that the coding agent reads automatically at session start.

The remaining ten are familiar in shape but have specific structural requirements imposed by AI-native development.

The full library:

| # | Document | When Written | Owner | Tier |
|---|---|---|---|---|
| 1 | Product Specification | Before all coding | Human | A |
| 2 | Technical Architecture | Before all coding | Human + AI assist | A |
| 3 | Brand Identity | Before all coding | Human | A |
| 4 | UI Design Specification | Before UI phases | Human | A |
| 5 | Component Specification | Before UI phases | Human + AI assist | A |
| 6 | Wireframes | Before UI phases | Human | A |
| 7 | Deployment & Setup Guide | Before infrastructure | Human | A |
| 8 | Local Dev Setup Guide | Before first session | Human | A |
| 9 | API Contract | Before each phase | AI from spec | B |
| 10 | Build Checklist | Before each phase | AI from spec | B |
| 11 | Pre-Phase Test Plan | Before each phase | AI from API Contract | B |
| 12 | Test Report | After each phase | AI | B |
| 13 | CLAUDE.md (global + project) | Before first session | Human + AI | A |

**Tier-A documents are written once and updated as the project evolves.** They are foundational. They are read by the agent at session start when relevant.

**Tier-B documents are regenerated each phase.** The previous phase's Tier-B documents become historical records once the phase merges to main.

The remainder of this section specifies each document.

---

### 2.1 Product Specification

**Purpose.** The complete description of what is being built and why. The product spec is read by the agent whenever a feature decision needs to be made — not at every session, but at every session that involves new feature work.

**When written.** Before any code. Before the Technical Architecture. The product spec is the input to every other document.

**Who owns it.** Human. The agent may help with structure and prose tightening but must not invent product decisions.

**Required sections.**

1. **Vision and target user.** One paragraph each. Who is this for, and what problem does it solve? Be specific about the user — not "writers" but "long-form fiction writers working on novels of 80,000+ words." Generic targets produce generic features.

2. **Scope and platform strategy.** What platforms, what versions, what is in V1 vs V2 vs V3. A locked table of platform support.

3. **Pricing and monetisation model.** Tiers, prices, what each tier includes, billing cycle, refund policy if any. Locked numbers, not ranges.

4. **Feature inventory.** Every feature in V1, grouped by surface area. For each: a one-paragraph description, the user story, and the data it touches. This is the input the Technical Architecture will use to derive the schema.

5. **Data model summary.** The conceptual entities and how they relate. Not the schema (that is in Technical Architecture) — the conceptual shape. "Authors create projects. Projects contain documents. Documents contain a tree of nodes."

6. **User journeys.** Three to five end-to-end stories of a user doing a complete task. These become the basis of acceptance testing.

7. **Out of scope.** A short list of things the product is deliberately not doing in V1, with the reason. Prevents the agent from suggesting these in future sessions.

8. **Locked decisions.** A table of decisions that are closed and must not be re-litigated.

9. **Open questions.** A short list of unresolved decisions. Each must have an owner and a deadline. The agent should never propose code that depends on an open question.

**Quality criteria.**

- Numbers are specific. "$15/month" not "around $15." "1,000,000 tokens per period" not "roughly a million."
- Every feature is named. The names that appear here are the names used everywhere else.
- The "Locked decisions" section is non-empty.
- The "Out of scope" section is non-empty.

**Failure modes.**

- *Vague pricing.* Produces inconsistent billing logic. The agent will invent a billing cycle if not told one.
- *Feature inventory in prose only.* The agent reads prose for context but plans against tables. Feature work scattered through narrative paragraphs gets missed.
- *No user journeys.* Acceptance criteria become abstract. Tests become unit tests rather than user-flow tests.
- *No "out of scope".* The agent suggests scope creep in good faith. Every session a new feature creeps in.

---

### 2.2 Technical Architecture

**Purpose.** The complete description of how the product is built. Stack, schema, security model, infrastructure, integration patterns, abstraction layers, and the recurring hazards encountered while building.

**When written.** Before any code. After the Product Specification.

**Who owns it.** Human, with AI assist for drafting. Every architectural decision must be made by the human; the agent may help articulate, test for consistency, and flag gaps.

**Required sections.**

1. **Technology stack summary.** Every chosen technology, the version, and one paragraph on why. Locked.

2. **Frontend architecture.** Framework choice, routing model, state management, component structure, styling approach. Code-level patterns: where do API calls live, where does business logic live, what is the role of each folder.

3. **Backend and database architecture.** Database choice, migration strategy, access pattern (ORM, raw SQL, etc.), security model (RLS, IAM, etc.), API route structure. The full schema in SQL or DDL form.

4. **Application security.** Threat model: who could attack, how, what they could see. Defences: each one named and implemented in detail. For projects with LLM components, this includes prompt injection defences, canary tokens, output schema validation, and tool call validation. Concrete code samples for each defence.

5. **Known Implementation Hazards.** This is the most valuable section in the document. It lists every recurring pitfall encountered or anticipated. Each entry has: what happens, why it happens, the fix, the scope of the rule. This section is updated every time a phase encounters a new hazard. It is read at the start of every phase that touches the relevant subsystem.

6. **AI integration layer (if applicable).** Provider choices, abstraction layer design, prompt construction pattern, streaming, response parsing, cost management, model selection. For Stelavox: 200+ pages on this alone. For projects without AI components, this section is omitted.

7. **LLM abstraction layer (if applicable).** A type-safe interface contract, the concrete provider implementations, the factory pattern that resolves to a provider at call time. Critical: components and API routes must never call the SDK directly.

8. **Phase plan.** A high-level breakdown of the build into phases, with the goal of each, the deliverable of each, and the dependency graph between them. The Build Checklist for each phase will derive from this.

9. **Locked architectural decisions.** A table of decisions that are closed.

10. **Open architectural questions.** A short list, each with an owner.

**Quality criteria.**

- The schema is presented in actual DDL/SQL, not bullet point summaries.
- Every security defence has a concrete code sample.
- The Known Implementation Hazards section exists from version 0.1, not added later. It starts as a placeholder if no hazards are known yet.
- For every "Don't do X" rule, there is a "Because Y" reason.
- Every external library is listed with version pinning rationale.

**Failure modes.**

- *Schema as bullet list of column names.* The agent will hallucinate column types, default values, and constraints. Always include the actual SQL.
- *No hazards section.* Phase N hits a bug that phase N-1 already hit. The fix is not propagated. The bug recurs.
- *Mixed authority.* Schema described in three places (build checklist, technical arch, schema document), each slightly different. The agent picks whichever it sees first. Inconsistency produces wrong inserts.
- *Security defences described in prose.* Without concrete code samples, the agent invents the implementation. Inconsistent defences across the codebase.
- *No abstraction layer for external APIs.* The agent calls the SDK directly from a component because nothing told it not to. Now changing providers requires rewriting fifty components.

---

### 2.3 Brand Identity

**Purpose.** The visual and verbal identity of the product. Colours, typography, voice, tone, and the inviolable rules that govern all visual decisions.

**When written.** Before any UI work. Updated rarely.

**Who owns it.** Human. The agent should never invent brand decisions.

**Required sections.**

1. **The product name.** Origin, pronunciation, etymology if any. The name appears in marketing copy, error messages, and code; the agent must use it consistently.

2. **The wordmark.** The single canonical typographic treatment of the name. Where it appears, where it must not appear, what surrounds it.

3. **Colour system.** Every named colour, every hex value, every semantic role. CSS custom property names. Light mode and dark mode equivalents.

4. **Typography.** Every named font, every weight, every use case. Where each font is used and where it is forbidden.

5. **Voice and tone.** How the product talks. Examples of correct copy. Examples of forbidden copy.

6. **The Inviolables.** A small set of brand rules that override all other considerations. Three to five entries. Each is named, defined, and explained. Examples: "the wordmark font appears nowhere except the wordmark component"; "the accent colour has eight sanctioned uses; never invent a ninth without revising this document."

7. **Sanctioned uses of the accent colour.** An exhaustive enumerated list. The agent will read this and use only the listed cases.

**Quality criteria.**

- Every colour has a hex value AND a CSS custom property name.
- The Inviolables section names them explicitly. Three to five is the right count; ten is too many to remember.
- Sanctioned-use lists are exhaustive, not illustrative.
- Voice examples are short and concrete.

**Failure modes.**

- *Inviolables described as "general principles."* Without the word "inviolable," the agent treats them as defaults that can be overridden. A button gets the brand colour because "it looks important."
- *Colour described only by name.* The agent invents a hex value. Inconsistent tones across the codebase.
- *No sanctioned-use list for the accent colour.* The agent uses the accent everywhere because it is "the brand colour." The brand becomes monotonous and the accent stops accenting anything.
- *Voice described in adjectives only.* "Confident, warm, professional" produces nothing useful. Examples of correct and incorrect copy produce something useful.

---

### 2.4 UI Design Specification

**Purpose.** The high-level layout, motion, and interaction language of the product. The structural design above the component level — page templates, navigation patterns, breakpoints, transitions, the rhythm of the interface.

**When written.** Before UI implementation phases.

**Who owns it.** Human. AI assist for prose tightening only.

**Required sections.**

1. **Design tokens.** Every CSS custom property, every value. Spacing scale, type scale, motion durations, easings, z-index scale, radius scale. This is the single source of truth for these values.

2. **Layout grid.** Breakpoints, columns, gutters, max content widths. What changes between breakpoints.

3. **Page templates.** For each major page or screen type, the structural layout: where the navigation goes, where the main content goes, where actions live. Not pixels — structure.

4. **Motion and transition language.** Every type of transition (fade, expand, slide, etc.) with its named duration, easing, and use case. The agent should not invent new transitions.

5. **Interaction patterns.** Hover, focus, active, disabled states described once at the system level. Per-component states are in Component Spec; this is the global rule.

6. **Accessibility rules.** Minimum contrast ratios, focus visibility, keyboard navigation, reduced-motion behaviour. The defaults that every component must respect.

7. **Empty states, loading states, error states.** The patterns that apply across the product.

**Quality criteria.**

- Every numeric value is in a token, never a magic number.
- Every motion has a named duration AND a named easing.
- Page templates are diagrammed or wireframed.
- The "reduced-motion" behaviour is specified, not inferred.

**Failure modes.**

- *Pixels in components, not tokens.* The agent ships a button with `padding: 13px` because the design called for "comfortable padding." Tokens prevent this.
- *Motion described only in seconds.* No easing specified. The agent picks `ease-in-out` because it is the default. The product feels generic.
- *No empty/loading/error pattern.* Every component invents its own. Inconsistent behaviour across the product.

---

### 2.5 Component Specification

**Purpose.** Every component in the product, every state, every exact value. The reference the agent uses when implementing or modifying any component.

**When written.** Before UI implementation. Updated whenever a component is added or changed.

**Who owns it.** Human, with AI assist for drafting from wireframes.

**Required sections.**

1. **Design tokens.** A copy or reference of the tokens defined in UI Design Spec, present here for ease of lookup.

2. **Component inventory.** The full list of components, organised by surface area (navigation, layout, forms, feedback, etc.).

3. **Per-component spec.** For each component: purpose, props, every state (default, hover, focus, active, disabled, loading, error), exact CSS values for every state, motion behaviour, keyboard interaction, accessibility annotations.

4. **Composition rules.** Which components nest inside which. Components that must never appear together. Components that have layout constraints when paired.

5. **Variant rules.** When a component has variants (size, colour scheme, density), the rule for choosing.

**Quality criteria.**

- Every state has every value. No "use the default" — defaults are values too, named.
- Every interactive component has a focus state, not just hover.
- Every interactive component has a disabled state.
- Every component with text has a loading skeleton specified.
- Every value references a token, never a hex or pixel value.

**Failure modes.**

- *Hover specified, focus unspecified.* The agent ships a component with no visible focus outline. Keyboard users cannot navigate. Accessibility audit fails.
- *Values inline, not tokenised.* When the brand colour changes, fifty components need to change. They don't all change.
- *States described in prose without values.* "Hover state is a slightly darker version of the base." The agent picks "slightly darker" by inferring. It guesses wrong half the time.
- *No composition rules.* Components nest illegally. The agent puts a `<Card>` inside a `<Tooltip>` because it solves the immediate problem.

---

### 2.6 Wireframes

**Purpose.** The visual reference for every screen at the layout level. Not pixel-perfect designs — structural drawings that show what is on each screen and how it is arranged.

**When written.** Before UI implementation.

**Who owns it.** Human. The agent should never modify wireframes.

**Required content.**

1. **One wireframe per major screen.** Dashboard, document editor, settings, billing, etc.
2. **Annotations.** Each significant element labelled with its component name (matching Component Spec).
3. **Versioning.** Wireframes are versioned and the version is referenced from the Build Checklist.

**Quality criteria.**

- Wireframes are HTML or image files committed to the repo, not external tool links.
- Every interactive element is labelled with its component name.
- Empty states, loading states, and error states are wireframed separately if their layout differs.
- A single wireframe is recognisably one screen, not a kitchen sink of options.

**Failure modes.**

- *Wireframes only in Figma or another external tool.* The agent cannot read them. The screen is implemented from prose alone.
- *Components in wireframes do not match Component Spec.* The agent picks the closest component name and produces a slightly wrong UI.
- *No empty/loading/error wireframe.* These states are hand-waved at implementation. They look hand-waved.

---

### 2.7 Deployment & Setup Guide

**Purpose.** Everything required to set up the project's infrastructure from scratch — accounts, projects, environment variables, OAuth registrations, DNS, payment provider, monitoring. The operational counterpart to the Local Dev Setup Guide.

**When written.** Before any code that depends on infrastructure (i.e. very early — typically week 1).

**Who owns it.** Human.

**Required sections.**

1. **External accounts.** Every third-party service required, with the account creation steps.
2. **Cloud projects.** Every cloud project created (e.g. Supabase dev + prod, Vercel project, Stripe account), with the exact configuration.
3. **OAuth registrations.** For every third-party integration (Google, Dropbox, etc.), the app registration steps, redirect URIs, scopes.
4. **Environment variables.** Every variable, every environment (local, preview, production), the source of each value, whether it is a secret.
5. **Initial deployment.** The first push, the first deploy, the verification that the empty app is reachable.
6. **DNS and domains.** If applicable.
7. **Monitoring and alerting.** The minimum monitoring required for production launch.

**Quality criteria.**

- Every variable is listed in every environment, even if the value is the same.
- Every external service has a link to its dashboard.
- Every step has a verification: "you should now see X."
- Secrets are never written into the document. Placeholders only.

**Failure modes.**

- *Environment variables documented inconsistently.* The local dev setup says one thing, the production deploy says another. The agent uses local values in production code.
- *No verification step.* The agent runs the setup, gets no feedback that it worked, and proceeds to write code on a broken environment.
- *OAuth scopes underspecified.* The agent registers the app with overly broad scopes, or fails to request a scope it needs.

---

### 2.8 Local Dev Setup Guide

**Purpose.** Step-by-step instructions for a new developer (human or agent) to get the project running on a local machine for the first time.

**When written.** Before the first development session. Updated when the local stack changes.

**Who owns it.** Human.

**Required sections.**

1. **Tooling install.** Every CLI, runtime, or tool required, with install commands for the supported OS. If multiple OSes are supported, all are documented.
2. **Repository clone and dependency install.**
3. **Local environment file.** Where it lives, what variables it needs, where each value comes from. With a `.env.example` committed.
4. **Local database.** How to start, reset, and inspect the local database. Migration application.
5. **Running the dev server.** Exact command, exact URL, what should appear.
6. **The first session checklist.** What to read, in what order, before writing any code.
7. **Day-to-day workflow.** The typical session start, edit, test, commit cycle.
8. **Common problems.** Three to ten recurring local-dev gotchas with their fixes.

**Quality criteria.**

- Every command is a literal command, copy-pastable.
- The supported OS is named explicitly.
- The "first session checklist" exists and is short.
- The "common problems" section is non-empty (it grows over time).

**Failure modes.**

- *No `.env.example`.* The agent does not know what variables exist. Either misses required variables, or invents variables that do not exist.
- *Vague start command.* The agent runs the wrong port, the URL doesn't match, time is lost.
- *No first-session checklist.* The agent starts coding without context. Decisions are made in ignorance.

---

### 2.9 API Contract

**Purpose.** The single source of truth for every API endpoint in a phase: route, method, request shape, response shape, status codes, error envelopes, authentication and authorisation rules. Written before any endpoint is implemented.

**This is one of the three documents this standard adds to common practice.** It exists because Phase 1 of Stelavox showed that without an API Contract, the agent infers the response shape, the test plan infers a different shape, the front-end infers a third shape, and the three only meet at integration time.

**When written.** At the start of each phase that adds or modifies API surface. Before the Build Checklist for that phase.

**Who owns it.** AI from the Product Spec and Technical Architecture, reviewed and approved by the human.

**Required sections.**

1. **Phase scope.** Which routes are added, which modified, which removed, in this phase.

2. **For each endpoint:**
   - **Route and method.** Exact path including parameter syntax.
   - **Authentication.** Required, optional, or unauthenticated. If required, what mechanism.
   - **Authorisation.** Who can call this and what they can affect. If RLS is the enforcement mechanism, state the policy chain.
   - **Request body schema.** Field-by-field, with types, optionality, validation rules.
   - **Query parameters.** Same.
   - **Response — success.** Status code, JSON shape, every field with its type.
   - **Response — errors.** Every error case: when it occurs, what status, what body.
   - **Side effects.** Every database row created, modified, or deleted. Every external service called.
   - **Idempotency.** Is this idempotent? If yes, how is it enforced?

3. **Cross-cutting rules.** Error envelope shape (e.g. `{ error: string }`), authentication header conventions, pagination conventions, rate-limit headers if applicable. Stated once.

4. **Test cases.** A reference to the Pre-Phase Test Plan, which is generated from this contract.

**Quality criteria.**

- The contract is exhaustive for the phase. No "TBD" entries.
- Every error case has a deterministic trigger condition.
- Every status code is documented with the exact body.
- Validation rules are precise: "name must be 1–100 chars, no leading or trailing whitespace" not "name must be valid."
- The contract is in a format that can be diffed in version control (markdown or YAML, not screenshots).

**Failure modes.**

- *Response shape implicit.* The agent picks `{ data: ... }`, the test plan expects `{ project: ... }`, neither matches the front-end consumer. Three weeks of intermittent bugs follow.
- *Validation rules vague.* "Name is required" — does empty string pass? Does whitespace-only pass? The agent picks. The test picks differently.
- *Authorisation model implicit.* The agent enforces it inconsistently across endpoints. RLS works on some, not on others. Cross-user data leaks are caught only if a test happens to look.
- *Side effects undocumented.* The endpoint creates a row in two tables; only one is visible from the response. The Test Plan does not check the second. The agent forgets it next phase.

---

### 2.10 Build Checklist (per phase)

**Purpose.** The ordered, executable task list for implementing a phase. Every task small enough to complete in one agent session. Every task with explicit acceptance criteria. Every task referenced to the spec section that authorises it.

**When written.** At the start of each phase, after the API Contract for that phase.

**Who owns it.** AI from the Technical Architecture and Product Specification, reviewed and approved by the human before the phase begins.

**Required sections.**

1. **Phase header.** Phase number, goal, deliverable, weeks estimated, dependencies on prior phases.

2. **Pre-build prerequisites.** Things that must be true before phase work begins. Often a reference to the Deployment & Setup Guide or to a prior phase's checkpoint.

3. **Ordered task list.** Tasks grouped into subsections (e.g. "Project scaffold," "Database schema," "Auth flow"). Each task is a checkbox. Each task has:
   - **The action**, described as a verb-led sentence.
   - **The acceptance criterion**: what is true after this task is done.
   - **The spec reference**: which section of which document authorises this task.
   - **Migration SQL or code references** for tasks that involve schema or load-bearing code, with the actual SQL or a pointer to the migration file. Never paraphrased column lists.

4. **Phase checkpoint criteria.** A short, explicit list of conditions that must hold for the phase to be considered complete. The Test Plan tests these.

5. **Locked migration ordering.** If migrations exist, the exact order they apply, with a note that this order must not change.

**Quality criteria.**

- Every task has an acceptance criterion. "Done when..." not "implement X."
- Every column or schema reference defers to the migration SQL as authoritative. The checklist may summarise but must say "see migration NNN for authoritative column list."
- Tasks are small. A task that takes more than half a session is split.
- The phase checkpoint criteria are testable.
- The checklist references documents by version, not by name alone.

**Failure modes.**

- *Tasks without acceptance criteria.* The agent decides when "done" is reached. Ambiguity in done means premature done.
- *Column lists that do not match the migration.* The agent inserts the column list from the checklist; the migration omits the column; the insert fails. Or vice versa.
- *Checkpoint criteria absent.* The phase ends ambiguously. The Test Report cannot be written. The phase merges with bugs.
- *Tasks bundled into "implement the dashboard."* Too coarse. The agent loses track of what was done. Adjacent tasks get implemented in the same session, mistakes compound.

---

### 2.11 Pre-Phase Test Plan

**Purpose.** The complete test plan for the phase, written *before* implementation begins, derived directly from the API Contract and the phase checkpoint criteria. Executed at the end of the phase by the agent.

**This is the second of the three documents this standard adds.** It exists because writing tests *after* implementation tests what was built, not what was specified. Writing the test plan first forces the API Contract to be precise enough to generate a test plan, and forces the implementation to be measured against the original intent.

**When written.** Immediately after the API Contract for the phase, before any implementation tasks begin.

**Who owns it.** AI from the API Contract, reviewed and approved by the human before implementation starts.

**Required sections.**

1. **Test environment.** What is set up, how, where. Test users, test data, mocked external services.

2. **Section 1 — UI checkpoint tests.** One test case per phase checkpoint criterion that is observable from the UI. Each test: spec reference, procedure, expected result.

3. **Section 2 — API integration tests.** For every endpoint in the API Contract, every documented case (happy path, every error case, every authorisation boundary). Each test: route, method, body, expected status, expected response body.

4. **Section 3 — Authorisation boundary tests.** Cross-user, cross-org, cross-tenant tests. Specifically: every endpoint, the case where an unauthorised actor attempts to access another actor's resource. Expected outcome documented (some endpoints return 404, some return empty, some return 500 — all are valid; the contract decides which).

5. **Section 4 — Data integrity tests.** After every destructive or modifying operation, a verification that other data was not affected.

6. **Verdict criteria.** The pass/fail rule for the phase.

**Quality criteria.**

- Every endpoint in the API Contract has at least one happy-path test and one auth-failure test.
- Every authorisation boundary has at least one cross-user test.
- Test cases are numbered (TC-01, TC-02, etc.) for unambiguous reference.
- Expected results are exact: status code AND body shape AND key field values.
- Tests can be executed in any order (no implicit ordering dependencies) unless explicitly noted.

**Failure modes.**

- *Tests written after implementation.* They test what was built. Bugs that diverge from the spec are codified as features.
- *No auth boundary tests.* Cross-user data leaks ship to production. The first time anyone notices is when a customer reports it.
- *Vague expected results.* "Returns success." Does that mean 200? 201? 204? The agent fills in.
- *Tests that depend on each other.* TC-05 depends on TC-04 having passed. When TC-04 fails, TC-05 fails for the wrong reason. The actual cause is hidden.

---

### 2.12 Test Report

**Purpose.** The record of test execution at the end of a phase. Pass/fail per test case, root cause analysis for any failure, fixes applied, re-test results.

**When written.** After implementation of the phase is complete and the test plan is executed.

**Who owns it.** AI, with human review.

**Required sections.**

1. **Test environment.** Date, tester (the agent's identity), branch, migrations applied, dev server version. Anchors the run in time.

2. **Spec references.** Which versions of which documents this run was tested against. Critical for traceability when specs change later.

3. **Test results.** Section by section, test case by test case: spec reference, procedure as executed, expected result, actual result, pass/fail.

4. **Checkpoint verdict.** Did the phase meet its checkpoint criteria? Pass or fail with a one-line summary.

5. **Issues found.** For each failure or implementation gap:
   - **Severity** (blocker, high, medium, low).
   - **Type** (specification gap, specification error, implementation gap, environment issue).
   - **Description.**
   - **Root cause analysis.**
   - **Fix applied** (or fix proposed if not yet applied).
   - **Re-test result.**

6. **Specification updates required.** If any spec was found to be wrong or incomplete, the document and section that needs updating.

7. **New hazards discovered.** Bugs that represent recurring patterns. These are added to the Technical Architecture's Known Implementation Hazards section.

8. **Change control.** A versioned changelog of test runs within this phase (v1.0 = first run, v1.1 = re-test after fixes, etc.).

**Quality criteria.**

- Every test in the Test Plan appears in the Test Report. None are skipped silently.
- Every failure has a root cause classified as one of the four types.
- Every fix is verified by re-test.
- Specification updates are not promised — they are tracked as separate work items with status.

**Failure modes.**

- *Failures without root cause analysis.* "Test failed, fix applied, retest passed." The lesson is not extracted. The same bug recurs.
- *Specification gaps not promoted to spec updates.* The agent fixed the code but not the underlying ambiguity. Next phase, the same ambiguity bites again.
- *Hazards not added to the Architecture document.* The hazards section becomes stale. New hazards live only in the test report and are forgotten.
- *Re-test verdict missing.* The fix was applied but never validated. The bug is presumed dead.

---

### 2.13 CLAUDE.md

CLAUDE.md is large enough and structurally distinctive enough to warrant its own part of this standard. Part 3 covers it.

---

## Part 3 — CLAUDE.md Standard

### 3.1 Why Two Layers

`CLAUDE.md` is the file that the coding agent reads automatically at the start of every session in a directory. It is the agent's standing instruction set. Without it, the agent enters every session as if it had never seen the project before.

Most discussions of `CLAUDE.md` treat it as a single per-project file. This standard treats it as **two files in two layers** because the instructions naturally split:

- **Universal instructions** — how to work, when to ask, how to write commit messages, when to refactor, how to classify bugs. These apply to every project equally and should not be duplicated per project.
- **Project-specific instructions** — the stack, the dev server commands, the known hazards, the file paths. These differ between projects.

Duplicating the universal layer into every project means it drifts. One project's CLAUDE.md says "always propose before editing"; another forgets to. The agent behaves differently across projects for no good reason. Splitting the layers fixes this.

### 3.2 The Global CLAUDE.md

**Location.** `~/.claude/CLAUDE.md` (or whichever path the agent reads at user level — the location depends on the agent runtime; the principle is "above the project, applied to every project").

**Owner.** Human, written once, evolved over time as the human's working style is refined.

**Required sections.**

1. **Working principles.** The non-negotiables of how this human works with this agent. Examples: "Always propose before editing." "Diagnose before fixing." "Never refactor adjacent code in the same change."

2. **The change process.** The exact sequence the agent follows when making any change. Diagnose → Classify → Propose → Implement → Update specs and changelogs.

3. **Spec-vs-implementation classification.** The rule for deciding whether a bug is in the spec or the code. The default assumption is implementation gap. The conditions under which the spec is the bug.

4. **When to act vs when to propose.** Reading is free. Editing requires proposal. Destructive commands require proposal. Running the dev server is free. Specifying this once globally prevents per-session negotiation.

5. **Changelog discipline.** How changelogs are kept across documents. The rule: every document change adds a changelog entry to that document.

6. **Tone and style.** How the human prefers responses formatted. Brevity preferences. Whether to use bullet lists or prose. Emoji policy.

7. **Things to never do without confirmation.** A short, exhaustive list. Force pushes. Database resets. Deleting files. Running migrations against remote databases.

**Quality criteria.**

- Short. The global file should fit on a single screen if at all possible. Two screens is the maximum.
- Universal. Anything project-specific belongs in the project layer.
- Stable. Changes are rare and considered.

- **Not versioned.** The global CLAUDE.md is personal configuration, not a specification document. It does not carry a version number or changelog. It evolves without formal versioning. Project-specific rules belong in the project CLAUDE.md, not the global file.

**Failure modes.**

- *Project-specific content leaks in.* The global file mentions a database column or a CLI command. New project, the agent applies the wrong instruction.
- *Aspirational, not actual.* The global file describes how the human wishes they worked, not how they actually work. The agent follows the file; the human gets frustrated when the agent does what the file said.
- *Too long.* The agent has a finite context window. A 500-line global instruction file pushes useful project context out.

### 3.3 The Project CLAUDE.md

**Location.** Repository root (`/CLAUDE.md`).

**Deployment.** The project CLAUDE.md is a standalone deliverable produced during Week 1 alongside the other Tier-A documents. It is not embedded in the Local Dev Setup Guide as a template to copy-paste. It exists as a named file in the docs library (e.g. `docs/CLAUDE_[project]_project.md`) and is deployed to the repository root as `CLAUDE.md`. The filename at the root must always be exactly `CLAUDE.md` — Claude Code reads this specific path automatically. The docs library copy is the source of record; the repository root copy is the deployed instance. Both must be identical and are updated and committed together.

**Owner.** Human, with AI assist for drafting from the spec library.

**Required sections.**

1. **Project overview.** One paragraph: what this project is, what it does, who it's for. The agent reads this to orient.

2. **Spec library reference.** Where the specs live and which specs to read for which kind of change. Example: "Before any architectural change, read Technical Architecture latest version. Before any UI change, read Component Spec latest version."

3. **Working principles inheritance.** A reference to the global CLAUDE.md and any project-specific overrides. Most projects have no overrides.

4. **Development environment.**
   - The exact start commands (e.g. `supabase start`, `npm run dev`).
   - Local URLs and ports.
   - Environment files and where they live.
   - Any non-obvious tooling requirements.

5. **Technology stack.** A bullet list of the major technologies, one line each. The agent may need this when making framework-specific choices.

6. **Architecture rules.** The non-negotiable rules of how code is organised in this project. Examples: "Never call the database directly from a component — always through `lib/db/`." "Never call the LLM SDK directly — always through `lib/llm/factory.ts`."

7. **Known implementation hazards.** A short list of the hazards from Technical Architecture §3.7 (or equivalent), summarised. The agent reads this before every session that touches the relevant subsystem.

8. **Design token rules (if applicable).** The CSS custom property convention. The rule against hardcoded values. The exception (the tokens file itself).

9. **Critical brand rules (if applicable).** The Inviolables from the Brand Identity document. Stated explicitly, not by reference, because brand violations are easy to commit accidentally.

10. **Git workflow.** Branching model, merge rules, commit message conventions. Anything that differs from the agent's defaults.

11. **Session start checklist.** The first three to five things the agent reads at the start of every session. Short, ordered, file-pathed.

12. **Document naming convention.** The pattern for spec document filenames and version suffixes.

**Quality criteria.**

- Specific. Every command is literal. Every path is real. Every rule has a reason.
- Maintained. When a hazard is added to the Architecture document, a one-line reference is added here.
- Read before committed. Run a session against the file. Does the agent behave correctly? If not, the file is wrong.
- Versioned with the project. The CLAUDE.md is in the repo; it diffs cleanly.
- **Versioned inside the file.** The project CLAUDE.md carries a version number in its header (e.g. `## Version 1.0`) and a changelog block at the bottom, following the same format as all other Tier-A documents. The version does not appear in the filename (the filename is fixed as `CLAUDE.md`). Every meaningful change increments the version and adds a changelog entry.
- **Source of record is the docs library copy.** When the file is updated, both the docs library copy and the deployed `/CLAUDE.md` are updated in the same commit. A commit that updates one without the other is wrong.

**Failure modes.**

- *Stale.* The CLAUDE.md says `npm run dev` but the project switched to `pnpm dev` three months ago. New session, the agent runs the wrong command.
- *Missing the hazards.* The hazards live only in the Technical Architecture, which the agent reads only when it remembers to. Hazards recur.
- *Aspirational.* The file says "all components are tested" but no test runner is configured. The agent writes code expecting test infrastructure that does not exist.
- *Duplicates the global.* Half the file is a copy-paste of the global CLAUDE.md. The two drift apart. Inconsistent behaviour.
- *Template embedded in the Local Dev Setup Guide.* The CLAUDE.md content is written inside a fenced code block in another document. Nested fences break markdown rendering. More importantly, the file does not exist as a deployable artefact — it must be manually extracted and created. Produce it as a standalone file.
- *Version not tracked.* The file changes but the version is not incremented. When something goes wrong because CLAUDE.md was stale, there is no record of when it drifted or what changed.

### 3.4 Maintenance

`CLAUDE.md` is a living document. Update the project CLAUDE.md (and bump the version) when:

- A hazard is added to the Technical Architecture → add a one-line summary to the Known Hazards section. Minor bump.
- A working principle or architecture rule changes → update the relevant section. Minor bump.
- A new Inviolable is added to the Brand Identity → add it to the Critical Brand Rules section. Minor bump.
- A new component with critical constraints is added to the Component Spec → add a row to the Critical Component Specifications table. Minor bump.
- A spec document changes version → update the Spec Library Reference table. Minor bump.
- The dev environment changes (new tool, new command, new port) → update the Development Environment section. Minor bump.
- The build phase advances → update the Session Start Checklist. Minor bump.
- The structure of the file itself is reorganised → major bump.

Every change to CLAUDE.md is a commit. Update the docs library copy and the deployed `/CLAUDE.md` in the same commit. The agent reads the updated file at the next session start.

---

## Part 4 — Phase Lifecycle

### 4.1 The Pipeline

Every phase follows the same pipeline. Each stage has an explicit output and an explicit gate before the next stage begins.

```
[Read specs] → [Write API Contract] → [Write Test Plan] → [Write Build Checklist]
       ↓                    ↓                    ↓                     ↓
   approve              approve              approve              approve
       ↓                    ↓                    ↓                     ↓
[Implement] → [Execute Tests] → [Write Test Report] → [Update specs] → [Merge]
                     ↓                                       ↓
                approve                                 approve
```

Each "approve" gate is the human reading and signing off. The agent does not pass the gate without explicit approval.

### 4.2 Stage 0 — Read Specs

The agent reads the relevant Tier-A documents for the phase. For a database-foundation phase, that is the Technical Architecture. For a UI phase, the UI Design Spec, Component Spec, and relevant wireframes. For a feature phase, the Product Specification.

The agent confirms its understanding of the phase scope in a brief written summary, including: what is in scope, what is explicitly out of scope, what dependencies exist on prior phases, what unknowns remain. The human approves or corrects.

**Gate to next stage:** the human confirms the agent understands the phase.

### 4.3 Stage 1 — Write the API Contract

If the phase introduces or modifies API surface, the agent writes the API Contract for the phase, derived from the Product Specification and Technical Architecture. See §2.9 for required content.

If the phase has no API surface (purely internal refactor, build tooling, etc.), this stage produces a one-line note and is otherwise skipped.

**Gate to next stage:** the API Contract is reviewed and approved. Changes after this point are version-bumped on the contract, not silently edited.

### 4.4 Stage 2 — Write the Pre-Phase Test Plan

The agent generates the Test Plan from the API Contract and the phase checkpoint criteria. See §2.11. Every endpoint in the contract produces test cases. Every checkpoint criterion produces a UI test.

The Test Plan is then locked. It will be executed at the end of the phase against the implementation. Tests may be added during the phase if new hazards or edge cases emerge, but the original tests are not modified.

**Gate to next stage:** the human approves the Test Plan. The plan must cover every endpoint and every checkpoint criterion.

### 4.5 Stage 3 — Write the Build Checklist

The agent generates the Build Checklist for the phase from the Technical Architecture, the Product Specification, and the API Contract. Tasks are ordered, sized, and given acceptance criteria. See §2.10.

**Gate to next stage:** the human approves the checklist. The agent does not begin implementation until approval.

### 4.6 Stage 4 — Implement

The agent works through the Build Checklist task by task. Each task follows the change process from the global CLAUDE.md: diagnose → classify → propose → implement → update specs and changelogs.

For tasks where the diagnosis is trivial and the change is small (a one-line config edit, a typo fix), the proposal step may be combined with the implementation in a single message — but the human still sees what is about to change before it changes.

For tasks where the diagnosis reveals a specification gap or specification error, the agent stops, raises the issue, and waits for the human to decide whether to update the spec before proceeding.

**Gate to next stage:** the Build Checklist is complete. Every checkbox is ticked. The human is satisfied that the implementation is ready for testing.

### 4.7 Stage 5 — Execute Tests

The agent executes the Test Plan against the implementation. Test cases are run in order. Failures are recorded but do not halt the run; the goal is to identify all failures in one pass, not to fix the first failure and rerun.

**Gate to next stage:** the test run is complete. Every test case has an outcome.

### 4.8 Stage 6 — Write the Test Report

The agent writes the Test Report. See §2.12. Failures are diagnosed. Each failure is classified as a specification gap, specification error, implementation gap, or environment issue.

For specification gaps and errors, the human reviews the proposed spec update. The spec is updated, version-bumped, and a changelog entry added.

For implementation gaps, the agent fixes the code, re-runs the affected tests, and updates the Test Report with the re-test result. A new version of the Test Report is published (v1.1, v1.2, etc.) for each re-test cycle.

**Gate to next stage:** every test passes on a clean run. The Test Report records this. Every issue found has been resolved or explicitly deferred (with rationale and a tracked work item).

### 4.9 Stage 7 — Update Specs and Hazards

If the phase encountered new hazards — bugs that represent recurring patterns the next phase will also encounter — they are added to the Technical Architecture's Known Implementation Hazards section. Each hazard entry follows the format from §2.2.

If any spec was wrong, it is updated and version-bumped.

CLAUDE.md is updated if any of the changes above introduced new rules, new commands, or new hazards that the agent should see at session start.

**Gate to next stage:** all spec updates are committed. The hazard section is current.

### 4.10 Stage 8 — Merge

The phase branch is merged to `main`. The Test Report is the gate: if the report records a clean run on the latest version, the merge proceeds. If the report has any unresolved failures, the merge does not proceed.

A short merge note is written: phase number, deliverable, link to Test Report, link to spec updates if any. This is the historical record.

After merge, the phase's Tier-B documents (API Contract, Test Plan, Build Checklist, Test Report) are archived in their final state. The Tier-A documents remain live.

### 4.11 Phase 0 — Pre-Build Infrastructure

Phase 0 is the only phase that does not follow the pipeline above. It is the setup phase, executed before phase 1 begins. Its inputs are the Deployment & Setup Guide and the Local Dev Setup Guide. Its output is a working local environment and a working set of cloud projects.

Phase 0 has its own checkpoint: the empty application is reachable in production and locally, the database is provisioned in both environments, the secrets are in place, the agent can run the dev server. Until this checkpoint passes, no feature work begins.

### 4.12 Hot-Fix Phases

Production bugs may require an out-of-band phase — a small, fast pipeline that does not justify a full Build Checklist but should still be governed.

The pipeline contracts to: diagnose → propose fix → write a single-test test plan that demonstrates the bug → implement → run test → update specs if needed → merge. The Test Report still gets written; it may be a five-line report.

Hot-fixes that reveal a spec error are still spec errors. Update the spec.

---

## Part 5 — Document Quality Criteria

### 5.1 Universal Criteria

These apply to every document in the library.

**Versioned.** Every document has a version number. Every change increments the version. Every change adds a changelog entry to the document itself, not a separate file.

**Diff-able.** The document is in a format that diffs cleanly in version control: markdown is the default, YAML or HTML where structurally appropriate. Screenshots are avoided except where visual content is the subject (wireframes).

**Authoritative or silent.** The document either authoritatively specifies something or defers to another source. Half-correct content is forbidden. When summarising, the document explicitly names the authoritative source.

**Reasoned.** Every rule has a reason. "Don't do X" is incomplete without "because Y." The agent generalises from reasons; rules without reasons do not generalise.

**Linked.** When the document references another document, it does so by name and version. Links between markdown files are encouraged but not required.

**Reviewed by execution.** The document is "read" at least once by running a session against it. If the agent cannot find what it needs, the document fails the review.

### 5.2 The "No Ambiguity" Test

For each Tier-A document, the human runs a thought experiment: a junior developer who has never seen this project picks up this document and is asked to implement a piece of it. Will the document tell them what to do, or will they have to guess?

Ask specifically: where would they guess? Those locations are where the agent will guess. Tighten them.

### 5.3 The "Hazard Honesty" Test

For Technical Architecture: does the Known Implementation Hazards section have at least one entry per major subsystem (database, auth, deployment, AI integration if applicable)?

If the section is empty or thin, the project either has not yet built enough to know its hazards, or has built enough but not written them down. The first is acceptable in week 1. The second is a critical gap.

### 5.4 The "Living vs Frozen" Distinction

Some documents are living — they are updated continuously throughout the project. Others are frozen — they are written once and not changed without a major-version revision.

| Document | Status |
|---|---|
| Product Specification | Living (minor revisions); frozen on the locked decisions section |
| Technical Architecture | Living; the hazards section grows; locked decisions are frozen |
| Brand Identity | Frozen on Inviolables; minor revisions on copy and tokens |
| UI Design Specification | Frozen on tokens once chosen; living on additions |
| Component Specification | Living |
| Wireframes | Frozen per screen; new screens added as living |
| Deployment & Setup Guide | Living |
| Local Dev Setup Guide | Living |
| API Contract | Frozen per phase; new phase, new contract |
| Build Checklist | Frozen per phase |
| Pre-Phase Test Plan | Frozen per phase (tests added but originals not modified) |
| Test Report | Frozen per phase, versioned per re-test |
| Global CLAUDE.md | Living (rare changes) |
| Project CLAUDE.md | Living |

The distinction matters because frozen sections are pointed to as authoritative. Living sections must be diffed when the agent reads them.

### 5.5 Per-Document Quality Checklists

Each document specification in Part 2 includes a "Quality criteria" subsection and a "Failure modes" subsection. Use them as checklists at document review time.

A short summary of the most consequential criteria:

| Document | Highest-leverage criterion |
|---|---|
| Product Specification | Locked decisions section is non-empty and specific |
| Technical Architecture | Known Implementation Hazards section exists and grows over time |
| Brand Identity | Inviolables are explicitly named; sanctioned-use lists are exhaustive |
| UI Design Specification | Every numeric value is a token, never a magic number |
| Component Specification | Every interactive component has a focus state and a disabled state |
| Wireframes | Every interactive element is labelled with its component name |
| Deployment & Setup Guide | Every step has a verification |
| Local Dev Setup Guide | A `.env.example` is committed; every command is literal |
| API Contract | Every error case has a deterministic trigger condition |
| Build Checklist | Every task has an acceptance criterion |
| Pre-Phase Test Plan | Every endpoint has at least one happy-path and one auth-failure test |
| Test Report | Every failure has a root-cause classification |
| CLAUDE.md (global) | Universal — nothing project-specific |
| CLAUDE.md (project) | Specific — every command literal, every path real |

### 5.6 Naming and Versioning

The naming and versioning rules in this section are mandatory. They exist for two reasons. First, an AI agent retrieves documents by filename — inconsistent names cause the agent to read the wrong version, miss a document, or invent a name when summarising. Second, version drift across documents — one spec at v0.9, another at v1.4, a third undated — makes it impossible to know which set of decisions is current. Both problems compound as the project grows.

#### 5.6.1 Filename Convention

Every document in the library follows this filename pattern:

```
[project]_[topic]_v[major]_[minor].[ext]
```

Per-phase documents extend the pattern with a phase tag:

```
[project]_[topic]_phase[N]_v[major]_[minor].[ext]
```

Rules:

- **Project prefix is mandatory.** Even when a document lives inside a project repo, the prefix travels with the file when copied, uploaded, attached to a chat, or moved between folders. The cost of the prefix is a few characters; the cost of an unprefixed `technical_architecture_v0_3.md` mixed with files from another project is hours of confusion.
- **Lowercase only.** No mixed case, no camel case, no title case. `stelavox_brand_identity_v1_0.md`, never `Stelavox_Brand_Identity_V1_0.md`.
- **Underscores separate words.** Never spaces. Never hyphens. Underscores survive every shell, every filesystem, every URL.
- **Version uses underscore, not dot, in filenames.** `v1_0` not `v1.0`. Dots in filenames are reserved for the extension. Some tools and shells treat `v1.0` as if `0.md` were the extension; the underscore form has no such ambiguity.
- **No dates in filenames.** Dates belong in changelogs, not filenames. A file named `architecture_2026_05_01.md` becomes a lie the moment it is edited.
- **No status suffixes in filenames.** No `_draft`, no `_final`, no `_v2_FINAL_actually_final`. The version number is the status.
- **Topic uses singular nouns where natural.** `agent_profile_library` not `agent_profiles_library`. `component_specification` not `components_specification`. The reading flows better and references stay short.

Standard topic names — use these exact strings for the corresponding documents in the library:

| Document | Topic string |
|---|---|
| Product Specification | `product_specification` |
| Technical Architecture | `technical_architecture` |
| Brand Identity | `brand_identity` |
| UI Design Specification | `ui_design` |
| Component Specification | `component_specification` |
| Wireframes | `wireframe_[screen_name]` (one file per screen) |
| Deployment & Setup Guide | `deployment_setup` |
| Local Dev Setup Guide | `local_dev_setup` |
| API Contract | `api_contract_phase[N]` |
| Build Checklist | `build_checklist_phase[N]` |
| Pre-Phase Test Plan | `test_plan_phase[N]` |
| Test Report | `test_report_phase[N]` |
| Project CLAUDE.md | `CLAUDE.md` (literal — no project prefix; lives at repo root) |
| Global CLAUDE.md | `CLAUDE.md` (literal — at user level) |

The two `CLAUDE.md` files are the only exceptions to the prefix rule, because the agent reads them by location, not name. Their location distinguishes them.

Examples — well-formed filenames for a project named `vellum`:

```
vellum_product_specification_v1_0.md
vellum_technical_architecture_v2_3.md
vellum_brand_identity_v1_0.md
vellum_test_report_phase2_v1_1.md
vellum_api_contract_phase3_v1_0.md
vellum_wireframe_dashboard_v1_0.html
```

#### 5.6.2 Document Heading Convention

Inside the document, the version appears in a different form. The first two lines of every document follow this pattern:

```markdown
# [Project] — [Document Title]
## Version [major].[minor]
```

Rules:

- **Dots, not underscores, in the heading.** `Version 1.0` reads naturally; `Version 1_0` looks like a typo.
- **Em-dash separator** between project and title. Not hyphen, not colon.
- **Title is human-readable**, not the topic-string form. `Technical Architecture`, not `technical_architecture`.

Example:

```markdown
# Vellum — Technical Architecture
## Version 2.3
```

#### 5.6.3 Version Numbering

Every document uses a two-part version: `major.minor`. Patch versions (`major.minor.patch`) are used only by Test Reports for re-test cycles within a phase — see §5.6.5.

**The starting version is `v1.0`, not `v0.1`.** A document is not published until it is ready to be read by the agent. Pre-publication drafts may exist locally as `v0.x` if the author finds it useful, but the moment a document is committed to the repo and referenced by another document, it is `v1.0`. This avoids the Stelavox pattern of every spec sitting at `v0.x` for months because no one wanted to commit to "v1" — when documents never leave draft, neither does the discipline of major-bump rules.

**Major bump (`v1.0` → `v2.0`).** Required when any of the following changes:
- A locked decision is reversed.
- The structure of the document changes (sections added, removed, or significantly reorganised).
- A breaking change is introduced — anything that means previously-correct code, schemas, or downstream documents are now incorrect.
- The conceptual model the document describes changes (e.g. switching from REST to GraphQL in the Technical Architecture; changing the pricing model in the Product Specification).

**Minor bump (`v1.0` → `v1.1`).** Required when any of the following changes:
- A non-breaking addition is made (a new feature, a new hazard entry, a new component, a new endpoint that does not affect existing endpoints).
- An error is corrected — a wrong column name, a wrong path, a wrong value.
- Prose is rewritten for clarity without changing meaning.
- A changelog entry is added.

**No bump (the version stays the same).** Permitted only for:
- Typo fixes, formatting fixes, broken-link fixes that do not affect content.
- Whitespace and markdown rendering corrections.

When in doubt, bump. The cost of an unnecessary minor bump is zero; the cost of a missed major bump is downstream documents pointing at a version that no longer means what they think it means.

**Locked decisions and major bumps interact.** When a major bump occurs because a locked decision was reversed, the changelog must explicitly record which decision was reversed and why. The unlocking is itself a major event, not a footnote.

#### 5.6.4 Per-Phase Documents

API Contracts, Build Checklists, Test Plans, and Test Reports are scoped to a single phase. Their versioning is bounded by the phase: when the phase merges, the document is archived in its final state and never edited again.

Within a phase:
- The first published version is always `v1.0`.
- Minor bumps follow the rules in §5.6.3.
- Major bumps within a single phase are unusual but possible — typically when scope is significantly redefined mid-phase.
- The next phase's documents start fresh at `v1.0` of the new phase number. There is no continuity in version numbers between phases.

So a project will have, over its life, files like:

```
vellum_test_report_phase1_v1_2.md   (final state of phase 1, after two re-tests)
vellum_test_report_phase2_v1_0.md   (initial state of phase 2)
vellum_test_report_phase2_v1_1.md   (after first re-test in phase 2)
```

These are sequential phases, not sequential versions of one document.

#### 5.6.5 Test Report Patch Versions

Test Reports are the only document type that uses three-part versioning, and only when needed.

A Test Report is published at `v1.0` after the initial test run. If failures are found and fixes applied, the re-test produces a new version. The bump rule:

- **Patch bump (`v1.0` → `v1.0.1`).** Re-test of the same test cases against the same phase scope, after fixes are applied. The test plan has not changed; only the implementation has.
- **Minor bump (`v1.0` → `v1.1`).** Re-test after the test plan itself was extended with new cases (new hazards discovered during testing prompted additional tests).
- **Major bump (`v1.0` → `v2.0`).** Reserved for the rare case where the phase scope is redefined and the test plan is materially restructured mid-phase.

In practice, most Test Reports go `v1.0` → `v1.0.1` → `v1.0.2` until the phase passes cleanly. The version that is referenced as authoritative is always the latest, recorded in the merge note.

#### 5.6.6 Changelog Convention

Every document ends with a `## Changelog` section. Every version bump adds an entry. Entries follow this format:

```markdown
**v1.1 — 2026-05-01** Added Hazard 3.7.7 (cookie domain handling under wildcard subdomains). Corrected migration 008 column type for `usage_records.tokens_consumed` from `int` to `bigint`.

**v1.0 — 2026-04-15** Initial published version.
```

Rules:

- **Newest entry at the top.** The reader sees the current change first.
- **Date in ISO format** (`YYYY-MM-DD`). Unambiguous across regions.
- **One paragraph per entry.** Multiple changes in a single bump are concatenated, not bulleted, so that the changelog reads as prose. If a single bump produces a paragraph longer than four sentences, the bump was probably too large and should have been split.
- **Describe the change, not the process.** "Added Hazard 3.7.7" not "Updated documentation following testing." The agent reads changelogs to understand *what changed*; reasons live in the body of the document, process meta-commentary lives nowhere.
- **No "v0.x" entries in the changelog.** The changelog begins at `v1.0`. Pre-publication drafts have no public history.

#### 5.6.7 Cross-Document Version References

When one document references another, it must reference a specific version, not just the document name. Examples:

```markdown
See Technical Architecture v2.3 §3.7 for the full hazard list.
```

```markdown
This phase implements the routes defined in API Contract phase 2 v1.0.
```

The "latest version" form is permitted only in the Project CLAUDE.md, where the agent is explicitly directed to read the most recent file matching a pattern. Anywhere else, ambiguity about which version is meant produces silent drift.

When a referenced document version-bumps, the referencing document must be checked. If the bump was minor and non-breaking, the reference is updated and the referencing document gets a minor bump of its own (a correction). If the bump was major, the referencing document may need substantive revision.

#### 5.6.8 Quick Reference

| Concern | Rule |
|---|---|
| Filename version separator | Underscore (`v1_0`) |
| Heading version separator | Dot (`v1.0`) |
| Starting version | `v1.0`, never `v0.x` once published |
| Major bump trigger | Locked decision reversed, structure changed, breaking change |
| Minor bump trigger | Addition, correction, clarification |
| Patch versions | Test Reports only, for re-test cycles |
| Project prefix in filename | Mandatory, except for `CLAUDE.md` |
| Dates in filename | Forbidden |
| Status suffixes (`_draft`, `_final`) | Forbidden |
| Date format in changelog | ISO (`YYYY-MM-DD`) |
| Changelog order | Newest first |
| Cross-document reference | Always cite a specific version |

---

## Part 6 — Adoption Path for a New Project

### 6.1 Day 0

Before opening an editor:

1. Read Part 1 of this document. Confirm that the philosophy fits the project.
2. Read Part 4 of this document. Confirm that the phase lifecycle is acceptable.
3. Decide the project name. Register the GitHub organisation, the cloud accounts, and the domain if applicable.
4. Create an empty repository. Commit a `README.md` and a `LICENSE`.

### 6.2 Week 1 — The Tier-A Library

In order, write:

1. **Product Specification.** Until this exists, no architectural decisions can be made.
2. **Brand Identity.** Until this exists, no UI work can begin (so writing it now removes a future blocker).
3. **Technical Architecture.** Driven by the Product Specification. The hazards section starts empty.
4. **Deployment & Setup Guide.** The infrastructure plan.
5. **Local Dev Setup Guide.** How to run the project locally.
6. **Global CLAUDE.md.** If not already in place from previous projects.
7. **Project CLAUDE.md.** Derived from the above.

UI Design Specification, Component Specification, and Wireframes are written before the first UI phase, not in week 1, unless UI work is in phase 1.

### 6.3 Pre-Phase 1 — Phase 0 Infrastructure

Execute the Deployment & Setup Guide. Verify with the Local Dev Setup Guide. Confirm:

- The repo is connected to the cloud platform.
- The database is provisioned in dev and production.
- The dev server runs.
- The deployed empty app is reachable.
- Secrets are in place. Nothing is committed.
- The agent can read the CLAUDE.md and act on it.

### 6.4 Per-Phase Routine

Run the Part 4 pipeline for every phase. Do not skip stages even when they feel redundant. The pipeline's value compounds: skipped stages produce bugs in later phases, not the current one.

After each phase, take fifteen minutes to:

1. Update the hazards section in the Technical Architecture if anything new was learned.
2. Update CLAUDE.md if any of the project context changed.
3. Note any specification improvements for the next phase.

### 6.5 Anti-Patterns to Avoid

- **Skipping the API Contract because "the routes are obvious."** They are obvious to the human writing them; they are not obvious to the agent reading the spec three weeks later, and they are not obvious to the test plan.
- **Writing tests after implementation.** The tests will pass. The implementation will be wrong.
- **Updating specs only when forced to.** The hazard section grows by being updated proactively. Reactive updates lag the bugs.
- **Letting the global CLAUDE.md absorb project-specific content.** The global file is a discipline of restraint. Hold the line.
- **Treating the Test Report as paperwork.** It is the most valuable document at the end of a phase. The lessons it captures shape every subsequent phase.

---

## Appendix A — Templates

### A.1 API Contract Template

````markdown
# [Project] — Phase [N] API Contract
## Version 1.0

### Phase Scope
- Routes added: [list]
- Routes modified: [list]
- Routes removed: [list]

### Cross-Cutting Rules
**Error envelope:** `{ error: string }` for 4xx; `{ error: string, detail?: string }` for 5xx.
**Authentication header:** [convention].
**Pagination:** [convention if applicable].

---

## Endpoint: [METHOD] [route]

**Authentication:** Required | Optional | None
**Authorisation:** [policy in plain English; reference RLS chain or IAM rule]

### Request
**Body schema:**
| Field | Type | Required | Validation |
|---|---|---|---|
| name | string | yes | 1–100 chars, no leading/trailing whitespace |

**Query parameters:**
| Param | Type | Required | Description |
|---|---|---|---|

### Response — Success
**Status:** 200 | 201 | 204
**Body:**
```json
{
  "field": "type"
}
```

### Response — Errors
| Trigger | Status | Body |
|---|---|---|
| Missing auth | 401 | `{ "error": "Unauthorized" }` |
| Validation failure | 400 | `{ "error": "name required" }` |
| Cross-tenant access | 404 | `{ "error": "Not found" }` |

### Side Effects
- Inserts a row into `[table]`.
- Triggers `[function]`.
- Sends a webhook to `[provider]`.

### Idempotency
Idempotent: yes | no. If yes, mechanism: [description].

---

[Repeat per endpoint]

### Changelog
**v1.0 — [date]** Initial contract for Phase [N].
````

### A.2 Pre-Phase Test Plan Template

````markdown
# [Project] — Phase [N] Pre-Phase Test Plan
## Version 1.0

### Test Environment
- Date written: [date]
- Will be executed against: [branch] at [URL]
- Test users: [list with credentials placeholder, never real secrets]
- Mocked services: [list]

### Section 1 — UI Checkpoint Tests

**TC-01 — [Name]**
- **Spec ref:** [doc § section]
- **Procedure:** [exact steps]
- **Expected:** [exact result]

[Repeat]

### Section 2 — API Integration Tests

**TC-NN — [METHOD] [route] — [case]**
- **Spec ref:** [API Contract route]
- **Procedure:** [request as code or curl]
- **Expected:** [status, body shape, key field values]

[Repeat for every endpoint, every documented case]

### Section 3 — Authorisation Boundary Tests

**TC-NN — User B accessing User A's [resource]**
- **Procedure:** [exact request]
- **Expected:** [status and body, per the API Contract]

[Repeat]

### Section 4 — Data Integrity Tests

[Verifications that destructive operations did not affect untargeted data]

### Verdict Criteria
The phase passes when:
- All TC-* in Sections 1–4 pass on a clean run.
- [Any phase-specific criterion]

### Changelog
**v1.0 — [date]** Initial test plan for Phase [N].
````

### A.3 Test Report Template

````markdown
# [Project] — Phase [N] Test Report
## Version 1.0

### Test Environment
| Item | Value |
|---|---|
| Date | [date] |
| Tester | [agent identity] |
| Branch | [branch] |
| Migrations applied | [range] |
| Dev server | [version] |

### Spec References
| Document | Version | Sections under test |
|---|---|---|

### Test Coverage Overview
| Section | Scope | Test cases |
|---|---|---|

### Test Results

**TC-01 — [Name]**
- **Spec ref:** [as in plan]
- **Procedure:** [as executed]
- **Expected:** [as in plan]
- **Result:** ✅ PASS | ❌ FAIL — [observations]

[Repeat]

### Checkpoint Verdict

| Criterion | Status |
|---|---|

**Phase [N] Checkpoint: PASS | FAIL — [summary]**

### Issues Found

**ISSUE-01 — [Name]**
- **Severity:** Blocker | High | Medium | Low
- **Type:** Specification gap | Specification error | Implementation gap | Environment issue
- **Description:** [what was observed]
- **Root cause:** [analysis]
- **Fix applied:** [what changed, in which files]
- **Re-test result:** ✅ FIXED — [observations] | ⏳ PENDING

[Repeat]

### Specification Updates Required
- [Document, section, change]

### New Hazards Discovered
- [Hazard description, to be added to Technical Architecture §3.7 (or equivalent)]

### Change Control
**v1.1 — [date]** Re-test after fixes. [Issues now passing].
**v1.0 — [date]** Initial test run.
````

### A.4 Global CLAUDE.md Template

````markdown
# Global Working Instructions

## Working Principles
- Always propose before editing any file.
- Diagnose the cause before proposing a fix.
- Never refactor adjacent code in the same change.
- Treat the spec as authoritative until proven wrong.

## The Change Process
For every change:
1. Diagnose — read the relevant code, the relevant spec section, and any related migrations.
2. Classify — specification gap, specification error, or implementation gap. Default to implementation gap.
3. Propose — state the diagnosis, classification, and proposed fix. Wait for approval.
4. Implement — make only the approved changes.
5. Update specs and changelogs — every spec or doc that changed gets a changelog entry.

## When to Act vs When to Propose
- Reading files, running searches, checking schema: act immediately.
- Editing any file: propose first.
- Destructive commands (db reset, force push, file deletion): propose first.
- Running the dev server, tests: act immediately.

## Spec vs Implementation Errors
First assumption: implementation diverged from spec.
Conclude spec is wrong only if:
- Spec contradicts how the framework actually works.
- Spec contains a factual error (wrong column name, wrong path).
- The user agrees the spec needs updating after seeing the diagnosis.

## Changelog Discipline
Every change to a document adds a changelog entry to that document, with version bump.

## Tone
Direct. Brief. No hedging. No filler. Match the register of the request.

## Things Never Done Without Explicit Confirmation
- Force push.
- Database reset.
- Permanent deletion of any file.
- Running migrations against a remote database.
- Committing secrets.
````

### A.5 Project CLAUDE.md Template

````markdown
# [Project] — Project Context

## Project Overview
[One paragraph: what this is, what it does, who it's for.]

## Spec Library
The specs live in `[path]`. Read these before any change of the relevant kind:
- Technical Architecture (latest version) — for any architectural change.
- Phase Build Checklist (current phase) — for the current phase tasks.
- Component Specification (latest version) — for any UI change.
- UI Design Specification (latest version) — for tokens, motion, layout.
- Brand Identity (latest version) — for any visual decision involving colour, typography, or wordmark.

## Working Principles
Inherits from `~/.claude/CLAUDE.md`. Project-specific overrides: [none, or list].

## Development Environment

### Starting the Stack
```bash
[command 1]
[command 2]
```

### Key Commands
```bash
[command]    [description]
```

### Environment Files
- `.env.local` in `[path]` — local credentials, never committed.
- Local services: [list URLs and ports].
- Dev server: [URL].

## Technology Stack
- [Framework] — [purpose]
- [Database] — [purpose]
- [Other] — [purpose]

## Architecture Rules
- [Rule, with reason]

## Known Implementation Hazards
Brief list. Full detail in Technical Architecture §[N].
1. [Hazard name] — [one-line description] — [file or pattern to apply].
2. ...

## Design Token Rules (if applicable)
- Use CSS custom properties from `[path]` everywhere.
- Never hardcode hex values in component files.
- The single exception is the tokens file itself.

## Critical Brand Rules (if applicable)
1. [Inviolable 1]
2. [Inviolable 2]
3. [Inviolable 3]

## Git Workflow
- Branching: [pattern]
- Commit messages: [convention]
- Merge rules: [rules]

## Session Start Checklist
1. Read `[memory file]` to orient.
2. Read the current phase build checklist section.
3. Read `[deployment progress file]` for environment state.
4. If starting a new phase section: read the relevant spec sections first.

## Document Naming Convention
```
[project]_[topic]_v[major].[minor].md
[project]_test_report_phase[N]_v[major].[minor].md
```
- Major version: significant structural changes.
- Minor version: corrections, additions, changelog entries.
- Every document change includes a changelog entry in that document.
````

## Changelog

**v1.2 — 2026-05-02** Applied patch v1.2 amendments: (1) §3.3 — project CLAUDE.md is a standalone deliverable, not a copy-paste template; Deployment paragraph added after Location; versioning-inside-the-file and source-of-record criteria added to Quality criteria; two new failure modes added (template-in-Setup-Guide and version-not-tracked). (2) §3.4 — maintenance list replaced with explicit version-bump triggers and minor/major classification; both copies updated in the same commit requirement added. (3) §3.2 — global CLAUDE.md explicitly not versioned; criterion added to Quality criteria. (4) Appendix B — Project CLAUDE.md path corrected to `CLAUDE.md` (repository root) with source of record at `docs/CLAUDE_stelavox_project.md`.

**v1.1 — 2026-05-01** Added Section 5.6 (Naming and Versioning) defining the mandatory filename pattern, heading convention, version-bump rules, per-phase document handling, Test Report patch versioning, changelog format, and cross-document reference rules. Stelavox-specific naming and versioning patterns are not used as the reference; rules are derived from first principles.

**v1.0 — 2026-05-01** Initial standard, derived from Stelavox Phase 1 post-implementation review. Defines the philosophy (Part 1), the thirteen-document library (Part 2), the two-layer CLAUDE.md (Part 3), the eight-stage phase lifecycle (Part 4), document quality criteria (Part 5), and the adoption path for new projects (Part 6). Templates in Appendix A. Stelavox mapping in Appendix B.
