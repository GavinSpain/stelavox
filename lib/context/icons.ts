// Spec: stelavox_phase4_build_checklist_v1_0.md §3.1 T-1.3
//       stelavox_phase4_test_plan_v1_0.md TC-V-01 (14px --color-text-muted)
//
// Lucide icon mapping for the six core context types. Components are
// imported by name so tree-shaking keeps the bundle lean.

import {
  Building2, GitBranch, Globe, MapPin, Sparkles, User,
  type LucideIcon,
} from 'lucide-react'
import type { ContextNodeType } from './types'

const ICONS: Record<ContextNodeType, LucideIcon> = {
  character:    User,
  location:     MapPin,
  organisation: Building2,
  theme:        Sparkles,
  plot_thread:  GitBranch,
  world:        Globe,
}

export function getContextIcon(type: ContextNodeType): LucideIcon {
  return ICONS[type]
}
