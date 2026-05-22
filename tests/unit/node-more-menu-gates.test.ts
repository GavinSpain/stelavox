/**
 * Tests for NodeMoreMenu's writability-gating helpers.
 *
 * The user-reported bug (2026-05-22): a beat under a scene held by an
 * in-flight agent_job exposed an enabled Delete menu item; the delete
 * dialog opened; the API returned 423; nothing happened user-visibly.
 *
 * The fix routes every menu action through computeMenuGates() which
 * consumes blocker results from `check_node_writable` and disables
 * actions appropriately. These tests pin:
 *
 *   1. Rename / Status / Lock disable on any self-node blocker.
 *   2. Delete additionally disables on a parent blocker
 *      (the route checks both per app/api/nodes/[nodeId]/route.ts:357-362).
 *   3. Author-lock state surfaces via isAuthorLocked so the menu can
 *      render Unlock instead of Lock.
 *   4. Tooltip strings distinguish self vs parent so the user knows
 *      WHICH node is locked when Delete is the blocked action.
 */

import { describe, expect, it } from 'vitest'

import { blockerLabel, computeMenuGates } from '@/components/tree/NodeMoreMenu'

describe('NodeMoreMenu — writability-gating helpers', () => {
  describe('blockerLabel', () => {
    it('returns empty string for null blocker', () => {
      expect(blockerLabel(null, 'self')).toBe('')
      expect(blockerLabel(null, 'parent')).toBe('')
    })

    it('distinguishes self vs parent for in-progress', () => {
      expect(blockerLabel('node_in_progress', 'self'))
        .toBe('An agent is working on this node')
      expect(blockerLabel('node_in_progress', 'parent'))
        .toBe('Parent is being edited by an agent')
    })

    it('distinguishes self vs parent for author lock', () => {
      expect(blockerLabel('author_locked', 'self')).toBe('This node is locked')
      expect(blockerLabel('author_locked', 'parent')).toBe('Parent is locked')
    })

    it('distinguishes self vs parent for in-use (edit session)', () => {
      expect(blockerLabel('node_in_use', 'self'))
        .toBe('Another user is editing this node')
      expect(blockerLabel('node_in_use', 'parent'))
        .toBe('Parent is being edited by another user')
    })
  })

  describe('computeMenuGates', () => {
    it('returns all gates open when both nodes are writable', () => {
      const g = computeMenuGates(null, null)
      expect(g.isAuthorLocked).toBe(false)
      expect(g.isLocked).toBe(false)
      expect(g.deleteBlocked).toBe(false)
      expect(g.selfReason).toBe('')
      expect(g.deleteReason).toBe('')
    })

    it('flags isAuthorLocked when self blocker is author_locked', () => {
      const g = computeMenuGates('author_locked', null)
      expect(g.isAuthorLocked).toBe(true)
      expect(g.isLocked).toBe(true)
      expect(g.deleteBlocked).toBe(true)
      expect(g.selfReason).toBe('This node is locked')
    })

    it('flags isLocked but not isAuthorLocked on agent-in-flight', () => {
      // This is the exact scenario the user hit — phantom expand job
      // holds the scene; the beat itself is writable; Delete must be
      // blocked from the menu side, not just the route.
      const g = computeMenuGates('node_in_progress', null)
      expect(g.isAuthorLocked).toBe(false)
      expect(g.isLocked).toBe(true)
      expect(g.deleteBlocked).toBe(true)
      expect(g.selfReason).toBe('An agent is working on this node')
    })

    it('blocks Delete on parent in-flight even when self is writable', () => {
      // The user's actual case: delete a beat (writable) whose parent
      // scene is in-progress (not writable). Route returns 423; menu
      // must mirror that.
      const g = computeMenuGates(null, 'node_in_progress')
      expect(g.isAuthorLocked).toBe(false)
      expect(g.isLocked).toBe(false)
      expect(g.deleteBlocked).toBe(true)
      // Rename / Status / Lock all stay enabled — they only check self.
      expect(g.selfReason).toBe('')
      // But Delete's tooltip names the parent as the reason.
      expect(g.deleteReason).toBe('Parent is being edited by an agent')
    })

    it('blocks Delete on parent author_locked', () => {
      const g = computeMenuGates(null, 'author_locked')
      expect(g.isLocked).toBe(false)
      expect(g.deleteBlocked).toBe(true)
      expect(g.deleteReason).toBe('Parent is locked')
    })

    it('blocks Delete on parent in-use (edit session)', () => {
      const g = computeMenuGates(null, 'node_in_use')
      expect(g.isLocked).toBe(false)
      expect(g.deleteBlocked).toBe(true)
      expect(g.deleteReason).toBe('Parent is being edited by another user')
    })

    it('prefers self-reason over parent-reason when both blocked', () => {
      // Self-reason wins because it's the more specific failure for
      // most user-visible actions; the parent reason still applies
      // to Delete but the user's first impediment is on this node.
      const g = computeMenuGates('node_in_progress', 'author_locked')
      expect(g.isLocked).toBe(true)
      expect(g.deleteBlocked).toBe(true)
      expect(g.selfReason).toBe('An agent is working on this node')
      expect(g.deleteReason).toBe('An agent is working on this node')
    })
  })
})
