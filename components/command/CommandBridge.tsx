'use client'

/**
 * Phase 8.1 — Command bridge.
 *
 * Mounts at AppShell level. Listens for command-palette emit events
 * that don't have a natural owner elsewhere:
 *
 *   - toggle-sentence-focus / toggle-typewriter  → flip useProseSettings
 *   - sign-out                                   → Supabase signOut + redirect
 *
 * Other emit events are handled where they belong:
 *   - switch-mode-edit / switch-mode-director    → ModeProvider
 *   - show-shortcuts                             → KeyboardShortcutsProvider
 *
 * Phase 8.1 also stubs two document-scoped events that need access
 * to per-document state (enter-focus-mode, export-document); those
 * bridges land in DocumentClient in a follow-up commit.
 */

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

import { createClient } from '@/lib/supabase/client'
import { useProseSettings } from '@/lib/hooks/useProseSettings'
import { COMMAND_EVENT } from '@/lib/commands/commands'

export function CommandBridge() {
  const router = useRouter()
  const { sentenceFocus, typewriter, setSentenceFocus, setTypewriter } =
    useProseSettings()

  useEffect(() => {
    function onToggleSF() { setSentenceFocus(!sentenceFocus) }
    function onToggleTW() { setTypewriter(!typewriter) }
    async function onSignOut() {
      const supabase = createClient()
      await supabase.auth.signOut()
      router.push('/login')
    }
    window.addEventListener(COMMAND_EVENT.toggleSentenceFocus, onToggleSF)
    window.addEventListener(COMMAND_EVENT.toggleTypewriter, onToggleTW)
    window.addEventListener(COMMAND_EVENT.signOut, onSignOut)
    return () => {
      window.removeEventListener(COMMAND_EVENT.toggleSentenceFocus, onToggleSF)
      window.removeEventListener(COMMAND_EVENT.toggleTypewriter, onToggleTW)
      window.removeEventListener(COMMAND_EVENT.signOut, onSignOut)
    }
  }, [sentenceFocus, typewriter, setSentenceFocus, setTypewriter, router])

  return null
}
