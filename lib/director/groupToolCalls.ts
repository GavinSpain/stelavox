// Phase 8.01.C T-3 — tool-call grouping for the DirectorPanel conversation
// surface (Component Spec v2.21 §18.5).
//
// Algorithm: walk the tool_calls list. When ≥3 consecutive entries are
// read-tools, replace them with a single grouped chip. Otherwise render
// individual chips.
//
// The READ_TOOLS set lists Director V1 read-only tools per Director
// Architecture v2.6 §4. Manually mirrored from lib/director/tools/read.ts
// exports — the schema isn't easily importable here but the set is stable
// across V1 (changes land in Phase 14 / V2 alongside layer_stack work).

export const READ_TOOLS: ReadonlySet<string> = new Set([
  // Director tool registry V1.x read tools.
  'get_node',
  'get_subtree_content',
  'find_node_by_name',
  'get_nodes_by_layer',
  'get_project_profile',
  'get_brief_state',
  'get_scheduler_state',
  'get_conversation_history', // deprecated V2 §17.1 but still in V1.x
])

// Phase 8.01.C T-3.2 — grouping threshold per Component Spec §18.5
// ("optional grouping for ≥3 consecutive read-tools").
export const GROUP_THRESHOLD = 3

export interface ToolCallEntry {
  name: string
  arguments: Record<string, unknown>
}

export type ToolCallChip =
  | { kind: 'single'; call: ToolCallEntry }
  | { kind: 'group'; calls: ToolCallEntry[] }

/**
 * Walk the tool_calls list and emit chips. Read-tool runs of
 * GROUP_THRESHOLD or more are coalesced into a 'group' chip; everything
 * else falls through as 'single' chips. Output preserves the original
 * order of the calls.
 */
export function groupToolCalls(calls: ToolCallEntry[]): ToolCallChip[] {
  const out: ToolCallChip[] = []
  let i = 0
  while (i < calls.length) {
    if (READ_TOOLS.has(calls[i].name)) {
      // Greedy scan forward for consecutive reads.
      let j = i + 1
      while (j < calls.length && READ_TOOLS.has(calls[j].name)) j += 1
      const runLength = j - i
      if (runLength >= GROUP_THRESHOLD) {
        out.push({ kind: 'group', calls: calls.slice(i, j) })
      } else {
        for (let k = i; k < j; k++) out.push({ kind: 'single', call: calls[k] })
      }
      i = j
    } else {
      out.push({ kind: 'single', call: calls[i] })
      i += 1
    }
  }
  return out
}

/**
 * Compact summary used in the group chip label. Counts distinct node_id
 * (or fallback parent_id) targets across the grouped run; if they all
 * point at the same node, the label leans that way.
 */
export function summarizeGroup(calls: ToolCallEntry[]): string {
  const targetIds = new Set<string>()
  for (const c of calls) {
    const arg = (c.arguments as Record<string, unknown> | undefined) ?? {}
    const id = (arg.node_id ?? arg.parent_id) as string | undefined
    if (typeof id === 'string' && id.length > 0) targetIds.add(id)
  }
  if (targetIds.size === 1) {
    return `Looked at this node ${calls.length} ways`
  }
  if (targetIds.size > 1) {
    return `Looked at ${targetIds.size} nodes`
  }
  return `Read ${calls.length} items`
}

/**
 * Per-chip arg summary: truncates UUIDs to last 4 hex digits and quotes
 * strings. Returns "name(arg-summary)" or "name()" when arguments empty.
 */
export function summarizeCall(call: ToolCallEntry): string {
  const args = call.arguments ?? {}
  const entries = Object.entries(args)
  if (entries.length === 0) return `${call.name}()`
  // For brevity at the chip level, summarise the first 1-2 arguments.
  const parts: string[] = []
  for (let k = 0; k < Math.min(2, entries.length); k++) {
    const [key, val] = entries[k]
    parts.push(`${key}: ${formatArgValue(val)}`)
  }
  if (entries.length > 2) parts.push(`+${entries.length - 2} more`)
  return `${call.name}(${parts.join(', ')})`
}

function formatArgValue(v: unknown): string {
  if (v === null || v === undefined) return 'null'
  if (typeof v === 'string') {
    // UUID heuristic: 32+ hex chars with optional dashes → take last 4 hex.
    const compact = v.replace(/-/g, '')
    if (/^[0-9a-f]{32,}$/i.test(compact)) {
      return `…${compact.slice(-4)}`
    }
    if (v.length > 30) return `"${v.slice(0, 27)}…"`
    return `"${v}"`
  }
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (Array.isArray(v)) return `[${v.length} items]`
  if (typeof v === 'object') return '{…}'
  return String(v)
}
