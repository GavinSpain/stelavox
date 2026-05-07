# Director Corpus

Engineered fictional documents for evaluating the Stelavox Director.

This directory implements the corpus described in `docs/stelavox_director_eval_methodology_v1_0.md`. Read that document first if you have not seen it — it explains why this exists and how it is used. This README is an inventory and a how-to.

## What this is

Each subdirectory is a **scenario** — a self-contained fictional document with deliberately seeded issues at known locations, a catalogue of those issues with detection criteria, a set of probe prompts, and a baseline ledger of past evaluation scores.

Scenarios are seeded into a local Supabase via the runner at `scripts/seed-director-fixture.ts`. The runner is idempotent: re-running deletes any prior instance of the scenario and rebuilds it.

## What this is not

- Not creative work for redistribution. The prose is engineered for testing the Director.
- Not training data. If shared with external evaluators, it is shared with explicit notice not to ingest into training sets — once that happens the diagnostic value is gone.
- Not a reference for prose quality. The prose is good enough to be read; the issues are the point.

## Scenarios

| Slug | Layer stack | Word count | Issues | Purpose |
|---|---|---|---|---|
| `j5-novel` | Novel | ~7,000 | 14 catalogued + 1 unscored | Phase 5b launch corpus — Act 1 of a literary-noir thriller. Covers pacing, structure, character, theme, motif, voice, POV, foreshadowing, antagonist presence, want/need craft, tonal seams. |

(Future scenarios will be added here as the corpus grows. The methodology document §11 records the V1 gaps and §7 describes how to add a new scenario.)

## Running a scenario

Prerequisites:
- Supabase local stack running (`supabase status` shows green).
- `.env.local` present at the repo root with `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and (if running probes) `ANTHROPIC_API_KEY`.
- Migration 031 applied locally.

Seed a scenario:

```
npx tsx scripts/seed-director-fixture.ts --scenario j5-novel
```

The runner prints the test-user credentials at the end. Log in to the dev server (`npm run dev`, then `http://localhost:3000`) with those credentials, find the seeded project on the dashboard, open the document, and run probes from the scenario's `probes.md`.

Reset a scenario without `supabase db reset`:

```
npx tsx scripts/seed-director-fixture.ts --scenario j5-novel --reset
```

Reset deletes the scenario's project and recreates it fresh.

## Scoring a run

Open the scenario's `issues.md` and the Director's response transcript side by side. For each catalogued issue, score:

- **✓ Found** — Director output specifically references the location and characterises the issue consistently with the catalogue.
- **◐ Partial** — Output identifies location or symptom but mischaracterises the underlying problem.
- **✗ Missed** — Issue not surfaced.
- **— N/A** — The probe does not exercise this issue.

Aggregate by subtlety level (L1/L2/L3/L4). Append a row to the scenario's `baselines.md` with the date, model, prompt commit SHA, and per-level detection rates.

## Adding a scenario

See `docs/stelavox_director_eval_methodology_v1_0.md` §7 for the canonical procedure. Summary: design the issue ledger first, then write prose to carry the issues, then probes, then run a baseline.
