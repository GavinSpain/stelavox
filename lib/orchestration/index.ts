/**
 * lib/orchestration — Apollo-grade state-machine module for the brief
 * orchestration layer. One transition function per entity. The DB's
 * BEFORE UPDATE triggers enforce legality (M-192..M-197); this module
 * is the application-side interface.
 *
 * Usage:
 *   import { transitionAgentJob, markAgentJobFailed } from '@/lib/orchestration'
 *
 * Direct UPDATE of `state` / `status` / `queue_status` outside this
 * module is forbidden — enforced by tests/unit/orchestration-no-direct-state-writes.test.ts.
 *
 * See docs/stelavox_brief_orchestration_v1_0.md for the canonical
 * state diagrams and transition tables.
 */

export * from './states'
export * from './events'
export * from './agent-job-machine'
export * from './brief-machine'
export * from './brief-stage-machine'
export * from './workflow-machine'
export * from './director-turn-machine'
