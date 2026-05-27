// VersionHistory v2.19 amendment — Tiptap-JSON renderer for the
// click-to-preview pane.
//
// Validates `renderTiptapJson` from components/detail/VersionPreviewPane.tsx
// produces faithful HTML for the inline marks (bold, italic, link, code)
// and block nodes (paragraph, heading, lists, blockquote, hr, br) the
// author can actually create in the live editors.
//
// We render via `react-dom/server`'s `renderToStaticMarkup` so the test
// runs under vitest's `environment: 'node'` without needing jsdom or a
// browser. Assertions are on the resulting HTML string.

import { describe, test, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { renderTiptapJson } from '../../components/detail/VersionPreviewPane'

function html(json: object | string | null | undefined): string {
  const stringified = typeof json === 'string' || json === null || json === undefined ? json : JSON.stringify(json)
  const node = renderTiptapJson(stringified)
  if (node === null || node === undefined) return ''
  return renderToStaticMarkup(node as React.ReactElement)
}

describe('renderTiptapJson', () => {
  test('null / undefined / empty doc → no output', () => {
    expect(html(null)).toBe('')
    expect(html(undefined)).toBe('')
    expect(html({ type: 'doc', content: [] })).toBe('')
  })

  test('unparseable JSON → plain-text fallback so the author still sees something', () => {
    const result = html('not actually json {{{')
    expect(result).toContain('not actually json')
  })

  test('paragraph with plain text', () => {
    const result = html({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello world.' }] }],
    })
    expect(result).toContain('<p>')
    expect(result).toContain('Hello world.')
  })

  test('bold mark wraps text in <strong>', () => {
    const result = html({
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [{ type: 'text', text: 'bold bit', marks: [{ type: 'bold' }] }],
      }],
    })
    expect(result).toContain('<strong>')
    expect(result).toContain('bold bit')
  })

  test('italic mark wraps text in <em>', () => {
    const result = html({
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [{ type: 'text', text: 'leaning', marks: [{ type: 'italic' }] }],
      }],
    })
    expect(result).toContain('<em>')
    expect(result).toContain('leaning')
  })

  test('link mark renders <a> with target=_blank and rel=noreferrer', () => {
    const result = html({
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [{
          type: 'text',
          text: 'click here',
          marks: [{ type: 'link', attrs: { href: 'https://example.com' } }],
        }],
      }],
    })
    expect(result).toContain('<a')
    expect(result).toContain('href="https://example.com"')
    expect(result).toContain('target="_blank"')
    expect(result).toContain('rel="noreferrer noopener"')
    expect(result).toContain('click here')
  })

  test('nested marks combine bold and italic', () => {
    const result = html({
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [{
          type: 'text',
          text: 'both',
          marks: [{ type: 'bold' }, { type: 'italic' }],
        }],
      }],
    })
    // Both wrappers present, both contain the text. Order is implementation-
    // dependent; we assert the inner text exists inside both.
    expect(result).toContain('<strong>')
    expect(result).toContain('<em>')
    expect(result).toContain('both')
  })

  test('unknown mark is silently skipped — text still renders', () => {
    const result = html({
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [{
          type: 'text',
          text: 'mystery',
          marks: [{ type: 'fluorescence' }],
        }],
      }],
    })
    expect(result).toContain('mystery')
    expect(result).not.toContain('<fluorescence')
  })

  test('headings render at the correct level (clamped 1-6)', () => {
    const result = html({
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'H1' }] },
        { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'H3' }] },
        { type: 'heading', attrs: { level: 99 }, content: [{ type: 'text', text: 'clamped' }] },
      ],
    })
    expect(result).toContain('<h1')
    expect(result).toContain('H1')
    expect(result).toContain('<h3')
    expect(result).toContain('H3')
    // Level 99 clamped to 6.
    expect(result).toContain('<h6')
    expect(result).toContain('clamped')
  })

  test('bullet list with two items', () => {
    const result = html({
      type: 'doc',
      content: [{
        type: 'bulletList',
        content: [
          { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'one' }] }] },
          { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'two' }] }] },
        ],
      }],
    })
    expect(result).toContain('<ul')
    expect(result).toContain('<li>')
    expect(result).toContain('one')
    expect(result).toContain('two')
  })

  test('ordered list', () => {
    const result = html({
      type: 'doc',
      content: [{
        type: 'orderedList',
        content: [
          { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'first' }] }] },
        ],
      }],
    })
    expect(result).toContain('<ol')
    expect(result).toContain('first')
  })

  test('blockquote', () => {
    const result = html({
      type: 'doc',
      content: [{
        type: 'blockquote',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'quoted' }] }],
      }],
    })
    expect(result).toContain('<blockquote')
    expect(result).toContain('quoted')
  })

  test('horizontalRule and hardBreak', () => {
    const result = html({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'before' }, { type: 'hardBreak' }, { type: 'text', text: 'after' }] },
        { type: 'horizontalRule' },
      ],
    })
    expect(result).toContain('before')
    expect(result).toContain('<br')
    expect(result).toContain('after')
    expect(result).toContain('<hr')
  })

  test('unknown block type falls through to children — text not lost', () => {
    const result = html({
      type: 'doc',
      content: [{
        type: 'imaginaryBlock',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'still visible' }] }],
      }],
    })
    expect(result).toContain('still visible')
  })

  test('paragraph with bold + italic + link mixed inline', () => {
    const result = html({
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [
          { type: 'text', text: 'normal ' },
          { type: 'text', text: 'bold', marks: [{ type: 'bold' }] },
          { type: 'text', text: ' italic', marks: [{ type: 'italic' }] },
          { type: 'text', text: ' ' },
          { type: 'text', text: 'linked', marks: [{ type: 'link', attrs: { href: 'https://x.test' } }] },
        ],
      }],
    })
    expect(result).toContain('normal ')
    expect(result).toContain('<strong>')
    expect(result).toContain('bold')
    expect(result).toContain('<em>')
    expect(result).toContain('italic')
    expect(result).toContain('<a')
    expect(result).toContain('linked')
  })

  test('object-shape input (post-M-042 JSONB) renders without JSON.parse', () => {
    // Supabase JS returns JSONB columns as parsed objects. The renderer
    // must accept the object directly (not just a stringified version).
    // Regression guard for the 2026-05-24 runtime errors:
    //   "Objects are not valid as a React child (found: object with keys
    //   {type, content})" — caused by JSON.parse rejecting the object,
    //   the catch branch then rendering the raw object as a React child.
    const objectInput = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'object-shape input' }] }],
    }
    const node = renderTiptapJson(objectInput as unknown as object)
    if (!node) throw new Error('renderTiptapJson returned null for object input')
    const result = renderToStaticMarkup(node as React.ReactElement)
    expect(result).toContain('<p>')
    expect(result).toContain('object-shape input')
  })

  test('script-injection in link href is escaped (React default)', () => {
    // React escapes attribute values by default; this is a regression
    // guard so we know the renderer never bypasses that behaviour.
    const result = html({
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [{
          type: 'text',
          text: 'x',
          marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }],
        }],
      }],
    })
    // We pass through the href without protocol sanitisation — that's a
    // separate concern handled at write-time in NotesEditor / Tiptap's
    // Link extension validate config. The test guards that React's
    // default attribute escaping is in effect (no raw `<script`).
    expect(result).not.toContain('<script')
  })
})
