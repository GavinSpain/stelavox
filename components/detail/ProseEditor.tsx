'use client'

// Spec: stelavox_component_specification_v2_1.md §5.4 (ProseEditor)
//       §5.5 (ProseEditorCursor), §5.6 (SelectionTooltip via T-3.3)
// 🔒 Inviolable #4: Lora ONLY — never Inter. data-editor="prose" in globals.css.
// 🔒 Inviolable #5: no persistent toolbar. Formatting via SelectionTooltip + ⌘B/⌘I.
// 🔒 Inviolable #1: bg always --color-bg-base in both modes.

import { useEditor, EditorContent } from '@tiptap/react'
import { useEffect, useRef } from 'react'
import { proseExtensions } from '@/lib/editor/extensions'
import { fromStorage, toStorage } from '@/lib/editor/serialise'
import { attachTypingDetector } from '@/lib/editor/typing-state'
import { SelectionTooltip } from './SelectionTooltip'
import { WordCount } from './WordCount'

interface ProseEditorProps {
  value: string | null
  onChange: (newValue: string) => void
  mode: 'edit' | 'focus'
  readOnly?: boolean
  wordTarget?: number | null
}

export function ProseEditor({ value, onChange, mode, readOnly = false, wordTarget }: ProseEditorProps) {
  const detachTyping = useRef<(() => void) | null>(null)

  const editor = useEditor({
    extensions: proseExtensions as Parameters<typeof useEditor>[0]['extensions'],
    content: fromStorage(value),
    editable: !readOnly,
    // Tiptap v3 SSR safety — see SummaryEditor.tsx for rationale.
    immediatelyRender: false,
    editorProps: {
      attributes: { role: 'textbox', 'aria-multiline': 'true', 'aria-label': 'Prose' },
    },
    onUpdate: ({ editor: e }) => {
      onChange(toStorage(e))
    },
  })

  // Attach typing-state detector for cursor blink suppression (§5.5 / T-3.2)
  useEffect(() => {
    if (!editor) return
    detachTyping.current?.()
    detachTyping.current = attachTypingDetector(editor)
    return () => {
      detachTyping.current?.()
      detachTyping.current = null
    }
  }, [editor])

  // Sync external value changes without emitting update (prevents onChange loop)
  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    const current = toStorage(editor)
    if (current !== value) {
      editor.commands.setContent(fromStorage(value), { emitUpdate: false })
    }
  }, [value]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!editor) return
    editor.setEditable(!readOnly)
  }, [readOnly, editor])

  const isFocus = mode === 'focus'

  return (
    <div
      data-editor="prose"
      data-mode={mode}
      style={{
        position: 'relative',
        width: '100%',
        maxWidth: isFocus ? 'var(--prose-max-width)' : '100%',
        margin: isFocus ? '0 auto' : undefined,
        paddingLeft: isFocus ? '48px' : undefined,
        paddingRight: isFocus ? '48px' : undefined,
        background: 'var(--color-bg-base)',
      }}
    >
      {/* No persistent toolbar — Inviolable #5 */}
      {editor && <SelectionTooltip editor={editor} />}
      <EditorContent editor={editor} />
      {editor && (
        <WordCount
          editor={editor}
          target={wordTarget ?? null}
        />
      )}
    </div>
  )
}
