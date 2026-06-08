'use client'

// Phase 8.5b B.5 — Topic subscriber hook for the multiplexed user
// channel.
//
// Replaces the per-component `supabase.channel(...).on(...).subscribe()`
// pattern with a thin subscriber-registration through the demuxer. The
// channel itself lives at the app shell (UserRealtimeChannel); this
// hook just registers + unregisters interest in a topic.
//
// Refs: docs/stelavox_document_load_architecture_v1_0.md §5.2 §5.3
//       lib/realtime/demuxer.ts (the subscribe() it delegates to)
//
// Usage:
//   useRealtimeTopic('nodes', (payload) => { ... })
//   useRealtimeTopic('briefs', (payload) => { ... },
//     (row) => row.document_id === documentId)
//
// The hook stashes the callback in a ref so consumers don't have to
// memoise it; each render uses the latest closure. Cleanup runs on
// unmount.

import { useEffect, useRef } from 'react'

import {
  subscribe,
  type RealtimeTopicListener,
  type RealtimeTopicPayload,
  type RealtimeTopic,
} from './demuxer'

export function useRealtimeTopic<Row = Record<string, unknown>>(
  topic: RealtimeTopic,
  cb: RealtimeTopicListener<Row>,
  filter?: (payload: RealtimeTopicPayload<Row>) => boolean,
): void {
  const cbRef = useRef(cb)
  const filterRef = useRef(filter)
  useEffect(() => {
    cbRef.current = cb
  }, [cb])
  useEffect(() => {
    filterRef.current = filter
  }, [filter])

  useEffect(() => {
    const unsub = subscribe<Row>(
      topic,
      (payload) => cbRef.current(payload),
      filterRef.current ? (payload) => filterRef.current!(payload) : undefined,
    )
    return unsub
  }, [topic])
}
