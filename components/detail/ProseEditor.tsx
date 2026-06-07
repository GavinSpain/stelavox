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
import {
  sentenceFocusPlugin,
  sentenceFocusPluginKey,
} from '@/lib/editor/sentence-focus-plugin'
import { useProseSettings } from '@/lib/hooks/useProseSettings'
import { SentenceFocus } from '@/components/focus/SentenceFocus'
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
  // Phase 8.9 — read Sentence Focus from the shared prose-settings
  // hook. ProseEditor owns the plugin lifecycle (Q1 of the wireframe
  // open questions); the toggle is the same shared boolean as the
  // ProseSettingsMenu writes.
  const { sentenceFocus } = useProseSettings()

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

  // Phase 8.9 — register / unregister the Sentence Focus plugin as the
  // toggle flips. The plugin's PluginKey lets us look it up to remove
  // cleanly. `editor.registerPlugin()` is a Tiptap convenience over
  // ProseMirror's `state.reconfigure({ plugins: [...] })`.
  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    if (sentenceFocus) {
      editor.registerPlugin(sentenceFocusPlugin())
      return () => {
        if (editor.isDestroyed) return
        editor.unregisterPlugin(sentenceFocusPluginKey)
      }
    }
    return undefined
  }, [editor, sentenceFocus])

  const isFocus = mode === 'focus'

  return (
    <div
      data-editor="prose"
      data-mode={mode}
      // Phase 8.9 — `data-sentence-focus` is the ancestor selector the
      // SentenceFocus CSS rules key off (see components/focus/SentenceFocus.tsx).
      // Present whenever the toggle is on, in either mode; the plugin
      // wraps each sentence in [data-sentence] inside this container.
      data-sentence-focus={sentenceFocus ? '' : undefined}
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
      {/* Phase 8.9 — SentenceFocus installs the global CSS + selection
          handler. The plugin (registered above) does the per-paragraph
          span wrapping; this component owns the styling side. */}
      <SentenceFocus enabled={sentenceFocus} />
    </div>
  )
}
