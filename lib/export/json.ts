/**
 * Phase 7.B — JSON export renderer.
 *
 * 7.A substrate stub. Real implementation lands in 7.B.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export async function renderJson(
  _supabase: SupabaseClient,
  _documentId: string,
  _onChapterRendered: (chapterName: string | null) => Promise<void>,
): Promise<string> {
  throw new Error('renderJson: pending 7.B implementation')
}
