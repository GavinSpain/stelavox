# Stelavox — Claude Model Selection Advisory
## Version 1.0

> **Operational guidance, not a spec.** This document advises which Claude model (Opus 4.7, Sonnet 4.6, Haiku 4.5) to use at each phase of Stelavox build work. It is not a Tier-A or Tier-B document; it is a reference for cost-effective use of the agent fleet. Update when phase scope changes or when post-phase test reports reveal that a recommended model produced subtle bugs (a signal that the next iteration should upgrade).

**Author:** Established during Phase 1 build, after observing where Opus 4.7 actually earned its keep versus where it was overkill.
**Audience:** Whoever is starting a session to work on Stelavox, before they decide which model to load.
**Companion:** `stelavox_phase1_build_checklist_v1_0.md` and successors; `stelavox_technical_architecture_v1_3.md` §11 (Phase Plan), §5 (Hazards).

---

## 1. The Core Principle

The investment in writing precise Tier-B documents (API Contract, Test Plan, Build Checklist) is what enables cheaper implementation. When the contract is precise, a smaller model can faithfully translate it into code. When the contract has gaps, a smaller model will fill them implicitly, often inconsistently, and the bug will surface only at integration time.

**Therefore:**

- **Opus** for work that produces or reconciles specifications, and for synthesis-heavy work (root-cause analysis, final reviews, hazard-relevant code).
- **Sonnet** for translating already-precise specs into code, and for standard patterns with strong precedent (Next.js routes, Supabase Auth flows, CRUD wrappers, mechanical test cases).
- **Haiku** is rarely warranted for this project; the cost delta to Sonnet is small and the volume of truly mechanical work (renames, reformats) is low.

Do not let the cost gradient flatten your judgment. The right question is not "which model can do this task?" but "where does correctness or subtle reasoning compound, and where does mechanical translation suffice?"

---

## 2. Per-Phase Recommendation

