/**
 * XML escaping for user-controlled content.
 *
 * Source: stelavox_technical_architecture_v1_8.md §4.2 (XML Tagging /
 * Spotlighting). Build Checklist T-3.3.
 *
 * Replaces the five XML special characters with their entity equivalents.
 * The order matters: `&` is replaced first to avoid double-escaping the
 * `&` introduced by the other replacements.
 *
 * Used by every formatter in lib/llm/context-assembler.ts before wrapping
 * user content in <user_data> tags. Per TA §4.2:
 *
 *   "Rule: escapeXml() must be applied to every user-controlled string
 *   before XML wrapping. Missing escaping on any field is a security
 *   vulnerability."
 */

export function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}
