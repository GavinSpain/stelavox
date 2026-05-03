'use client'

// Spec: stelavox_component_specification_v2_1.md §5.7 (WordCount)
// 🔒 Inviolable #2: --color-accent at count when at/above target — verdigris use #6.
// Opacity state machine: 0 typing → 0 within 3s → 0.4 at rest → 0.9 hover.

import { useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'

interface WordCountProps {
  editor: Editor
  target: number | null
}

function countWords(text: string): number {
  const trimmed = text.trim()
  if (!trimmed) return 0
  return trimmed.split(/\s+/).length
}

export function WordCount({ editor, target }: WordCountProps) {
  const [words, setWords] = useState(0)
  const [isTyping, setIsTyping] = useState(false)
  const [recentlyTyped, setRecentlyTyped] = useState(false)
  const [hovered, setHovered] = useState(false)
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    function onUpdate() {
      setWords(countWords(editor.getText()))
    }
    editor.on('update', onUpdate)
    // Initial word count from the editor's current text — matches AppShell's
    // hydrate-from-external-source pattern.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setWords(countWords(editor.getText()))
    return () => { editor.off('update', onUpdate) }
  }, [editor])

  // Detect typing via keydown on ProseMirror DOM for opacity machine
  useEffect(() => {
    const el = editor.view.dom as HTMLElement

    function onKeydown() {
      setIsTyping(true)
      setRecentlyTyped(true)
      if (typingTimer.current) clearTimeout(typingTimer.current)
      if (idleTimer.current) clearTimeout(idleTimer.current)
      typingTimer.current = setTimeout(() => {
        setIsTyping(false)
        idleTimer.current = setTimeout(() => setRecentlyTyped(false), 3000)
      }, 300)
    }

    el.addEventListener('keydown', onKeydown)
    return () => {
      el.removeEventListener('keydown', onKeydown)
      if (typingTimer.current) clearTimeout(typingTimer.current)
      if (idleTimer.current) clearTimeout(idleTimer.current)
    }
  }, [editor])

  // Opacity state machine per §5.7
  let opacity = 0.4
  if (isTyping || recentlyTyped) opacity = 0
  if (hovered) opacity = 0.9

  const atOrAboveTarget = target !== null && words >= target
  const countColour = atOrAboveTarget
    ? 'var(--color-accent)'    // verdigris use #6 — at/above target
    : target !== null
      ? 'var(--color-text-secondary)'
      : 'var(--color-text-muted)'

  let display: React.ReactNode
  if (target === null) {
    display = <span style={{ color: 'var(--color-text-muted)' }}>{words} words</span>
  } else {
    display = (
      <>
        <span style={{ color: countColour }}>{words}</span>
        <span style={{ color: 'var(--color-text-muted)' }}> / {target}</span>
      </>
    )
  }

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        justifyContent: 'flex-end',
        paddingTop: '4px',
        opacity,
        transition: `opacity var(--duration-wordcount, 800ms) var(--easing-prose, ease-out)`,
        fontSize: 'var(--text-xs)',
        fontFamily: 'var(--font-inter), Inter, sans-serif',
        fontWeight: 300,
        color: 'var(--color-text-muted)',
        pointerEvents: 'auto',
        userSelect: 'none',
      }}
    >
      {display}
    </div>
  )
}
