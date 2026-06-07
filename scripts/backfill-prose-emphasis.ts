// One-shot — walk all nodes.prose JSON and convert literal `*word*` /
// `**word**` patterns inside text nodes into italic/bold Tiptap marks.
//
// Same parser as lib/agent/prose-to-tiptap.parseInlineMarks. Walks the
// existing prose JSON tree and rewrites any unstyled text node that
// contains a Markdown emphasis pattern into a sequence of text nodes
// with the right marks. Text nodes that already carry marks are LEFT
// ALONE (they're user-authored and may be intentionally formatted).
//
// Idempotent: running twice on already-converted content produces no
// changes (the text inside an italic-marked node has no asterisks left,
// so the parser returns it as-is).
//
// Safety: counts rows touched and rows skipped, prints a per-document
// summary, and writes back via the service-role client so RLS doesn't
// reject the UPDATE. The pre-script snapshot is at
// snapshots/stelavox_local_2026-06-06_pre_emphasis_backfill.dump —
// roll back with `pg_restore -d postgres -c <dump>` if needed.

async function main() {
  const { createClient } = await import('@supabase/supabase-js')
  const fs = await import('node:fs')
  const { parseInlineMarks } = await import('../lib/agent/prose-to-tiptap')

  const env = Object.fromEntries(
    fs.readFileSync('.env.local', 'utf-8').split('\n')
      .filter((l) => l.includes('=') && !l.startsWith('#'))
      .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }),
  )
  const url = env.NEXT_PUBLIC_SUPABASE_URL!
  const key = env.SUPABASE_SERVICE_ROLE_KEY!
  const supabase = createClient(url, key)

  // Pull all leaf prose rows. Non-leaves don't have prose. We don't
  // need to compute leaf-ness explicitly because non-leaves carry
  // prose=null and the .not('prose', 'is', null) filter excludes them.
  const { data: rows, error } = await supabase
    .from('nodes')
    .select('id, document_id, name, prose')
    .not('prose', 'is', null)
  if (error) { console.error(error); process.exit(1) }
  if (!rows) { console.error('no rows'); process.exit(1) }

  console.log(`Found ${rows.length} nodes with non-null prose`)

  let touched = 0
  let untouched = 0
  let errored = 0
  const docCounts: Record<string, { touched: number; untouched: number }> = {}

  for (const row of rows) {
    try {
      const updated = transformProse(row.prose, parseInlineMarks)
      const docKey = row.document_id ?? 'unknown'
      docCounts[docKey] ??= { touched: 0, untouched: 0 }
      if (updated.changed) {
        const { error: updErr } = await supabase
          .from('nodes')
          .update({ prose: updated.value })
          .eq('id', row.id)
        if (updErr) {
          console.error(`  err updating ${row.id} (${row.name}):`, updErr.message)
          errored++
          continue
        }
        touched++
        docCounts[docKey].touched++
        console.log(`  ✓ ${row.id} (${row.name}) — ${updated.spansAdded} emphasis spans`)
      } else {
        untouched++
        docCounts[docKey].untouched++
      }
    } catch (e) {
      console.error(`  err processing ${row.id}:`, e)
      errored++
    }
  }

  console.log()
  console.log(`Touched:   ${touched}`)
  console.log(`Untouched: ${untouched}`)
  console.log(`Errored:   ${errored}`)
  console.log(`Total:     ${rows.length}`)
  console.log()
  console.log('Per document:')
  for (const [docId, counts] of Object.entries(docCounts)) {
    console.log(`  ${docId}  touched=${counts.touched}  untouched=${counts.untouched}`)
  }
}

interface ParseFn {
  (text: string): Array<{ type: 'text'; text: string; marks?: Array<{ type: 'italic' | 'bold' }> }>
}

/** Walk the Tiptap prose JSON; transform unstyled text nodes that
 *  contain Markdown emphasis. Returns the new JSON plus a `changed`
 *  flag (false → original was untouched). */
function transformProse(
  prose: unknown,
  parse: ParseFn,
): { value: unknown; changed: boolean; spansAdded: number } {
  if (typeof prose === 'string') {
    // Defensive — some legacy rows may have stored prose as JSON-encoded
    // string instead of object. Try to parse.
    try {
      prose = JSON.parse(prose)
    } catch {
      return { value: prose, changed: false, spansAdded: 0 }
    }
  }
  if (!prose || typeof prose !== 'object') {
    return { value: prose, changed: false, spansAdded: 0 }
  }
  let spansAdded = 0
  let changed = false
  function walk(node: unknown): unknown {
    if (!node || typeof node !== 'object') return node
    const n = node as { type?: string; content?: unknown[]; text?: string; marks?: unknown[] }
    // Text node — candidate for transformation. Skip if it already
    // carries marks (user-authored or already-processed).
    if (n.type === 'text' && typeof n.text === 'string' && (!n.marks || n.marks.length === 0)) {
      const parsed = parse(n.text)
      // No transformation if the parser returned a single un-marked
      // text node with the same text — no Markdown found.
      if (
        parsed.length === 1 &&
        (!parsed[0].marks || parsed[0].marks.length === 0) &&
        parsed[0].text === n.text
      ) {
        return n
      }
      changed = true
      spansAdded += parsed.filter((p) => p.marks && p.marks.length > 0).length
      // If only one node returned, return it directly. Otherwise the
      // PARENT must replace this text node with multiple nodes — caller
      // handles via the content[] flat-map below.
      return parsed
    }
    // Container node with content[] — walk children and flat-map any
    // arrays returned (a text node that was split into multiple).
    if (Array.isArray(n.content)) {
      const newContent: unknown[] = []
      for (const child of n.content) {
        const transformed = walk(child)
        if (Array.isArray(transformed)) {
          newContent.push(...transformed)
        } else {
          newContent.push(transformed)
        }
      }
      // Only allocate a new object if any child was actually replaced.
      // Cheap heuristic: lengths differ OR any new child differs by
      // reference from the original.
      let kidsChanged = newContent.length !== n.content.length
      if (!kidsChanged) {
        for (let i = 0; i < newContent.length; i++) {
          if (newContent[i] !== n.content[i]) { kidsChanged = true; break }
        }
      }
      if (kidsChanged) {
        return { ...n, content: newContent }
      }
      return n
    }
    return n
  }
  const out = walk(prose)
  return { value: out, changed, spansAdded }
}

main().catch((e) => { console.error(e); process.exit(1) })
