// Phase 8.5b B.5 — Realtime event demultiplexer.
//
// A single Realtime channel per browser tab carries events for many
// table-scoped topics. The demuxer is the client-side event-bus that
// routes incoming postgres_changes payloads to the subscribers
// registered for each topic.
//
// Refs: docs/stelavox_document_load_architecture_v1_0.md §5.2 + §5.3
//       lib/realtime/useUserChannel.ts (channel mount)
//       lib/realtime/useRealtimeTopic.ts (subscriber hook)
//
// Topics are strings — currently the table names from the user
// channel's postgres_changes filters ('nodes', 'agent_jobs', 'briefs',
// 'brief_stages', 'conversation_messages', 'director_turns',
// 'export_jobs', 'project_profiles', 'profile_amendments'). The
// demuxer is opaque to topic semantics — it just routes by string.
//
// The demuxer is a module-level singleton: the channel is per-tab,
// the channel mounts once at the app shell, every component subscribes
// through this single bus.

// We use a structural shape for the payload rather than the Supabase
// generic type because that generic constrains its type parameter to
// `{ [key: string]: any }` and threading our generic through it
// produces unsoundness errors. The runtime shape is identical.
export interface RealtimeTopicPayload<Row = Record<string, unknown>> {
  eventType: 'INSERT' | 'UPDATE' | 'DELETE'
  new: Row | Record<string, never>
  old: Row | Record<string, never>
  schema: string
  table: string
  commit_timestamp?: string
  errors?: string[]
}

/** Subscriber callback. Optional filter narrows the events that fire. */
export type RealtimeTopicListener<Row = Record<string, unknown>> = (
  payload: RealtimeTopicPayload<Row>,
) => void

interface InternalSubscriber {
  topic: string
  cb: RealtimeTopicListener<never>
  filter?: (payload: RealtimeTopicPayload<never>) => boolean
}

const subscribers: Set<InternalSubscriber> = new Set()

/**
 * Register a topic listener. Returns an unsubscribe function — call it
 * (or rely on the useRealtimeTopic hook's cleanup) to detach.
 *
 * The optional `filter` callback returns true if the event should
 * reach the listener; false to skip. Useful for per-id scoping
 * ("only events for this documentId").
 */
export function subscribe<Row = Record<string, unknown>>(
  topic: string,
  cb: RealtimeTopicListener<Row>,
  filter?: (payload: RealtimeTopicPayload<Row>) => boolean,
): () => void {
  const sub: InternalSubscriber = {
    topic,
    cb: cb as RealtimeTopicListener<never>,
    filter: filter as ((payload: RealtimeTopicPayload<never>) => boolean) | undefined,
  }
  subscribers.add(sub)
  return () => {
    subscribers.delete(sub)
  }
}

/**
 * Dispatch a payload to all subscribers of the given topic. The user
 * channel's per-event handlers (set up in useUserChannel) call this.
 *
 * Errors thrown by individual subscribers are caught and logged so
 * one bad listener doesn't break the rest of the routing.
 */
export function dispatch<Row = Record<string, unknown>>(
  topic: string,
  payload: RealtimeTopicPayload<Row>,
): void {
  for (const sub of subscribers) {
    if (sub.topic !== topic) continue
    try {
      // The internal store erases `Row` to `never` — cast both ways
      // to bridge. Runtime shape matches; the variance error is a
      // pure type-system artefact.
      const erased = payload as unknown as RealtimeTopicPayload<never>
      if (sub.filter && !sub.filter(erased)) continue
      sub.cb(erased)
    } catch (err) {
      // One bad listener should not break the bus.
      console.error(`[realtime-demuxer] listener for "${topic}" threw:`, err)
    }
  }
}

/** Test-only — reset the bus. Production code does not call this. */
export function __resetDemuxerForTest(): void {
  subscribers.clear()
}

/** Test-only — count current subscribers for a topic. */
export function __subscriberCountForTest(topic?: string): number {
  if (!topic) return subscribers.size
  let n = 0
  for (const sub of subscribers) if (sub.topic === topic) n++
  return n
}

/**
 * The list of topics the user channel subscribes to. Single source of
 * truth — useUserChannel iterates this to build its .on() chain;
 * useRealtimeTopic accepts only these strings as topic names (type-
 * checked via the union type below).
 *
 * Soft cap raised to 12 per Tier-A §5.3 changelog entry of 2026-06-08.
 * Rationale: workflows + workflow_steps are core Director functionality
 * (useDirectorConversation needs both — the workflow INSERT on user
 * Approve fires no agent_jobs event yet, so it can't be inferred from
 * any other topic). The marginal server cost of two more `.on()`
 * handlers on a per-tab channel is negligible compared with the saving
 * of one fewer standalone channel. Further additions still require a
 * spec changelog entry.
 */
export const REALTIME_TOPICS = [
  'nodes',
  'agent_jobs',
  'briefs',
  'brief_stages',
  'conversation_messages',
  'director_turns',
  'export_jobs',
  'project_profiles',
  'profile_amendments',
  // Phase 8.5b B.5b — `organisations` added for CostMeterFull which
  // refreshes when org.tokens_used / cost_credits change. The org row
  // updates are driven by the accumulate_cost_credits_into_org trigger
  // on agent_jobs writes; we subscribe to organisations directly
  // because that's the table the relevant fields live on.
  'organisations',
  // Phase 8.5b B.5c — `workflows` + `workflow_steps` added so
  // useDirectorConversation runs off the user channel rather than its
  // own pair of channels. See Tier-A §5.3 changelog 2026-06-08 for the
  // cap-raise rationale.
  'workflows',
  'workflow_steps',
] as const

export type RealtimeTopic = (typeof REALTIME_TOPICS)[number]
