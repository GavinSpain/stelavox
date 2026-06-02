// Phase 8.01.C T-7.2 — positional path parser for @-mention syntax.
//
// Recognises strings like `act1ch1sc1bt2` and emits an ordered array of
// segments `[{layer:'act', position:1}, ...]`. The abbreviation map
// mirrors the LayerLabel component's so the visual vocabulary matches the
// typing vocabulary. Series omits its position (one Series node per doc).
//
// Spec: Component Spec v2.21 §18.5 (`@` mention positional path syntax).
//       Phase 14 (post-V1) replaces this hardcoded map with layer_stack
//       data; the segment shape stays the same so callers don't break.

import type { LayerKind } from '@/components/tree/LayerLabel'

export interface PositionalPathSegment {
  layer: LayerKind
  /** Position number from nodes.order. Omitted for `series`. */
  position?: number
}

// Lowercase abbreviation map. Order matters for matching: longer first
// so `ch1` doesn't accidentally match `c` (none of the V1 abbreviations
// are prefixes of others but the ordering is defensive).
const ABBR_PATTERNS: Array<{ kind: LayerKind; abbrLower: string; positional: boolean }> = [
  { kind: 'series',  abbrLower: 'series', positional: false },
  { kind: 'book',    abbrLower: 'book',   positional: true },
  { kind: 'chapter', abbrLower: 'ch',     positional: true },
  { kind: 'scene',   abbrLower: 'sc',     positional: true },
  { kind: 'beat',    abbrLower: 'bt',     positional: true },
  { kind: 'act',     abbrLower: 'act',    positional: true },
]

/**
 * Parse a positional path string. Returns null when the entire string
 * cannot be consumed by valid abbreviation+position pairs. Empty input
 * also returns null.
 *
 * Examples:
 *   "act1"             → [{layer:'act', position:1}]
 *   "act1ch1sc1bt2"    → 4 segments
 *   "series"           → [{layer:'series'}]
 *   "series1book1ch1"  → [series, book 1, chapter 1] — `series` ignores trailing digits
 *   "iron"             → null (no leading abbreviation match)
 *   "act1foo"          → null (trailing unconsumed)
 *   ""                 → null
 */
export function parsePositionalPath(input: string): PositionalPathSegment[] | null {
  if (!input) return null
  const lower = input.toLowerCase()
  const segments: PositionalPathSegment[] = []
  let i = 0

  while (i < lower.length) {
    let matched = false
    for (const { kind, abbrLower, positional } of ABBR_PATTERNS) {
      if (lower.startsWith(abbrLower, i)) {
        const afterAbbr = i + abbrLower.length
        if (positional) {
          // Read digits.
          let j = afterAbbr
          while (j < lower.length && lower.charCodeAt(j) >= 48 && lower.charCodeAt(j) <= 57) j++
          if (j === afterAbbr) {
            // Abbreviation matched but no digits — invalid (positional layers require a number).
            // Continue trying other abbreviations.
            continue
          }
          const positionStr = lower.slice(afterAbbr, j)
          const position = Number.parseInt(positionStr, 10)
          if (!Number.isFinite(position) || position <= 0) continue
          segments.push({ layer: kind, position })
          i = j
        } else {
          // Series (or other non-positional) — no number after.
          segments.push({ layer: kind })
          // Greedily skip trailing digits per spec (we don't care if user typed series1)
          let j = afterAbbr
          while (j < lower.length && lower.charCodeAt(j) >= 48 && lower.charCodeAt(j) <= 57) j++
          i = j
        }
        matched = true
        break
      }
    }
    if (!matched) {
      // Cannot consume the rest of the string — invalid path.
      return null
    }
  }

  return segments.length > 0 ? segments : null
}
