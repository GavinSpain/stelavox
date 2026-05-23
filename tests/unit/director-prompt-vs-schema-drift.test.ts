/**
 * 2026-05-22 — Director system-prompt vs Zod-schema drift guard.
 *
 * The Director's system_prompt teaches the model what tool inputs are
 * valid. If the prompt documents a parameter the Zod schema doesn't
 * accept, the model dutifully sends it, gets rejected, retries — at
 * best wasting iterations and surfacing "I made an error" narration
 * in the user's conversation; at worst silently failing the entire
 * tool call.
 *
 * Five drifts of this family surfaced over a week of testing
 * (V1.x-B.3 amendment surface: 4 of them) and one again on
 * 2026-05-22 (expand step's `instruction` parameter — fixed in M-186 /
 * v1.25). This test prevents a sixth.
 *
 * Approach: read the production director_config's system_prompt,
 * parse the "## Step shapes" section, extract each op-type's
 * documented parameter keys, and assert each key is actually accepted
 * by the corresponding Zod schema. Same in reverse: every required
 * key in the schema must be documented in the prompt.
 *
 * Skipped without SUPABASE_SERVICE_ROLE_KEY.
 */

import { describe, expect, it, beforeAll } from 'vitest'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54331'
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const hasServiceKey = SERVICE_KEY !== ''
const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

/**
 * Parse the "- `<op>` → `parameters: { ... }`" lines out of the
 * Step shapes section. Returns a map of op_type → list of documented
 * parameter keys (only the parameters block; descriptions stripped).
 */
function parseDocumentedParams(prompt: string): Map<string, string[]> {
  const out = new Map<string, string[]>()
  // Match either single-line ({...}) or accept multi-line spans.
  const re = /- `([a-z_]+)` → `parameters: \{([^}]*)\}`/g
  let m: RegExpExecArray | null
  while ((m = re.exec(prompt)) !== null) {
    const opType = m[1]
    const paramsBody = m[2]
    // Extract quoted keys: "key": "..." or "key":
    const keyRe = /"([a-z_]+)"\s*:/g
    const keys: string[] = []
    let km: RegExpExecArray | null
    while ((km = keyRe.exec(paramsBody)) !== null) {
      keys.push(km[1])
    }
    out.set(opType, keys)
  }
  return out
}

// The actual Zod parameter schemas live in lib/brief/proposalBuilder.ts
// (the propose_brief path the Director uses) as private consts.
// Rather than export them — these schemas are intentionally internal —
// we hardcode the SAME shape here and trust the round-trip test on
// the proposalBuilder side to flag any drift between the two copies.
// If you add a new param to a ParamsSchema there, update this list.
const SCHEMA_ACCEPTED_KEYS: Record<string, { required: string[]; optional: string[] }> = {
  expand: { required: [], optional: ['child_count_target'] },
  synthesise: { required: [], optional: [] },
  refine: { required: ['target_field', 'instruction'], optional: [] },
  generate_context: { required: ['context_type'], optional: ['seed_content'] },
  comment: { required: ['comment_type', 'content'], optional: [] },
  node_reorder: { required: ['new_order'], optional: ['parent_id'] },
  node_rename: { required: ['new_name'], optional: [] },
}

describe.skipIf(!hasServiceKey)(
  'Director prompt-vs-schema drift guard (2026-05-22)',
  () => {
    let productionPrompt: string
    let productionVersion: string
    beforeAll(async () => {
      const { data } = await svc
        .from('director_configs')
        .select('version_number, system_prompt')
        .eq('status', 'production')
        .single()
      productionVersion = data!.version_number
      productionPrompt = data!.system_prompt
    })

    it('every documented parameter key is accepted by the corresponding Zod schema', () => {
      const documented = parseDocumentedParams(productionPrompt)
      expect(
        documented.size,
        `Expected to parse ≥1 op_type Step shape line in ${productionVersion}'s system_prompt; got 0. The regex anchor "- \`<op>\` → \`parameters: { ... }\`" may have drifted.`,
      ).toBeGreaterThan(0)

      const offenders: Array<{ op: string; key: string }> = []
      for (const [opType, docKeys] of documented) {
        const schema = SCHEMA_ACCEPTED_KEYS[opType]
        if (!schema) {
          // op_type documented but schema unknown — flag once per op_type.
          offenders.push({ op: opType, key: `(op_type ${opType} not in schema registry; documented keys: ${docKeys.join(',')})` })
          continue
        }
        const accepted = new Set([...schema.required, ...schema.optional])
        for (const key of docKeys) {
          if (!accepted.has(key)) offenders.push({ op: opType, key })
        }
      }

      expect(
        offenders,
        `Director config ${productionVersion} system_prompt documents parameters the Zod schema doesn't accept: ${offenders
          .map((o) => `${o.op}.${o.key}`)
          .join(', ')}. Either (a) drop the key from the prompt — schema is the contract; or (b) extend the schema and the agent runner first, then re-document. Drift like this caused 5 silent failures in V1.x-B.3 + the 2026-05-22 expand-instruction bug.`,
      ).toEqual([])
    })

    it('every required schema parameter is documented in the prompt', () => {
      const documented = parseDocumentedParams(productionPrompt)
      const missing: Array<{ op: string; key: string }> = []
      for (const [opType, { required }] of Object.entries(SCHEMA_ACCEPTED_KEYS)) {
        const docKeys = documented.get(opType) ?? []
        for (const key of required) {
          if (!docKeys.includes(key)) missing.push({ op: opType, key })
        }
      }
      expect(
        missing,
        `Director config ${productionVersion} system_prompt fails to document required schema parameters: ${missing
          .map((o) => `${o.op}.${o.key}`)
          .join(', ')}. The model needs to know these are required.`,
      ).toEqual([])
    })

    it('every op_type in the schema registry has a Step shapes line in the prompt', () => {
      const documented = parseDocumentedParams(productionPrompt)
      const missingLines: string[] = []
      for (const opType of Object.keys(SCHEMA_ACCEPTED_KEYS)) {
        if (!documented.has(opType)) missingLines.push(opType)
      }
      expect(
        missingLines,
        `Director config ${productionVersion} system_prompt is missing a "## Step shapes" line for these op_types: ${missingLines.join(', ')}. Without documentation, the model can't use them.`,
      ).toEqual([])
    })
  },
)
