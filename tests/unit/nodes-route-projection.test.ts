/**
 * Phase 8.5b B.2a — Endpoint projection (back-compat addition).
 *
 * Vitest cases for `lib/data/nodes.ts:buildNodeSelect` + the route
 * handler's `?include=` parsing. B.2a's contract is:
 *   - default (no ?include=) returns 'full' projection (back-compat)
 *   - ?include=* returns 'full' (explicit escape hatch)
 *   - ?include=summary returns structural + summary
 *   - ?include=summary,prose returns structural + both
 *   - ?include=unknown returns 400 (validation precedes Supabase call)
 *   - projection happens via SELECT column list at the DB layer
 *
 * Refs: docs/stelavox_phase8_5b_test_plan_v1_0.md §2 (TC-8.5b-B2a-01..08)
 *       docs/stelavox_document_load_architecture_v1_0.md §2.1 §2.5
 *       lib/data/nodes.ts buildNodeSelect()
 */

import { describe, expect, it } from 'vitest'

import { buildNodeSelect, type NodeProjection } from '@/lib/data/nodes'

describe('Phase 8.5b B.2a — endpoint projection contract', () => {
  // ───────────────────────────────────────────────────────────────────
  // TC-8.5b-B2a-01 — Default 'full' returns the pre-B.2a SELECT.
  // GIVEN no projection parameter (back-compat default).
  // WHEN buildNodeSelect('full') is called.
  // THEN the resulting SELECT includes every content column the
  //      pre-B.2a NODE_SELECT carried: prose, summary, notes, metadata.
  // ───────────────────────────────────────────────────────────────────
  it("TC-8.5b-B2a-01 — 'full' includes all content columns", () => {
    const sel = buildNodeSelect('full')
    expect(sel).toContain('prose')
    expect(sel).toContain('summary')
    expect(sel).toContain('notes')
    expect(sel).toContain('metadata')
    expect(sel).toContain('short_description')
    expect(sel).toContain('tags')
    expect(sel).toContain('agent_instruction')
    // Structural columns also present.
    expect(sel).toContain('id')
    expect(sel).toContain('parent_id')
    expect(sel).toContain('name')
    expect(sel).toContain('status')
    expect(sel).toContain('word_count_actual')
    expect(sel).toContain('word_count_target')
  })

  // ───────────────────────────────────────────────────────────────────
  // TC-8.5b-B2a-02 — 'structural' drops content columns.
  // GIVEN projection='structural'.
  // WHEN buildNodeSelect is called.
  // THEN the SELECT excludes prose / summary / notes / metadata
  //      / short_description / tags / agent_instruction; structural
  //      fields remain.
  // ───────────────────────────────────────────────────────────────────
  it("TC-8.5b-B2a-02 — 'structural' excludes content fields", () => {
    const sel = buildNodeSelect('structural')
    expect(sel).not.toContain('prose')
    expect(sel).not.toContain('summary')
    expect(sel).not.toContain('notes')
    expect(sel).not.toContain('metadata')
    expect(sel).not.toContain('short_description')
    expect(sel).not.toContain('tags')
    expect(sel).not.toContain('agent_instruction')
    // Structural fields still present.
    expect(sel).toContain('id')
    expect(sel).toContain('parent_id')
    expect(sel).toContain('name')
    expect(sel).toContain('status')
    expect(sel).toContain('word_count_actual')
    expect(sel).toContain('word_count_target')
    expect(sel).toContain('updated_at')
    expect(sel).toContain('last_ai_change_at')
  })

  // ───────────────────────────────────────────────────────────────────
  // TC-8.5b-B2a-03 — ['summary'] adds summary, no other content.
  // GIVEN projection=['summary'] (the route's parsing of ?include=summary).
  // WHEN buildNodeSelect is called.
  // THEN the SELECT contains summary but NOT prose / notes / metadata
  //      / short_description / tags / agent_instruction.
  // ───────────────────────────────────────────────────────────────────
  it("TC-8.5b-B2a-03 — ['summary'] includes only summary", () => {
    const sel = buildNodeSelect(['summary'])
    expect(sel).toContain('summary')
    expect(sel).not.toContain('prose')
    expect(sel).not.toContain('notes')
    expect(sel).not.toContain('metadata')
    expect(sel).not.toContain('short_description')
    expect(sel).not.toContain('tags')
    expect(sel).not.toContain('agent_instruction')
  })

  // ───────────────────────────────────────────────────────────────────
  // TC-8.5b-B2a-04 — ['prose'] adds prose, no other content.
  // GIVEN projection=['prose'].
  // WHEN buildNodeSelect is called.
  // THEN the SELECT contains prose but NOT summary / notes / metadata.
  // ───────────────────────────────────────────────────────────────────
  it("TC-8.5b-B2a-04 — ['prose'] includes only prose", () => {
    const sel = buildNodeSelect(['prose'])
    expect(sel).toContain('prose')
    expect(sel).not.toContain('summary')
    expect(sel).not.toContain('notes')
    expect(sel).not.toContain('metadata')
  })

  // ───────────────────────────────────────────────────────────────────
  // TC-8.5b-B2a-05 — ['summary','prose'] includes both.
  // GIVEN projection=['summary','prose'].
  // WHEN buildNodeSelect is called.
  // THEN the SELECT contains both summary and prose; not notes/metadata.
  // ───────────────────────────────────────────────────────────────────
  it("TC-8.5b-B2a-05 — ['summary','prose'] includes both", () => {
    const sel = buildNodeSelect(['summary', 'prose'])
    expect(sel).toContain('summary')
    expect(sel).toContain('prose')
    expect(sel).not.toContain('notes')
    expect(sel).not.toContain('metadata')
  })

  // ───────────────────────────────────────────────────────────────────
  // TC-8.5b-B2a-06 — Empty array equivalent to 'structural'.
  // GIVEN projection=[] (caller passed ?include= with no value).
  // WHEN buildNodeSelect is called.
  // THEN the SELECT equals the structural projection (no extras).
  // ───────────────────────────────────────────────────────────────────
  it("TC-8.5b-B2a-06 — empty array equivalent to 'structural'", () => {
    const selStructural = buildNodeSelect('structural')
    const selEmpty = buildNodeSelect([] as readonly string[])
    expect(selEmpty).toBe(selStructural)
  })

  // ───────────────────────────────────────────────────────────────────
  // TC-8.5b-B2a-07 — Unknown include silently ignored at the lib layer.
  // GIVEN projection=['unknown_field'] reaching buildNodeSelect (this
  //       should never happen because the route validates first, but
  //       defence-in-depth: the lib silently skips unknown fields).
  // WHEN buildNodeSelect is called.
  // THEN the SELECT equals the structural projection.
  //
  // NOTE: the route handler's parseProjection rejects unknown fields
  // before this function is reached — caller-facing 400 is verified in
  // a separate integration test (Playwright TC-8.5b-B2b-06).
  // ───────────────────────────────────────────────────────────────────
  it("TC-8.5b-B2a-07 — unknown field at lib layer falls through to 'structural'", () => {
    const selStructural = buildNodeSelect('structural')
    const selUnknown = buildNodeSelect(['unknown_field' as never])
    expect(selUnknown).toBe(selStructural)
  })

  // ───────────────────────────────────────────────────────────────────
  // TC-8.5b-B2a-08 — Projection produced is a comma-separated SELECT
  // string that PostgREST can consume directly. Verifies the helper
  // emits well-formed column lists (no double-commas, no trailing
  // commas, "order" stays double-quoted, etc.).
  // ───────────────────────────────────────────────────────────────────
  it("TC-8.5b-B2a-08 — SELECT string is well-formed for PostgREST", () => {
    const projections: NodeProjection[] = ['full', 'structural', ['summary'], ['prose'], ['summary', 'prose'], []]
    for (const p of projections) {
      const sel = buildNodeSelect(p)
      // No double commas, no trailing comma.
      expect(sel).not.toMatch(/,\s*,/)
      expect(sel).not.toMatch(/,\s*$/)
      // "order" stays quoted (PostgREST reserved word).
      expect(sel).toContain('"order"')
      // No surrounding whitespace.
      expect(sel.trim()).toBe(sel)
    }
  })

  // ─── B.2b — default flip ─────────────────────────────────────────────

  // ───────────────────────────────────────────────────────────────────
  // TC-8.5b-B2b-01 — Structural projection drops at least 6 column
  // groups (prose, summary, notes, metadata, short_description, tags,
  // agent_instruction — 7 specific names). Wire-payload savings are
  // exercised by the Playwright suite against the mega-doc fixture;
  // this unit assertion only verifies the column-list shape.
  // ───────────────────────────────────────────────────────────────────
  it("TC-8.5b-B2b-01 — structural projection has 7+ fewer columns than full", () => {
    const fullCols = new Set(buildNodeSelect('full').split(',').map(s => s.trim()))
    const structuralCols = new Set(buildNodeSelect('structural').split(',').map(s => s.trim()))
    expect(fullCols.size - structuralCols.size).toBeGreaterThanOrEqual(7)
    // The seven dropped fields (all content):
    for (const f of ['summary', 'prose', 'notes', 'metadata', 'short_description', 'tags', 'agent_instruction']) {
      expect(fullCols.has(f)).toBe(true)
      expect(structuralCols.has(f)).toBe(false)
    }
  })

  // ───────────────────────────────────────────────────────────────────
  // TC-8.5b-B2b-02 — Full projection contains all opt-in column groups.
  // ───────────────────────────────────────────────────────────────────
  it("TC-8.5b-B2b-02 — 'full' is the union of structural + every include opt-in", () => {
    const full = buildNodeSelect('full')
    const allOptIns = buildNodeSelect(['summary', 'prose', 'notes', 'metadata'])
    // Every column in 'full' should also be in allOptIns (set equality).
    const fullCols = new Set(full.split(',').map(s => s.trim()))
    const allCols = new Set(allOptIns.split(',').map(s => s.trim()))
    for (const col of fullCols) expect(allCols.has(col)).toBe(true)
    for (const col of allCols) expect(fullCols.has(col)).toBe(true)
  })

  // ───────────────────────────────────────────────────────────────────
  // TC-8.5b-B2b-03 — Structural projection contains the columns required
  // by the tree renderer + leaf derivation + locking + AI-changed flag.
  // ───────────────────────────────────────────────────────────────────
  it("TC-8.5b-B2b-03 — structural projection includes all tree-renderer fields", () => {
    const sel = buildNodeSelect('structural')
    // Tree renderer needs these structural fields. If any are missing,
    // the tree component renders incomplete rows.
    const required = [
      'id', 'parent_id', '"order"', 'depth', 'layer_index',
      'node_type', 'name', 'status',
      'word_count_actual', 'word_count_target',
      'updated_at', 'created_at',
      // V1.x-D.2 — NodeRow AI-changed flag.
      'last_ai_change_at',
    ]
    for (const col of required) {
      expect(sel).toContain(col)
    }
  })
})
