'use client'

/**
 * CommentThread — list + create + resolve + delete comments for a node.
 *
 * Source: stelavox_component_specification_v2_6.md §5.10
 *         stelavox_phase5_api_contract_v1_0.md v1.2 §3.10–§3.14
 *         stelavox_phase5_test_plan_v1_0.md TC-U-19..TC-U-24
 * Build Checklist T-13.1, T-13.2, T-13.3.
 *
 * Depth-1 threading: top-level comments may have replies; replies cannot
 * have replies (G-5 enforcement at the API level; UI hides Reply button
 * on already-replied comments).
 */

import { useEffect, useState } from 'react'

interface Comment {
  id: string
  node_id: string
  parent_comment_id: string | null
  author_type: 'human' | 'agent'
  author_label: string
  agent_job_id: string | null
  comment_type: 'instruction' | 'question' | 'note' | 'critique' | 'approval'
  content: string
  resolved: boolean
  resolved_at: string | null
  resolved_by: string | null
  created_at: string
}

interface Props {
  nodeId: string
  currentUserId: string | null
}

const COMMENT_TYPES = ['instruction', 'question', 'note', 'critique', 'approval'] as const

const TYPE_COLOURS: Record<Comment['comment_type'], string> = {
  instruction: 'var(--color-info)',
  question: 'var(--color-text-muted)',
  note: 'var(--color-text-muted)',
  critique: 'var(--color-warning)',
  approval: 'var(--color-success)',
}

export function CommentThread({ nodeId, currentUserId }: Props) {
  const [comments, setComments] = useState<Comment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showResolved, setShowResolved] = useState(false)
  const [newType, setNewType] = useState<Comment['comment_type']>('instruction')
  const [newContent, setNewContent] = useState('')
  const [replyParentId, setReplyParentId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function refresh() {
    setLoading(true)
    try {
      const res = await fetch(`/api/nodes/${nodeId}/comments`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = (await res.json()) as { comments: Comment[] }
      setComments(json.comments)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId])

  async function postComment() {
    if (!newContent.trim()) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/nodes/${nodeId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          comment_type: newType,
          content: newContent.trim(),
          parent_comment_id: replyParentId,
        }),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        throw new Error(json.error ?? `HTTP ${res.status}`)
      }
      setNewContent('')
      setReplyParentId(null)
      void refresh()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function resolveComment(id: string) {
    setBusy(true)
    try {
      await fetch(`/api/comments/${id}/resolve`, { method: 'POST' })
      void refresh()
    } finally {
      setBusy(false)
    }
  }

  async function deleteComment(id: string) {
    if (!confirm('Delete this comment? Any replies will also be deleted.')) return
    setBusy(true)
    try {
      await fetch(`/api/comments/${id}`, { method: 'DELETE' })
      void refresh()
    } finally {
      setBusy(false)
    }
  }

  // Group: top-level + replies
  const topLevel = comments.filter((c) => !c.parent_comment_id)
  const repliesByParent = new Map<string, Comment[]>()
  comments.filter((c) => c.parent_comment_id).forEach((c) => {
    const arr = repliesByParent.get(c.parent_comment_id!) ?? []
    arr.push(c)
    repliesByParent.set(c.parent_comment_id!, arr)
  })

  const visibleTopLevel = showResolved ? topLevel : topLevel.filter((c) => !c.resolved)
  const hiddenResolvedCount = topLevel.filter((c) => c.resolved).length

  return (
    <div data-testid="comment-thread" style={{ padding: 'var(--space-5)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      {error && (
        <div style={{ padding: 'var(--space-2)', color: 'var(--color-error)', fontSize: '12px' }}>
          {error}
        </div>
      )}

      {loading && comments.length === 0 && (
        <div style={{ color: 'var(--color-text-muted)', fontSize: '12px' }}>Loading…</div>
      )}

      {visibleTopLevel.length === 0 && !loading && (
        <div style={{ color: 'var(--color-text-muted)', fontSize: '12px' }}>
          No {showResolved ? '' : 'unresolved '}comments yet.
        </div>
      )}

      {visibleTopLevel.map((c) => {
        const replies = repliesByParent.get(c.id) ?? []
        return (
          <CommentCard
            key={c.id}
            comment={c}
            replies={replies}
            currentUserId={currentUserId}
            onReply={() => setReplyParentId(c.id)}
            onResolve={() => resolveComment(c.id)}
            onDelete={() => deleteComment(c.id)}
            onDeleteReply={(replyId) => deleteComment(replyId)}
            isReplying={replyParentId === c.id}
          />
        )
      })}

      {hiddenResolvedCount > 0 && !showResolved && (
        <button
          onClick={() => setShowResolved(true)}
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--color-text-muted)',
            fontSize: '11px',
            cursor: 'pointer',
            alignSelf: 'flex-start',
            padding: 'var(--space-1) 0',
          }}
        >
          Show {hiddenResolvedCount} resolved
        </button>
      )}

      {/* New comment / reply form */}
      <div
        style={{
          marginTop: 'var(--space-3)',
          padding: 'var(--space-3)',
          background: 'var(--color-bg-base)',
          border: '1px solid var(--color-border-subtle)',
          borderRadius: '4px',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-2)',
        }}
      >
        {replyParentId && (
          <div style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>
            Replying to comment.{' '}
            <button
              onClick={() => setReplyParentId(null)}
              style={{ background: 'transparent', border: 'none', color: 'var(--color-error)', cursor: 'pointer', fontSize: '11px' }}
            >
              cancel
            </button>
          </div>
        )}
        <select
          aria-label="Comment type"
          value={newType}
          onChange={(e) => setNewType(e.target.value as Comment['comment_type'])}
          disabled={busy}
          style={{
            fontFamily: 'var(--font-inter), Inter, sans-serif',
            fontSize: '11px',
            padding: '4px 6px',
            background: 'var(--color-bg-base)',
            color: 'var(--color-text-primary)',
            border: '1px solid var(--color-border-subtle)',
            borderRadius: '4px',
            alignSelf: 'flex-start',
          }}
        >
          {COMMENT_TYPES.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <textarea
          value={newContent}
          onChange={(e) => setNewContent(e.target.value)}
          placeholder="Add a comment…"
          rows={2}
          disabled={busy}
          style={{
            fontFamily: 'var(--font-inter), Inter, sans-serif',
            fontWeight: 300,
            fontSize: '12px',
            padding: '6px 8px',
            background: 'var(--color-bg-base)',
            color: 'var(--color-text-primary)',
            border: '1px solid var(--color-border-subtle)',
            borderRadius: '4px',
            resize: 'vertical',
          }}
        />
        <button
          onClick={postComment}
          disabled={busy || !newContent.trim()}
          style={{
            alignSelf: 'flex-end',
            background: 'var(--color-bg-elevated)',
            color: 'var(--color-text-primary)',
            border: '1px solid var(--color-border-subtle)',
            borderRadius: '4px',
            padding: '4px 12px',
            fontFamily: 'var(--font-inter), Inter, sans-serif',
            fontSize: '11px',
            cursor: (busy || !newContent.trim()) ? 'not-allowed' : 'pointer',
            opacity: (busy || !newContent.trim()) ? 0.4 : 1,
          }}
        >
          Add
        </button>
      </div>
    </div>
  )
}

