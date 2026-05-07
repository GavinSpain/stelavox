# Scenario: j5-novel

> **Fixture content — not for redistribution and not for model training.** All characters, places, and institutions are fictional. Any resemblance to real persons or organisations is coincidental.

## Purpose

The `j5-novel` scenario implements the §J5 user-journey from `stelavox_product_specification_v1_7.md` as a runnable test fixture. It is the V1 launch corpus for the Phase 5b Director and the reference scenario for the eval methodology described in `docs/stelavox_director_eval_methodology_v1_0.md`.

The fixture is Act 1 of a hypothetical literary-noir thriller — *The November Set* — covering Detective Halsey Voss's investigation of a missing young woman from a halfway house. Six chapters, roughly seven thousand words of original prose, with fourteen catalogued issues distributed across the four subtlety levels.

## Story scope

**Genre:** Literary-noir thriller, contemporary, third-person-close, present tense.

**Premise:** Detective Halsey Voss, recently returned to active duty after the death of her teenage daughter Liana, investigates the disappearance of Maya Reilly — a twenty-year-old resident of the Calder Street halfway house in a rust-belt city. The institution receives city grants administered by Councillor Marcus Bracket, who has property interests in the surrounding blocks. Act 1 covers Voss's arrival at the halfway house through the discovery that locks her into the case beyond turning back.

**Act 1 structure:**

| Chapter | Title | State | Purpose |
|---|---|---|---|
| 1 | The November Set | **Locked** | Establishes voice, place, missing person. Strongest prose in Act 1 by design. |
| 2 | Cold Mailbox | Open | Maya's room, her notebook, visit to her mother. |
| 3 | The Diner | Open | Voss's old partner Reuben; internal grief beat; confrontation with a guard. |
| 4 | Open House | Open | Dawn alone in the car; community meeting; Bracket glimpsed. |
| 5 | Bracket Files | Open | Research; Reuben warns Voss off; threatening text. |
| 6 | The Lot Behind | Open | Resident's revelation; Maya's broken phone in the empty lot; Act 1 climax. |

Chapter 1 is locked deliberately — it exercises the Director's lock-respect rule and provides a clean reference point for the §J5 plan-card lock warning row.

## Files

| File | Purpose |
|---|---|
| `README.md` | This document |
| `issues.md` | Catalogued issues with locations, descriptions, and detection criteria |
| `structure.ts` | Tree shape — node depth, layer index, type, name, parent path |
| `content.ts` | Per-node summaries and per-leaf prose payload |
| `context.ts` | Context nodes (Voss, Bracket, halfway house, the city, institutional-rot theme) |
| `probes.md` | Probe prompts: J5 happy path, targeted, lock, adversarial |
| `baselines.md` | Historical scores by model + date + commit |

## How this scenario maps to the methodology

Per `docs/stelavox_director_eval_methodology_v1_0.md`:

- **§3 subtlety levels** — All four levels exercised. L1 × 4, L2 × 4, L3 × 4, L4 × 3 catalogued issues, plus one unscored craft observation (Chapter 1 prose-quality differential).
- **§5 eval cadence** — Used at T-17.1 (J5 walkthrough), T-17.2 (adversarial), T-18.3 (cloud smoke). Pre-merge, model-upgrade, and quarterly drift cadences also draw from this scenario.
- **§6 adversarial probes** — All six adversarial categories represented in `probes.md`. Includes one content-injection probe via a deliberately-seeded `[SYSTEM]` directive embedded in Maya's notebook node.

## Issue density and distribution

The catalogue carries fourteen scored issues. Distribution by surface:

| Surface | Issues | Levels |
|---|---|---|
| Pacing | 2 | L1, L2 |
| Structure / ordering | 1 | L1 |
| Repetition | 1 | L1 |
| Character (mechanics) | 1 | L1 |
| POV | 1 | L2 |
| Voice | 1 | L2 |
| Foreshadowing | 1 | L2 |
| Antagonist presence | 1 | L3 |
| Theme | 1 | L3 |
| Motif | 1 | L3 |
| Character (arc) | 1 | L3 |
| Want/need craft | 1 | L4 |
| Implicit characterisation | 1 | L4 |
| Tonal register | 1 | L4 |

Plus the unscored craft observation about Chapter 1 prose quality.

A capable Director should find most L1 issues from a happy-path probe, a meaningful fraction of L2 issues, some L3 issues, and the occasional L4 issue. The launch detection-rate calibration (per methodology §3) is L1 ≥ 80%, L2 ≥ 50%, L3 ≥ 25%, L4 occasional.

## Reset

```
npx tsx scripts/seed-director-fixture.ts --scenario j5-novel --reset
```

Idempotent. Deletes the prior `j5-novel` project for the test user and recreates from `structure.ts` + `content.ts` + `context.ts`.

## Test user

The seed runner ensures the test user exists:

- email: `j5-walk@example.com`
- password: `Test1234!Test1234!`

Log in with these credentials to walk the scenario in the browser.
