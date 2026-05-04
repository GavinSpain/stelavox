'use client'

// Spec: stelavox_component_specification_v2_1.md §5.6 (SelectionTooltip)
// Appears above non-empty text selection in ProseEditor ONLY.
// 🔒 No other buttons: no heading selector, no colour picker, no alignment.

import { useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'

interface SelectionTooltipProps {
  editor: Editor
}

export function SelectionTooltip({ editor }: SelectionTooltipProps) {
  const [visible, setVisible] = useState(false)
  const [pos, setPos] = useState({ top: 0, left: 0 })
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function update() {
      const { from, to, empty } = editor.state.selection
      if (empty || from === to) {
        setVisible(false)
        return
      }

      const view = editor.view
      const start = view.coordsAtPos(from)
      const end = view.coordsAtPos(to)
      const editorEl = view.dom.parentElement
      if (!editorEl) return

      const editorRect = editorEl.getBoundingClientRect()
      const midX = (start.left + end.left) / 2 - editorRect.left
      const topY = start.top - editorRect.top - 8  // 8px above selection

      setPos({ top: topY, left: midX })
      setVisible(true)
    }

    editor.on('selectionUpdate', update)
    editor.on('blur', () => setVisible(false))
    return () => {
      editor.off('selectionUpdate', update)
      editor.off('blur', () => setVisible(false))
    }
  }, [editor])

  function setLink() {
    const existing = editor.getAttributes('link').href as string | undefined
    const url = window.prompt('URL', existing ?? '')
    if (url === null) return
    if (url === '') {
      editor.chain().focus().unsetLink().run()
    } else {
      editor.chain().focus().setLink({ href: url }).run()
    }
  }

  if (!visible) return null

  const buttons = [
    { label: 'B', title: 'Bold (⌘B)',  ariaLabel: 'Bold',   action: () => editor.chain().focus().toggleBold().run(),   active: editor.isActive('bold'),   style: { fontWeight: 700 } },
    { label: 'I', title: 'Italic (⌘I)', ariaLabel: 'Italic', action: () => editor.chain().focus().toggleItalic().run(), active: editor.isActive('italic'), style: { fontStyle: 'italic' } },
    { label: '🔗', title: 'Link (⌘K)',  ariaLabel: 'Link',   action: setLink,                                            active: editor.isActive('link'),   style: {} },
  ]

  return (
    <div
      ref={ref}
      role="toolbar"
      aria-label="Text formatting"
      style={{
        position: 'absolute',
        top: pos.top,
        left: pos.left,
        transform: 'translate(-50%, -100%)',
        zIndex: 50,
        display: 'flex',
        alignItems: 'center',
        background: 'var(--color-bg-elevated)',
        border: '1px solid var(--color-border-default)',
        borderRadius: '5px',
        boxShadow: 'var(--shadow-md)',
        padding: '5px 2px',
        gap: '0',
        pointerEvents: 'auto',
      }}
    >
      {buttons.map((btn, i) => (
        <span key={btn.label} style={{ display: 'flex', alignItems: 'center' }}>
          {i > 0 && (
            <span style={{ width: '1px', height: '14px', background: 'var(--color-border-subtle)', margin: '0 2px' }} />
          )}
          <button
            type="button"
            title={btn.title}
            aria-label={btn.ariaLabel}
            onMouseDown={(e) => { e.preventDefault(); btn.action() }}
            style={{
              padding: '2px 6px',
              background: btn.active ? 'var(--color-bg-hover)' : 'transparent',
              border: 'none',
              borderRadius: '3px',
              fontSize: '12px',
              fontFamily: 'var(--font-inter), Inter, sans-serif',
              fontWeight: 500,
              color: btn.active ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
              cursor: 'pointer',
              ...btn.style,
            }}
          >
            {btn.label}
          </button>
        </span>
      ))}
    </div>
  )
}
