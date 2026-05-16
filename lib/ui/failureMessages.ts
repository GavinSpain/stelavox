import 'server-only'

/**
 * V1.x-F.2 — failure-class user message templates.
 *
 * Source: stelavox_v1x_f_build_checklist_v1_1.md §3 + M-147 +
 *         docs/wireframes/wireframe_failure_mode_ux_v1.html §02 + §03.
 *
 * Templates live in platform_config (M-147) so they can be tuned
 * without a redeploy. Interpolation supports a small fixed set of
 * `{name}` tokens via plain string replacement — no full templating
 * engine. Per-class token sets:
 *   - Class A: {attempt}, {max_attempts}
 *   - Class C: {pause_seconds}
 *   - Class D: {failure_class}, {node_name}, {reason}
 *   - Class E: {job_id}
 *
 * Server-only. The client gets pre-interpolated strings from a parent
 * server component or via an API route — never bypass platform_config
 * by hardcoding templates client-side (H-12).
 */

import { getConfigInt, getConfigString } from '@/lib/config/platform-config'

export type FailureClass = 'A' | 'B' | 'C' | 'D' | 'E'

export interface ClassAContext {
  attempt: number
  max_attempts: number
}

export interface ClassCContext {
  pause_seconds: number
}

export interface ClassDContext {
  failure_class: string
  node_name: string
  reason: string
}

export interface ClassEContext {
  job_id: string
}

/** Replace `{token}` occurrences with values from `vars`. */
function interpolate(template: string, vars: Record<string, string | number>): string {
  let out = template
  for (const [key, val] of Object.entries(vars)) {
    out = out.replaceAll(`{${key}}`, String(val))
  }
  return out
}

export async function getClassAMessage(ctx: ClassAContext): Promise<string> {
  const template = await getConfigString('failure.class_a_message')
  return interpolate(template, ctx as unknown as Record<string, string | number>)
}

export async function getClassCMessage(ctx: ClassCContext): Promise<string> {
  const template = await getConfigString('failure.class_c_message')
  return interpolate(template, ctx as unknown as Record<string, string | number>)
}

export async function getClassDMessage(ctx: ClassDContext): Promise<string> {
  const template = await getConfigString('failure.class_d_message_template')
  return interpolate(template, ctx as unknown as Record<string, string | number>)
}

export async function getClassEMessage(ctx: ClassEContext): Promise<string> {
  const template = await getConfigString('failure.class_e_message')
  return interpolate(template, ctx as unknown as Record<string, string | number>)
}

/**
 * Class C min-pause threshold — toasts below this stay silent
 * (decision D2 locked at wireframe kickoff; default 15 seconds).
 */
export async function getClassCMinPauseSeconds(): Promise<number> {
  return getConfigInt('failure.class_c_min_pause_seconds')
}

/**
 * Class E support contact — mailto: target. Configured via
 * platform_config so future operators can re-target without a redeploy.
 */
export async function getClassEAdminContact(): Promise<string> {
  return getConfigString('failure.class_e_admin_contact')
}

/**
 * Pre-bundle all message templates + thresholds for a parent server
 * component to pass to its client subtree as props. One Promise.all
 * round instead of N sequential reads on the platform_config cache.
 *
 * Templates remain un-interpolated — the client substitutes per-event
 * `{token}` values at render time via the exported `interpolate`-equivalent
 * helper in lib/ui/failureMessageTemplates.client.ts.
 */
export async function getFailureMessageBundle(): Promise<{
  class_a_template: string
  class_c_template: string
  class_c_min_pause_seconds: number
  class_d_template: string
  class_e_template: string
  class_e_admin_contact: string
}> {
  const [classA, classC, classCMin, classD, classE, classEContact] = await Promise.all([
    getConfigString('failure.class_a_message'),
    getConfigString('failure.class_c_message'),
    getConfigInt('failure.class_c_min_pause_seconds'),
    getConfigString('failure.class_d_message_template'),
    getConfigString('failure.class_e_message'),
    getConfigString('failure.class_e_admin_contact'),
  ])
  return {
    class_a_template: classA,
    class_c_template: classC,
    class_c_min_pause_seconds: classCMin,
    class_d_template: classD,
    class_e_template: classE,
    class_e_admin_contact: classEContact,
  }
}

// Exported for unit testing the interpolation invariant.
export const __testing = { interpolate }
