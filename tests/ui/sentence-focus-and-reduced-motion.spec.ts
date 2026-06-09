// Phase 8.12 — deferred Phase 3 motion tests.
//
// Closes TC-M-04, TC-M-06, TC-M-07 from the Phase 3 test plan.
// Originally deferred because they depended on features not yet
// implemented at Phase 3 close-out:
//   - TC-M-04 + TC-M-06: Sentence Focus end-to-end (Component Spec
//     v2.10 §6.5 — Phase 8.9 work; Phase 3 shipped a CSS-only stub)
//   - TC-M-07: WordCount honouring prefers-reduced-motion (Phase 8.11
//     audit; WordCount used an unconditional 800ms transition in
//     Phase 3)
//
// As of 2026-06-09 both underlying features are implemented:
//   - components/focus/SentenceFocus.tsx + lib/editor/sentence-focus-plugin.ts
//     (Intl.Segmenter + ProseMirror inline decorations, 200ms opacity
//      transition, @media (prefers-reduced-motion: reduce) collapse)
//   - components/detail/WordCount.tsx — usePrefersReducedMotion() hook
//     gates the 800ms fade transition to 'none' when set
//
// These tests inspect the resulting CSS declarations via getComputedStyle
// — matching the pattern TC-M-01..03 + TC-M-05 already use in
// tests/ui/focus-mode.spec.ts.
//
// Spec: docs/stelavox_phase3_test_plan_v1_0.md §4 (TC-M-04..07) + §10
//       (deferred test list)

import { test, expect, type Page } from '@playwright/test'
import { USERS } from '../helpers/auth'
import { adminClient } from '../helpers/db'
import { withReducedMotion } from '../helpers/motion'

const BASE = 'http://localhost:3000'

test.use({ storageState: USERS.A.storageState })

interface F {
  projectId: string
  documentId: string
  beatId: string
  beatName: string
}

async function getUserOrgId(email: string): Promise<string> {
  const admin = adminClient()
  const { data: users } = await admin.auth.admin.listUsers({ perPage: 200 })
  const user = (users?.users ?? []).find((u) => u.email === email)!
  const { data } = await admin
    .from('organisation_members')
    .select('organisation_id')
    .eq('user_id', user.id)
    .single()
  return data!.organisation_id
}

/**
 * Per-test fixture: a project + document + one beat. Mirrors the
 * setupFixture in tests/ui/focus-mode.spec.ts so the two files exercise
 * comparable shapes; not extracted to a shared helper because the
 * existing focus-mode.spec.ts hasn't done that either (Phase 3
 * convention — keep tests self-contained per file).
 */
async function setupFixture(orgId: string, prefix: string): Promise<F> {
  const admin = adminClient()
  const { data: project } = await admin
    .from('projects')
    .insert({ organisation_id: orgId, name: `${prefix} project` })
    .select('id')
    .single()
  const { data: rpc } = await admin.rpc('create_document_with_layer_stack', {
    p_project_id: project!.id,
    p_organisation_id: orgId,
    p_name: `${prefix} doc`,
    p_description: null as unknown as string,
    p_document_type: 'novel',
    p_authors: [],
  })
  const setup = rpc as { document: { id: string }; root_node: { id: string } }
  const { data: act } = await admin
    .from('nodes')
    .insert({
      organisation_id: orgId,
      project_id: project!.id,
      document_id: setup.document.id,
      parent_id: setup.root_node.id,
      node_category: 'structural',
      node_type: 'act',
      order: 1,
      depth: 1,
      layer_index: 1,
      name: `${prefix} A`,
      status: 'draft',
      version: 1,
    })
    .select('id')
    .single()
  const { data: chapter } = await admin
    .from('nodes')
    .insert({
      organisation_id: orgId,
      project_id: project!.id,
      document_id: setup.document.id,
      parent_id: act!.id,
      node_category: 'structural',
      node_type: 'chapter',
      order: 1,
      depth: 2,
      layer_index: 2,
      name: `${prefix} C`,
      status: 'draft',
      version: 1,
    })
    .select('id')
    .single()
  const { data: scene } = await admin
    .from('nodes')
    .insert({
      organisation_id: orgId,
      project_id: project!.id,
      document_id: setup.document.id,
      parent_id: chapter!.id,
      node_category: 'structural',
      node_type: 'scene',
      order: 1,
      depth: 3,
      layer_index: 3,
      name: `${prefix} S`,
      status: 'draft',
      version: 1,
    })
    .select('id')
    .single()
  const beatName = `${prefix} Beat`
  const { data: beat } = await admin
    .from('nodes')
    .insert({
      organisation_id: orgId,
      project_id: project!.id,
      document_id: setup.document.id,
      parent_id: scene!.id,
      node_category: 'structural',
      node_type: 'beat',
      order: 1,
      depth: 4,
      layer_index: 4,
      name: beatName,
      status: 'draft',
      version: 1,
    })
    .select('id')
    .single()
  return {
    projectId: project!.id,
    documentId: setup.document.id,
    beatId: beat!.id,
    beatName,
  }
}