function CommentCard({
  comment,
  replies,
  currentUserId,
  onReply,
  onResolve,
  onDelete,
  onDeleteReply,
}: {
  comment: Comment
  replies: Comment[]
  currentUserId: string | null
  onReply: () => void
  onResolve: () => void
  onDelete: () => void
  onDeleteReply: (id: string) => void
  isReplying: boolean
}) {
  const isAuthor = currentUserId !== null && comment.author_label === currentUserId
  return (
    <div
      style={{
        padding: '10px 12px',
        background: 'var(--color-bg-base)',
        border: '1px solid var(--color-border-subtle)',
        borderRadius: '4px',
        opacity: comment.resolved ? 0.5 : 1,
      }}
    >
      <CommentBody comment={comment} isAuthor={isAuthor} onDelete={onDelete} />
      <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
        <button onClick={onReply} disabled={comment.resolved} style={metaButtonStyle}>Reply</button>
        {!comment.resolved && (
          <button onClick={onResolve} style={metaButtonStyle}>Resolve</button>
        )}
        {comment.resolved && comment.resolved_at && (
          <span style={{ fontSize: '10px', color: 'var(--color-text-muted)' }}>
            Resolved {new Date(comment.resolved_at).toLocaleString()}
          </span>
        )}
      </div>

      {replies.map((r) => (
        <div
          key={r.id}
          style={{
            marginTop: 'var(--space-2)',
            marginLeft: 'var(--space-4)',
            padding: '8px 10px',
            background: 'var(--color-bg-base)',
            borderLeft: '2px solid var(--color-border-subtle)',
          }}
        >
          <CommentBody
            comment={r}
            isAuthor={currentUserId !== null && r.author_label === currentUserId}
            onDelete={() => onDeleteReply(r.id)}
          />
          {/* No Reply button — depth-1 enforcement */}
        </div>
      ))}
    </div>
  )
}

function CommentBody({
  comment,
  isAuthor,
  onDelete,
}: {
  comment: Comment
  isAuthor: boolean
  onDelete: () => void
}) {
  return (
    <>
      <div
        style={{
          fontFamily: 'var(--font-inter), Inter, sans-serif',
          fontSize: '9px',
          fontWeight: 500,
          letterSpacing: '0.2em',
          textTransform: 'uppercase',
          color: TYPE_COLOURS[comment.comment_type],
          marginBottom: 'var(--space-1)',
        }}
      >
        {comment.author_type === 'agent' ? '◆ ' : ''}
        {comment.comment_type}
      </div>
      <div
        style={{
          fontFamily: 'var(--font-inter), Inter, sans-serif',
          fontSize: '12px',
          fontWeight: 400,
          lineHeight: 1.55,
          color: 'var(--color-text-secondary)',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        {comment.content}
      </div>
      <div
        style={{
          marginTop: 'var(--space-1)',
          fontFamily: 'var(--font-inter), Inter, sans-serif',
          fontSize: '10px',
          fontWeight: 300,
          color: 'var(--color-text-muted)',
          display: 'flex',
          justifyContent: 'space-between',
        }}
      >
        <span>
          {new Date(comment.created_at).toLocaleString()}
        </span>
        {isAuthor && (
          <button onClick={onDelete} style={metaButtonStyle}>Delete</button>
        )}
      </div>
    </>
  )
}

const metaButtonStyle: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: 'var(--color-text-muted)',
  fontFamily: 'var(--font-inter), Inter, sans-serif',
  fontSize: '10px',
  padding: 0,
  cursor: 'pointer',
}
