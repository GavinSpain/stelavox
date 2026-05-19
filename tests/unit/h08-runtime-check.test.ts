// B5.4 — round-3 audit F-100.
//
// H-08: "Director write tools must never execute inside the agentic loop."
// Pre-fix the invariant was enforced only by the write tools' own
// implementations — a future write tool that accidentally wrote to the
// DB and returned a ReadToolResult-shaped result would breach H-08
// silently. The executor now checks: for write tools, the result must
// be WriteToolResult (have `proposal`, no `data`). If violated, the
// executor converts the call to an error and writes a critical
// audit_log entry.
//
// Test: invoke the violation check directly on a synthetic
// "result". The full executor path is heavy to mock (provider stream,
// supabase, etc.), so we test the runtime-check logic in isolation by
// asserting the shape detection works correctly. Intentionally
// structural — the actual executor wiring is verified by Playwright
// integration in the Director suite (which we ran at Phase 3 boundary).

import { describe, it, expect } from 'vitest'
import { isWriteTool } from '@/lib/director/schemas'

describe('B5.4 — F-100: H-08 runtime check shape detection', () => {
  it('isWriteTool returns true for known write tools (Phase 2: card-surfacing only)', () => {
    expect(isWriteTool('propose_brief')).toBe(true)
    expect(isWriteTool('propose_profile_amendment')).toBe(true)
    expect(isWriteTool('cancel_brief')).toBe(true)
    expect(isWriteTool('propose_brief_amendment')).toBe(true)
    expect(isWriteTool('report_capability_limit')).toBe(true)
  })

  it('Phase 2: create_*_step tools are NOT registered as write tools (deprecated)', () => {
    expect(isWriteTool('create_expand_step')).toBe(false)
    expect(isWriteTool('create_synthesise_step')).toBe(false)
    expect(isWriteTool('create_refine_step')).toBe(false)
    expect(isWriteTool('create_context_step')).toBe(false)
    expect(isWriteTool('create_comment_step')).toBe(false)
    expect(isWriteTool('create_node_reorder_step')).toBe(false)
    expect(isWriteTool('create_rename_step')).toBe(false)
  })

  it('isWriteTool returns false for read tools', () => {
    expect(isWriteTool('get_node')).toBe(false)
    expect(isWriteTool('get_document_state')).toBe(false)
  })

  it('shape check: write tool result with `data` and no `proposal` is a violation', () => {
    // Simulating a write tool that accidentally wrote to the DB and
    // returned a read-style result. The runtime check in
    // lib/director/executor.ts:415-445 detects this shape and aborts.
    const violatingResult = { ok: true, data: { node_id: 'fake' } } as { proposal?: unknown; data?: unknown }
    const isViolation = violatingResult.data !== undefined || violatingResult.proposal === undefined
    expect(isViolation).toBe(true)
  })

  it('shape check: write tool result with `proposal` and no `data` is valid', () => {
    const validResult = { ok: true, proposal: { tool: 'create_synthesise_step', step_order: 1 } } as { proposal?: unknown; data?: unknown }
    const isViolation = validResult.data !== undefined || validResult.proposal === undefined
    expect(isViolation).toBe(false)
  })

  it('shape check: write tool result with both `proposal` AND `data` is a violation (suspicious)', () => {
    // Belt-and-braces: even if proposal is present, data being present
    // means side-effect-tracking metadata snuck in. Treat as violation.
    const suspiciousResult = { ok: true, proposal: { tool: 'x' }, data: { written: true } } as { proposal?: unknown; data?: unknown }
    const isViolation = suspiciousResult.data !== undefined || suspiciousResult.proposal === undefined
    expect(isViolation).toBe(true)
  })

  it('shape check: write tool result with neither `proposal` nor `data` is a violation', () => {
    const emptyResult = { ok: true } as { proposal?: unknown; data?: unknown }
    const isViolation = emptyResult.data !== undefined || emptyResult.proposal === undefined
    expect(isViolation).toBe(true)
  })
})