| Phase | Tier-B authoring | Implementation default | Switch up to Opus for |
|---|---|---|---|
| **1** Foundation | Opus (already done) | Sonnet (auth UI, API routes); Opus for migration spec contradictions if found | Spec contradictions; H-02/H-03 trigger work |
| **2** Node tree | **Opus** — H-04 sibling renumber needs careful contract | Sonnet | Reorder transaction logic; cascade RLS |
| **3** Content editing | **Opus** — auto-save races + H-06 serialiser | Sonnet for editor wiring | Auto-save conflict logic; H-06 (Tiptap → plain text); version-restore semantics |
| **4** Context system | **Opus** — 30+ subtypes need precise metadata schemas | Sonnet for CRUD | Metadata schema design; project-vs-document scope queries |
| **5** Agent system | **Opus** — heaviest architectural phase | **Opus more than Sonnet** | Default to Opus; Sonnet only for job-progress UI |
| **6** Locking + workflow | **Opus** — status transitions and lock semantics introduced here | Sonnet | Lock-aware scheduler (H-11); status state machine |
| **7** Export | Opus (briefly — well-spec'd in TA §9) | Sonnet | None expected |
| **8** Polish + V1 release | Opus | Sonnet for UI; Opus for perf + go-live | Performance review; production runbook |
| **V2** multi-tenancy + billing + BYOK | Opus heavy | Sonnet for UI; Opus for security-sensitive code | H-09 BYOK Vault retrieval; Stripe webhook idempotency; audit-log writes |
| **Director** (Roadmap 5) | **Opus** | **Opus throughout** | Default Opus; Sonnet only for conversation thread UI |
| **Document operations** (Roadmap 3a) | Opus | Sonnet for UI; Opus for chunk analyser | Chunk analyser; scope query builder |

---

## 3. Triggers to Switch Up to Opus Mid-Phase

When working on Sonnet, watch for these three triggers. Any one of them is grounds to upgrade for the duration of the affected work, then drop back.

1. **Spec contradiction.** You find that two parts of the Tier-A or Tier-B documents conflict. Sonnet often follows the literal text past the contradiction; Opus is more likely to detect and surface it. (Example from Phase 1: TA §3.6 Migration 011 used `ADD COLUMN` for a column already declared in Migration 001 — a real bug that needed Opus-level reasoning to catch.)

2. **Diagnosis exhausted in 2–3 attempts.** A test fails, the obvious fix doesn't work, and the second hypothesis is also wrong. Stop iterating on Sonnet. Upgrade and re-diagnose from first principles.

3. **Hazard-relevant code.** Any task that touches one of the Known Implementation Hazards (H-01 through H-12) — RLS policies, atomic transactions, prompt-injection defences, BYOK key handling, real-time subscription cleanup, ordering invariants. The hazards exist precisely because they are subtle. Subtle is Opus territory.

---

## 4. Tier-B Authoring Is Always Opus

Across every phase: when writing the API Contract, Test Plan, or Build Checklist, use Opus. The economics are clear — every hour of Opus time spent on a precise contract saves several hours of Sonnet time during implementation, plus avoids the failure mode of Sonnet faithfully implementing an underspecified contract.

This is the one rule with no exceptions in the recommendations above.

---

## 5. Test Report Writing Is Always Opus

The Test Report (per AI-Native Spec Standard §2.12) classifies every failure as one of: specification gap, specification error, implementation gap, environment issue. Each classification produces different downstream actions (spec update, code fix, env fix). The classification step is exactly the kind of synthesis where Sonnet underperforms — it tends to default to "implementation gap" and miss spec-level issues.

Always run the Test Report on Opus, regardless of which model did the implementation.

---

## 6. The 1M-Context Opus Variant

The 1M-context Opus is genuinely useful for two situations:

1. **Tier-B authoring sessions** where multiple long Tier-A documents (Technical Architecture, Product Specification, Component Specification) need to be open simultaneously alongside the document being written.
2. **Final pre-merge reviews** where the whole phase's diff plus the original specs need to be in context together for cross-cutting consistency checks.

For routine build work where only a few files are open at a time, the standard 200k context is sufficient. The 1M variant is more expensive per token; do not run it as a default.

---

## 7. The Director Phase Deserves a Special Note

The Director phase (Product Roadmap Phase 5) is the one phase where this advisory recommends Opus throughout, even for what looks like mechanical UI work. The reason: Director work compounds across components — the tool registry, the agentic loop, the workflow planning, the plan approval gate, the write-tool isolation (H-08), the conversation summarisation, the tool-call validation (§4.5 Defence 4), the downstream impact assessment. Each one is security- or correctness-sensitive on its own, and the integration between them is where subtle bugs hide.

A Director bug is a write-access bug. The Director can modify the entire document tree. A successful prompt injection against the Director is not a content-quality issue; it is a data-integrity incident. Run Opus.

---

## 8. What This Advisory Does Not Cover

- **Cost ceilings or budgets.** This is a capability-driven recommendation, not a cost-optimised one. Apply your own budget constraints on top.
- **Rate limits.** When rate limits force a model choice, note the constraint in the relevant Test Report so the recommendation can be re-evaluated.
- **Non-Stelavox work.** This advisory is specific to the Stelavox codebase, hazards, and phase plan. Do not generalise it.

---

## 9. When to Update This Advisory

Bump the version of this document when any of the following occurs:

- A post-phase Test Report reveals that a recommended model produced subtle bugs that the upgraded model would have caught. The next iteration of that phase or the equivalent work in a later phase should be upgraded.
- A new model family is released (e.g. Opus 5.0, Sonnet 5.0). Re-evaluate the recommendations for each phase.
- Phase scope materially changes in the Technical Architecture's Phase Plan (§11). The new scope may shift the model recommendation.
- A new Hazard is added to the Technical Architecture's Known Implementation Hazards. If the hazard is significant, re-evaluate the phase that touches it.

Per the project's documentation standard, every version bump adds a changelog entry below.

---

## 10. Changelog

**v1.0 — 2026-05-03** Initial advisory. Established during Phase 1 build, after observing where Opus 4.7 (1M context) was load-bearing versus where Sonnet 4.6 would have been sufficient. Per-phase recommendations cover Phases 1–8 (V1), V2 multi-tenancy/billing/BYOK, the Director (Roadmap Phase 5), and Document Operations (Roadmap Phase 3a). Three mid-phase upgrade triggers documented. The Director phase is called out as the one phase where Opus is recommended throughout without exception.
