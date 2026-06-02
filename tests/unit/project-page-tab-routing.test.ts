// Phase 8.01.E T-8 — Project page tab routing.

import { describe, expect, it } from 'vitest'

import { resolveProjectTab } from '@/app/(app)/projects/[projectId]/_ProjectPageClient'

describe('resolveProjectTab', () => {
  it('default (null) → documents', () => {
    expect(resolveProjectTab(null)).toBe('documents')
  })

  it('undefined → documents', () => {
    expect(resolveProjectTab(undefined)).toBe('documents')
  })

  it('empty string → documents', () => {
    expect(resolveProjectTab('')).toBe('documents')
  })

  it('explicit "documents" → documents', () => {
    expect(resolveProjectTab('documents')).toBe('documents')
  })

  it('explicit "export" → export', () => {
    expect(resolveProjectTab('export')).toBe('export')
  })

  it('unknown value falls back to documents', () => {
    expect(resolveProjectTab('admin')).toBe('documents')
  })
})