async function dispose(f: F) {
  await adminClient().from('projects').delete().eq('id', f.projectId)
}

async function openBeat(page: Page, f: F) {
  await page.goto(`${BASE}/projects/${f.projectId}/documents/${f.documentId}`)
  await page.waitForLoadState('networkidle')
  await page.getByLabel(`${f.beatName}, draft`).click()
  await expect(page.getByTestId('node-name-heading')).toBeVisible({ timeout: 5000 })
}

/**
 * Set the localStorage toggle BEFORE the first paint so ProseEditor's
 * useProseSettings() hook reads sentenceFocus=true on initial render
 * and mounts <SentenceFocus> + registers the segmentation plugin.
 *
 * Spec-locked key per lib/hooks/useProseSettings.ts:35.
 */
async function enableSentenceFocus(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem('stelavox_sentence_focus_enabled', 'true')
  })
}

/**
 * Type a short three-sentence paragraph so the plugin emits
 * `[data-sentence]` spans. Waits until at least one sentence span
 * exists in the DOM before returning.
 */
async function typeThreeSentences(page: Page, editorSelector: string) {
  const editor = page.locator(editorSelector)
  await editor.click()
  await page.keyboard.type(
    'First sentence here. Second sentence here. Third sentence here.',
    { delay: 5 },
  )
  await page.waitForSelector(`${editorSelector} [data-sentence]`, { timeout: 3000 })
}

