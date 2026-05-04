// Spec: stelavox_phase4_build_checklist_v1_0.md §3.1 T-1.2
//       stelavox_phase4_api_contract_v1_0.md §2.5 (V1 whitelist)
//
// Display labels for the six core context types. British spelling
// retained to match existing code style (Organisation with -s).
// "Plot Thread" is two words.

import type { ContextNodeType } from './types'

const LABELS: Record<ContextNodeType, { singular: string; plural: string }> = {
  character:    { singular: 'Character',    plural: 'Characters'     },
  location:     { singular: 'Location',     plural: 'Locations'      },
  organisation: { singular: 'Organisation', plural: 'Organisations'  },
  theme:        { singular: 'Theme',        plural: 'Themes'         },
  plot_thread:  { singular: 'Plot Thread',  plural: 'Plot Threads'   },
  world:        { singular: 'World',        plural: 'Worlds'         },
}

export function getContextLabel(type: ContextNodeType, plural = false): string {
  const entry = LABELS[type]
  return plural ? entry.plural : entry.singular
}
