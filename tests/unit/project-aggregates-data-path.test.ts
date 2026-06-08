// Phase 8.5b B.1 — SUPERSEDED.
//
// Original purpose (Phase 8.01.D wireframe-review): these tests guarded
// against the `.eq('is_leaf', true)` anti-pattern in projectAggregates.ts
// that returned wordsDrafted=0 on every ProjectCard.
//
// Why superseded:
//   - B.1 replaces the from('nodes')-with-TS-sum implementation with a
//     direct call to the get_project_rollup Postgres RPC (M-212)
//   - The `.eq('is_leaf', true)` anti-pattern is structurally impossible
//     in the new shape — leafness is computed in SQL as layer_index =
//     MAX(layer_index) per document, inside the RPC body
//   - The behavioural contract these tests pinned (correct word totals,
//     leaf-only sum, document count, last_updated_at) is covered more
//     directly by:
//       - tests/unit/rollup-rpcs.test.ts (TC-8.5b-B1-01..15) — verifies
//         the RPC against three real fixtures (Sample Novel, Shadow
//         Protocol, Mega Manuscript)
//       - tests/v1x-phase8-5b/dashboard-mega-doc.spec.ts (TC-8.5b-B1-11..14)
//         — verifies the dashboard renders the rollup values end-to-end
//
// The file is preserved so that grep results for the old TC numbers
// land on this note rather than a 404. Future contributors: add new
// tests to the files referenced above, not here.
//
// Refs: docs/stelavox_phase8_5b_test_plan_v1_0.md §1
//       docs/stelavox_document_load_architecture_v1_0.md §4
//       supabase/migrations/20260608000212_document_and_project_rollup_rpcs.sql

import { describe, it } from 'vitest'

describe('getProjectAggregates — data-path regression guards (SUPERSEDED)', () => {
  it.skip('All previous T-1..T-12 cases — see rollup-rpcs.test.ts + dashboard-mega-doc.spec.ts', () => {
    // Intentionally empty. See header for supersession notes.
  })
})