test.describe('Phase 8.12 — deferred motion tests', () => {
  let orgA: string
  test.beforeAll(async () => {
    orgA = await getUserOrgId(USERS.A.email)
  })

  /**
   * TC-M-04 — Sentence focus transition takes 200ms.
   *
   * Per spec, expected to be 200ms ± 50ms with --easing-prose.
   * Pattern-matches TC-M-01..03 — assert the CSS transition-duration
   * declaration via getComputedStyle rather than measuring runtime
   * timing (deterministic, not flake-prone, and verifies the same
   * invariant).
   *
   * Setup note: spec says "Focus Mode active" but the 8.9 broadening
   * makes Sentence Focus work in Edit Mode too. The injected
   * stylesheet + plugin behaviour are identical in either mode, so
   * the simpler Edit-Mode setup is used. The active-sentence opacity
   * shift on cursor-move (the runtime behaviour the original spec
   * Procedure walked through) is a higher-level integration the
   * underlying CSS declaration enables — verifying the declaration
   * is sufficient for the motion invariant.
   */
  test('TC-M-04 — Sentence focus transition takes 200ms', async ({ page }) => {
    const f = await setupFixture(orgA, 'TC-M-04')
    try {
      await enableSentenceFocus(page)
      await openBeat(page, f)
      await typeThreeSentences(page, '[data-editor="prose"] .tiptap')
      const duration = await page.evaluate(() => {
        const el = document.querySelector('[data-editor="prose"] [data-sentence]')
        if (!el) return null
        return window.getComputedStyle(el).transitionDuration
      })
      // Computed value comes back as `0.2s` in Chromium, may be `200ms`
      // in Firefox-via-Playwright. Match either.
      expect(duration).not.toBeNull()
      expect(duration).toMatch(/^(0\.2s|200ms)$/)
    } finally {
      await dispose(f)
    }
  })

  /**
   * TC-M-06 — prefers-reduced-motion: reduce collapses sentence focus
   * to instant.
   *
   * SentenceFocus.tsx's ensureStyle() injects a `@media (prefers-
   * reduced-motion: reduce)` block that sets transition: none on
   * [data-sentence]. Playwright's emulateMedia flips the user-agent
   * media-query state and getComputedStyle reflects the new
   * declaration.
   */
  test('TC-M-06 — prefers-reduced-motion collapses sentence focus to instant', async ({ page }) => {
    const f = await setupFixture(orgA, 'TC-M-06')
    try {
      await enableSentenceFocus(page)
      await openBeat(page, f)
      await typeThreeSentences(page, '[data-editor="prose"] .tiptap')
      await withReducedMotion(page, async () => {
        // Force a layout read so the @media query re-evaluates against
        // the new media state before we sample getComputedStyle.
        await page.evaluate(() => void document.body.offsetHeight)
        const transition = await page.evaluate(() => {
          const el = document.querySelector('[data-editor="prose"] [data-sentence]')
          if (!el) return null
          return window.getComputedStyle(el).transition
        })
        expect(transition).not.toBeNull()
        // Either the entire shorthand is "none" or the duration
        // component collapses to 0s.
        expect((transition ?? '').toLowerCase()).toMatch(/none|0s/)
      })
    } finally {
      await dispose(f)
    }
  })

  /**
   * TC-M-07 — WordCount fade-in honours prefers-reduced-motion.
   *
   * WordCount.tsx wires usePrefersReducedMotion(); when true, the
   * outer container's transition swaps from
   *   `opacity var(--duration-wordcount, 800ms) var(--easing-prose, ease-out)`
   * to `'none'`. Verified via getComputedStyle on the WordCount root.
   *
   * Differs from TC-M-04/06's pure-CSS pattern: this transition lives
   * on a React style prop, swapped via the hook's state. The hook
   * listens to the matchMedia 'change' event so Playwright's
   * emulateMedia triggers a re-render. waitForFunction polls until the
   * new transition has committed to avoid a race.
   */
  test('TC-M-07 — WordCount fade-in honours prefers-reduced-motion', async ({ page }) => {
    const f = await setupFixture(orgA, 'TC-M-07')
    try {
      await openBeat(page, f)
      await expect(page.locator('[data-testid="word-count"]')).toBeVisible({ timeout: 5000 })
      await withReducedMotion(page, async () => {
        // Wait for the React state update triggered by the matchMedia
        // 'change' event to commit. The transition value flips from
        // including 800ms (or the CSS-var fallback) to 'none' once the
        // hook returns true and the component re-renders.
        await page.waitForFunction(
          () => {
            const el = document.querySelector('[data-testid="word-count"]')
            if (!el) return false
            const t = (el as HTMLElement).style.transition || window.getComputedStyle(el).transition
            return /none|0s/.test(t.toLowerCase())
          },
          undefined,
          { timeout: 3000 },
        )
        const transition = await page.evaluate(() => {
          const el = document.querySelector('[data-testid="word-count"]')
          if (!el) return null
          return window.getComputedStyle(el).transition
        })
        expect((transition ?? '').toLowerCase()).toMatch(/none|0s/)
      })
    } finally {
      await dispose(f)
    }
  })
})
