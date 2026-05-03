'use client'

// Spec: stelavox_component_specification_v2_1.md §5.3 (SummaryEditor)
// 🔒 Inviolable #4: Inter ONLY — never Lora. Enforced via data-editor="summary"
//    CSS selector in globals.css which scopes all .tiptap font rules.

import { useEditor, EditorContent } from '@tiptap/react'
import { useEffect, useState } from 'react'
import { summaryExtensions } from '@/lib/editor/extensions'
import { fromStorage, toStorage } from '@/lib/editor/serialise'

interface SummaryEditorProps {
  value: string | null
  onChange: (newValue: string) => void
  readOnly?: boolean
}

function SummaryToolbar({ editor }: { editor: ReturnType<typeof useEditor> }) {
  if (!editor) return null
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '2px',
        height: '32px',
        padding: '0 4px',
        borderBottom: '1px solid var(--color-border-subtle)',
        background: 'var(--color-bg-base)',
      }}
    >
      {[
        { label: 'B', title: 'Bold (⌘B)', action: () => editor.chain().focus().toggleBold().run(), active: editor.isActive('bold'), style: { fontWeight: 700 } },
        { label: 'I', title: 'Italic (⌘I)', action: () => editor.chain().focus().toggleItalic().run(), active: editor.isActive('italic'), style: { fontStyle: 'italic' } },
        { label: '• Bullet', title: 'Bullet list', action: () => editor.chain().focus().toggleBulletList().run(), active: editor.isActive('bulletList'), style: {} },
        { label: '1. Number', title: 'Numbered list', action: () => editor.chain().focus().toggleOrderedList().run(), active: editor.isActive('orderedList'), style: {} },
      ].map(btn => (
        <button
          key={btn.label}
          type="button"
          title={btn.title}
          onMouseDown={(e) => { e.preventDefault(); btn.action() }}
          style={{
            height: '24px',
            padding: '0 6px',
            background: btn.active ? 'var(--color-bg-hover)' : 'transparent',
            border: 'none',
            borderRadius: '3px',
            fontSize: '11px',
            fontFamily: 'var(--font-inter), Inter, sans-serif',
            color: btn.active ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
            cursor: 'pointer',
            ...btn.style,
          }}
        >
          {btn.label}
        </button>
      ))}
    </div>
  )
}

export function SummaryEditor({ value, onChange, readOnly = false }: SummaryEditorProps) {
  const [isFocused, setIsFocused] = useState(false)

  const editor = useEditor({
    extensions: summaryExtensions as Parameters<typeof useEditor>[0]['extensions'],
    content: fromStorage(value),
    editable: !readOnly,
    onUpdate: ({ editor: e }) => {
      onChange(toStorage(e))
    },
    onFocus: () => setIsFocused(true),
    onBlur: () => setIsFocused(false),
  })

  // Sync external value changes (e.g. node switch via key prop on parent)
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

  return (
    <div
      data-editor="summary"
      style={{
        border: `1px solid ${isFocused ? 'var(--color-border-default)' : 'var(--color-border-subtle)'}`,
        borderRadius: '4px',
        background: 'var(--color-bg-base)',
        minHeight: '80px',
        display: 'flex',
        flexDirection: 'column',
        transition: 'border-color var(--duration-fast)',
      }}
    >
      {isFocused && <SummaryToolbar editor={editor} />}
      <div style={{ padding: '10px 12px', flex: 1 }}>
        <EditorContent editor={editor} />
      </div>
    </div>
  )
}
