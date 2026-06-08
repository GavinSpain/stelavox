'use client'

// Phase 8.5b B.3 — TanStack Query provider for the (app) route group.
//
// Mounted in app/(app)/layout.tsx so every authenticated route shares
// one persistent QueryClient per browser tab. Defaults match Tier-A §3.2:
//
//   staleTime: 60_000        — 60 s; Realtime invalidates explicitly
//                              when it has a patch to apply, so we
//                              don't want React Query racing it on
//                              window focus or stale window.
//   gcTime: 5 * 60_000       — 5 min cache retention after unmount.
//   refetchOnWindowFocus: false  — Realtime keeps the cache fresh; we
//                                  don't want a focus-event refetch
//                                  to override an in-flight patch.
//   refetchOnReconnect: 'always'  — catch up after a network drop.
//   retry: 1                 — single retry on transient query errors
//                              before entering error state; consumer
//                              shows QueryErrorFallback.
//   mutation retry: 0        — mutations don't auto-retry; UI surfaces
//                              the error via FailureToast.
//
// The QueryClient is created inside a useState so React's StrictMode
// double-render doesn't construct two clients per mount. Per Tier-A
// §3.6.1, never use a module-level singleton on the server — every
// per-request QueryClient must be scoped to the request that created
// it. This is the *client* provider; the server-side prefetch path
// (B.4 / RSC seed) instantiates a fresh QueryClient inside each server
// component.
//
// Refs: docs/stelavox_document_load_architecture_v1_0.md §3.2 + §3.6.1
//       docs/stelavox_phase8_5b_build_checklist_v1_0.md §3 (B.3 work items)

import { useState, type ReactNode } from 'react'
import {
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query'

export function QueryProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60_000,
            gcTime: 5 * 60_000,
            refetchOnWindowFocus: false,
            refetchOnReconnect: 'always',
            retry: 1,
            retryDelay: (attempt: number) => Math.min(1000 * 2 ** attempt, 30_000),
          },
          mutations: {
            retry: 0,
          },
        },
      }),
  )

  return (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  )
}
