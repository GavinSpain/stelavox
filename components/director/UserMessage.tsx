// Spec: stelavox_component_specification_v2_7.md §7.3 (UserMessage)
//       stelavox_phase5b_build_checklist_v1_0.md §3.14 T-14.3
//
// Phase 8.01 wireframe-alignment round 3 — UserMessage restyled to
// match wireframe `05_director_mode_v1_iter1.html` .msg-user pattern:
//
//   USER · 11:42 AM              ← metadata strip (.msg-meta)
//   ┌──────────────────────────┐
//   │ Expand @[Act 1] into     │ ← message body (.msg-user-body)
//   │ chapters and scenes.     │   on --color-bg-surface with border.
//   └──────────────────────────┘
//
// Left-aligned (the previous right-aligned chat-bubble pattern is
// replaced — the wireframe treats Director and user as peers in the
// thread, not as a chat). Mentions like `@act1ch1sc1bt2` render as
// verdigris-tinted monospace chips inline.
//
// Inviolable #2: mention chips use --color-accent-hover under brand-mark
// family precedent — the chip is a positional pointer at a specific
// catalogued node, same Catalog-category semantic as use #11.

interface UserMessageProps {
  content: string
  createdAt: string
}

function formatTime(iso: string) {
  try {
    const d = new Date(iso)
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
}

/** Split a message body into plain segments + `@...` mention tokens.
 *  Exported for unit tests. A mention is any `@` followed by letters
 *  and digits (the wireframe spec includes the positional-path syntax
 *  `@act1ch1sc1bt2`). Punctuation terminates the token. */
export function tokenizeWithMentions(
  text: string,
): Array<{ kind: 'text'; value: string } | { kind: 'mention'; value: string }> {
  const out: Array<{ kind: 'text'; value: string } | { kind: 'mention'; value: string }> = []
  const re = /@[A-Za-z0-9]+/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push({ kind: 'text', value: text.slice(last, m.index) })
    out.push({ kind: 'mention', value: m[0] })
    last = m.index + m[0].length
  }
  if (last < text.length) out.push({ kind: 'text', value: text.slice(last) })
  return out
}

function MentionChip({ value }: { value: string }) {
  return (
    <span
      data-testid="user-message-mention"
      style={{
        fontFamily: 'ui-monospace, "JetBrains Mono", SFMono-Regular, Menlo, monospace',
        fontSize: 12.5,
        fontWeight: 500,
        color: 'var(--color-accent-hover)',
        background: 'color-mix(in srgb, var(--color-accent) 18%, transparent)',
        padding: '0 5px',
        border: '1px solid color-mix(in srgb, var(--color-accent-hover) 35%, transparent)',
        borderRadius: 3,
        margin: '0 1px',
      }}
    >
      {value}
    </span>
  )
}

export function UserMessage({ content, createdAt }: UserMessageProps) {
  const segments = tokenizeWithMentions(content)
  return (
    <div
      role="article"
      data-testid="user-message"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        maxWidth: '90%',
        marginBottom: 16,
      }}
    >
      {/* Metadata strip — 9.5px / 600 / 0.32em uppercase */}
      <div
        data-testid="user-message-meta"
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 8,
          marginBottom: 6,
        }}
      >
        <span
          style={{
            fontFamily: 'var(--font-inter), Inter, sans-serif',
            fontWeight: 600,
            fontSize: 9.5,
            letterSpacing: '0.32em',
            textTransform: 'uppercase',
            color: 'var(--color-text-secondary)',
          }}
        >
          User
        </span>
        <time
          dateTime={createdAt}
          style={{
            fontFamily: 'var(--font-inter), Inter, sans-serif',
            fontWeight: 300,
            fontSize: 10,
            letterSpacing: '0.04em',
            color: 'var(--color-text-muted)',
          }}
        >
          {formatTime(createdAt)}
        </time>
      </div>
      {/* Body box — Inter, --color-bg-surface, --color-border-default. */}
      <div
        data-testid="user-message-body"
        style={{
          background: 'var(--color-bg-surface)',
          border: '1px solid var(--color-border-default)',
          borderRadius: 6,
          padding: '11px 14px',
          fontFamily: 'var(--font-inter), Inter, sans-serif',
          fontWeight: 400,
          fontSize: 14,
          lineHeight: 1.55,
          color: 'var(--color-text-primary)',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        {segments.map((seg, i) =>
          seg.kind === 'mention' ? <MentionChip key={i} value={seg.value} /> : (
            <span key={i}>{seg.value}</span>
          ),
        )}
      </div>
    </div>
  )
}
