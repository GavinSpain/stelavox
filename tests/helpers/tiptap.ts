// Phase 3 — Tiptap content fixtures.
// Spec: stelavox_phase3_test_plan_v1_0.md §1.4
//
// Returns canonical stringified Tiptap JSON for assertions and
// service-role inserts. The shape matches what `editor.getJSON()` produces
// for a single-paragraph document with the given text.

export function tiptapDoc(text: string): string {
  if (!text) {
    return JSON.stringify({ type: 'doc', content: [{ type: 'paragraph' }] })
  }
  return JSON.stringify({
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text }] },
    ],
  })
}

export function tiptapBold(text: string): string {
  return JSON.stringify({
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'text', text, marks: [{ type: 'bold' }] }],
      },
    ],
  })
}

export function tiptapItalic(text: string): string {
  return JSON.stringify({
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'text', text, marks: [{ type: 'italic' }] }],
      },
    ],
  })
}

// Multi-paragraph helper for diff tests.
export function tiptapParagraphs(...texts: string[]): string {
  return JSON.stringify({
    type: 'doc',
    content: texts.map(text => ({
      type: 'paragraph',
      content: [{ type: 'text', text }],
    })),
  })
}
