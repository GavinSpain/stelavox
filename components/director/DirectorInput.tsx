'use client'

// Spec: stelavox_component_specification_v2_7.md §7.9 (DirectorInput)
//       stelavox_phase5b_build_checklist_v1_0.md §3.16 T-16.1, T-16.2
//
// Auto-expanding textarea (1–5 rows) with Enter-sends, Shift+Enter-
// newline, and a verdigris send button. `@` opens NodePicker; selecting
// a node inserts a pill into the running text and tracks the node ID
// in mentioned_node_ids. Disabled while the Director is streaming —
// placeholder swaps to "Director is working…" and pointer-events drop.

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react'
import { NodePicker, type NodePickerItem } from './NodePicker'
import { setMentionedNodeIds } from '@/lib/stores/mentioned-nodes'

interface DirectorInputProps {
  documentId: string
  isStreaming: boolean
  onSend: (content: string, mentionedNodeIds: string[]) => void
}

interface MentionToken {
  id: string
  name: string
  // Insert as a pill placeholder of the form `@[name]{id}`. The send
  // handler converts these to plain text + a parallel node-ID array.
}

const MAX_LENGTH = 10_000
const ROWS_MAX = 5

function pillToken(m: MentionToken): string {
  // Internal serialised form. Plain text rendered in the textarea so
  // the cursor can move through it without DOM trickery.
  return `@${m.name}`
}

