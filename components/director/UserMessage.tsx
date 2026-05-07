// Spec: stelavox_component_specification_v2_7.md §7.3 (UserMessage)
//       stelavox_phase5b_build_checklist_v1_0.md §3.14 T-14.3

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

export function UserMessage({ content, createdAt }: UserMessageProps) {
  return (
    <div
      role="article"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-end',
        marginBottom: 16,
      }}
    >
      <div
        style={{
          maxWidth: '78%',
          background: 'var(--color-bg-selected)',
          borderRadius: '8px 8px 2px 8px',
          padding: '10px 14px',
          fontFamily: 'var(--font-inter), Inter, sans-serif',
          fontWeight: 400,
          fontSize: 12,
          lineHeight: 1.5,
          color: 'var(--color-text-primary)',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        {content}
      </div>
      <time
        dateTime={createdAt}
        style={{
          fontFamily: 'var(--font-inter), Inter, sans-serif',
          fontWeight: 300,
          fontSize: 10,
          color: 'var(--color-text-muted)',
          marginTop: 5,
        }}
      >
        {formatTime(createdAt)}
      </time>
    </div>
  )
}