export function DirectorInput({
  documentId,
  isStreaming,
  onSend,
}: DirectorInputProps) {
  const [value, setValue] = useState('')
  const [mentions, setMentions] = useState<MentionToken[]>([])
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerQuery, setPickerQuery] = useState('')
  const [pickerAnchor, setPickerAnchor] = useState<{ left: number; bottom: number } | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  // Track where the @ that opened the picker is, so we can replace
  // [@..query] in the textarea on selection.
  const atIndexRef = useRef<number>(-1)

  // Auto-resize the textarea to fit content (1..ROWS_MAX rows).
  useLayoutEffect(() => {
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = 'auto'
    const lineHeight = 18 // matches the 12px font * ~1.5
    const maxHeight = lineHeight * ROWS_MAX + 20
    ta.style.height = `${Math.min(ta.scrollHeight, maxHeight)}px`
    ta.style.overflowY = ta.scrollHeight > maxHeight ? 'auto' : 'hidden'
  }, [value])

  function updateAnchor() {
    const ta = textareaRef.current
    if (!ta) return
    const rect = ta.getBoundingClientRect()
    setPickerAnchor({
      left: rect.left + 8,
      bottom: window.innerHeight - rect.top + 4,
    })
  }

  function getQueryAfterAt(text: string, caret: number): { query: string; atIndex: number } | null {
    // Walk backwards from the caret looking for an @ that is at the
    // start of the text or preceded by whitespace. Stop at any
    // whitespace before that @.
    for (let i = caret - 1; i >= 0; i--) {
      const ch = text[i]
      if (ch === '@') {
        if (i === 0 || /\s/.test(text[i - 1] ?? '')) {
          return { query: text.slice(i + 1, caret), atIndex: i }
        }
        return null
      }
      if (/\s/.test(ch)) return null
    }
    return null
  }

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const next = e.target.value
      // Enforce hard cap at the API contract limit.
      if (next.length > MAX_LENGTH) {
        setValue(next.slice(0, MAX_LENGTH))
        return
      }
      setValue(next)

      const caret = e.target.selectionStart
      const found = getQueryAfterAt(next, caret)
      if (found) {
        atIndexRef.current = found.atIndex
        setPickerQuery(found.query)
        setPickerOpen(true)
        updateAnchor()
      } else {
        setPickerOpen(false)
        setPickerQuery('')
      }
    },
    [],
  )

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // Picker keyboard nav (↑/↓/Enter/Esc) is handled at window level
    // by NodePicker. We only need to suppress Enter here when picker
    // is open, so it doesn't double-fire (window listener intercepts
    // first via capture).
    if (pickerOpen && (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === 'Escape')) {
      // Picker handles via capture-phase listener; nothing to do.
      return
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void send()
    }
  }

  const handlePickerSelect = useCallback(
    (n: NodePickerItem) => {
      const ta = textareaRef.current
      if (!ta || atIndexRef.current < 0) {
        setPickerOpen(false)
        return
      }
      const before = value.slice(0, atIndexRef.current)
      const caret = ta.selectionStart
      const after = value.slice(caret)
      const insertion = pillToken({ id: n.id, name: n.name })
      const next = `${before}${insertion} ${after}`
      setValue(next)
      setMentions((prev) =>
        prev.some((m) => m.id === n.id) ? prev : [...prev, { id: n.id, name: n.name }],
      )
      setPickerOpen(false)
      atIndexRef.current = -1
      // Restore caret right after the inserted pill + space.
      requestAnimationFrame(() => {
        const pos = before.length + insertion.length + 1
        ta.focus()
        ta.setSelectionRange(pos, pos)
      })
    },
    [value],
  )

  const send = useCallback(async () => {
    if (isStreaming) return
    const trimmed = value.trim()
    if (!trimmed) return
    // Mentions filtered to those whose pillToken still appears in the
    // current text — the author may have backspaced over a pill.
    const stillReferenced = mentions.filter((m) => value.includes(pillToken(m)))
    onSend(trimmed, stillReferenced.map((m) => m.id))
    setValue('')
    setMentions([])
    setPickerOpen(false)
    // Phase 8.01.C T-8.3 — clear the mentioned-nodes store on send so the
    // tree highlight doesn't linger after the message goes out.
    setMentionedNodeIds([])
  }, [value, mentions, isStreaming, onSend])

  // Phase 8.01.C T-8.3 — push the active mention set into the shared
  // store so NodeTree rows can highlight themselves. Re-syncs whenever
  // mentions or value change (a user backspace over a pill drops the id
  // from `stillReferenced` and therefore from the store).
  useEffect(() => {
    const stillReferenced = mentions.filter((m) => value.includes(pillToken(m)))
    setMentionedNodeIds(stillReferenced.map((m) => m.id))
  }, [mentions, value])

  // Close the picker on outside-click.
  useEffect(() => {
    if (!pickerOpen) return
    function onDocMouseDown(e: MouseEvent) {
      const ta = textareaRef.current
      if (ta && ta.contains(e.target as Node)) return
      setPickerOpen(false)
    }
    document.addEventListener('mousedown', onDocMouseDown)
    return () => document.removeEventListener('mousedown', onDocMouseDown)
  }, [pickerOpen])

  return (
    <div
      style={{
        flexShrink: 0,
        padding: '12px 20px 16px',
        borderTop: '1px solid var(--color-border-subtle)',
        background: 'var(--color-bg-surface)',
        opacity: isStreaming ? 0.5 : 1,
        pointerEvents: isStreaming ? 'none' : 'auto',
      }}
    >
      <div
        style={{
          background: 'var(--color-bg-base)',
          border: '1px solid var(--color-border-subtle)',
          borderRadius: 5,
          padding: '8px 8px 8px 12px',
          display: 'flex',
          alignItems: 'flex-end',
          gap: 8,
        }}
      >
        <textarea
          ref={textareaRef}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          rows={1}
          placeholder={
            isStreaming
              ? 'Director is working…'
              : 'Message the Director… (@ to reference a node)'
          }
          aria-label="Message the Director"
          disabled={isStreaming}
          style={{
            flex: 1,
            minHeight: 18,
            border: 'none',
            outline: 'none',
            resize: 'none',
            background: 'transparent',
            color: 'var(--color-text-primary)',
            fontFamily: 'var(--font-inter), Inter, sans-serif',
            fontWeight: 300,
            fontSize: 12,
            lineHeight: 1.5,
          }}
        />
        <button
          type="button"
          aria-label="Send"
          onClick={() => void send()}
          disabled={isStreaming || value.trim().length === 0}
          style={{
            flexShrink: 0,
            width: 32,
            height: 32,
            background:
              value.trim().length > 0 && !isStreaming
                ? 'var(--color-accent)'
                : 'var(--color-border-subtle)',
            color: '#ffffff',
            border: 'none',
            borderRadius: 5,
            cursor:
              value.trim().length > 0 && !isStreaming ? 'pointer' : 'not-allowed',
            fontSize: 14,
            lineHeight: 1,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          ↑
        </button>
      </div>
      <NodePicker
        documentId={documentId}
        query={pickerQuery}
        open={pickerOpen}
        onSelect={handlePickerSelect}
        onClose={() => setPickerOpen(false)}
        anchor={pickerAnchor}
      />
    </div>
  )
}
