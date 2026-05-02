# Stelavox — Wireframe Errata
## Version 1.0

---

## Purpose

This document records corrections that apply when reading the Stelavox HTML wireframes. The wireframes are preserved as-is to maintain the design record. Where this document and a wireframe conflict, **this document takes precedence**.

Read this document before reading any wireframe. The corrections are brief and specific — they do not affect the rendered layouts, component structures, or interaction patterns. They affect only three classes of value: the verdigris sanctioned use count, the `--easing-prose` cubic-bezier value, and the Inviolables count.

**Companion documents:** Brand Identity v2.0 (authoritative on all three issues), UI Design Specification v1.0, Component Specification v2.0.

---

## Corrections by Wireframe

### wireframe_edit_mode_v1.html

**Correction 1 — Verdigris use count**

The spec table at the bottom of the document contains this row:

> `--color-accent` · `#3d7858` · `#254a38` · ⚠ Verdigris — **5 uses only** (see Inviolable II)

And a second instance:

> Agent done = verdigris (one of **5 uses**)

Both are outdated. The correct count is **nine sanctioned uses**. The complete list is in Brand Identity v2.0 §5.1 and reproduced in Component Specification v2.0 §1.4. Any codebase search for `--color-accent` or `#3d7858` must find exactly nine matches, not five.

**Correction 2 — `--easing-prose` cubic-bezier value**

The motion table contains:

> `--easing-prose` · `cubic-bezier(0.25, 0, 0.5, 1)` · Gentle — sentence focus fade, word count fade

The locked value is `cubic-bezier(0.25, 0.1, 0.25, 1)`. The asymmetric value in the wireframe was unresolved at the time of writing and has since been locked as a symmetric ease-in-out. See Brand Identity v2.0 §9.2.

**Correction 3 — Inviolables count**

The spec block titled "The Three Inviolables" lists three rules. The correct count is **five**. The two additional Inviolables are:

> **Inviolable 4 — The typeface boundary is absolute.** No Inter text in the prose editor. No Lora text in the structural panels. The serif-to-sans transition is the signal that the author has crossed from managing the work to being inside it. This boundary must be absolute — every exception weakens the signal.

> **Inviolable 5 — The prose editor has no visible toolbar.** The prose editor produces running text. It has no formatting toolbar, no heading dropdown, no style picker, no insert menu visible at rest. Formatting is reached through keyboard shortcuts and the selection-triggered inline tooltip (Bold · Italic · Link only).

See Brand Identity v2.0 §12.

---

### wireframe_agent_tab_v1.html

**Correction 1 — Verdigris use count and update instructions**

Two passages contain outdated guidance:

> "This is an eighth sanctioned use of verdigris in the Category 3 (Completion) group. Update Brand Identity §4.4 and Component Spec §1.4 to include this use."

> "The Accept button background (`--color-accent`) is an eighth sanctioned use of verdigris... Update **Brand Identity v1.1 §4.4** (add to Category 3 list) and **Component Spec v1.0 §1.4** (add to the seven-location table). The total is now eight sanctioned uses."

Both passages are outdated. The action items they contain have been completed. The current state:

- The Accept button is sanctioned use **#7** (not #8 — the numbering was revised in Brand Identity v2.0 §5.1)
- The trial expiry plan CTA is sanctioned use **#8**
- The word count at target is sanctioned use **#6**
- The total is **nine** sanctioned uses
- Brand Identity is at **v2.0** (not v1.1) and already contains the correct list
- Component Specification is at **v2.0** (not v1.0) and already contains the correct list

No action is required by the coding agent. The documents are already updated. Treat the "Update..." instructions in the wireframe as completed historical notes.

---

### wireframe_focus_mode_v1.html

**Correction 1 — Inviolables count**

Any reference in this wireframe to "Three Inviolables" or a count of three is outdated. The correct count is **five**. See the Inviolable 4 and Inviolable 5 text in the `wireframe_edit_mode_v1.html` corrections above — both apply equally here.

The focus mode surface itself is governed by Inviolable 1 (the prose surface is always the lowest-noise surface) and Inviolable 5 (no visible toolbar). Both are correctly represented in the wireframe's rendered layout — the correction is to the count only, not the design.

---

## Wireframes with No Corrections

The following wireframes are current and require no corrections. They may be read without reference to this document:

| Wireframe | Status |
|---|---|
| `wireframe_cmd_palette_modals_v1.html` | Current |
| `wireframe_director_mode_v1.html` | Current |
| `wireframe_empty_states_toast_v1.html` | Current |
| `wireframe_mobile_notes_v1.html` | Current |
| `wireframe_project_dashboard_v1.html` | Current |
| `wireframe_prose_surface_v1.html` | Current |
| `wireframe_tablet_v1.html` | Current |

---

## Summary of All Value Corrections

For quick reference, all value corrections in one place:

| Wireframe | What the wireframe says | Correct value | Authority |
|---|---|---|---|
| `wireframe_edit_mode_v1.html` | `--color-accent` · "5 uses only" | **9 uses** | Brand Identity v2.0 §5.1 |
| `wireframe_edit_mode_v1.html` | `--easing-prose: cubic-bezier(0.25, 0, 0.5, 1)` | `cubic-bezier(0.25, 0.1, 0.25, 1)` | Brand Identity v2.0 §9.2 |
| `wireframe_edit_mode_v1.html` | "The Three Inviolables" | **Five Inviolables** | Brand Identity v2.0 §12 |
| `wireframe_agent_tab_v1.html` | Accept button is "eighth sanctioned use" | Accept button is **use #7**; total is **9** | Brand Identity v2.0 §5.1 |
| `wireframe_agent_tab_v1.html` | "Update Brand Identity v1.1 / Component Spec v1.0" | Already updated — Brand Identity v2.0, Component Spec v2.0 | Both documents |
| `wireframe_focus_mode_v1.html` | "Three Inviolables" (any reference) | **Five Inviolables** | Brand Identity v2.0 §12 |

---

## Changelog

**v1.0 — 2026-05-01** Initial errata document. Corrections identified during specification refresh project (AI-Native Project Specification Standard v1.1 compliance pass). Three wireframes affected: `wireframe_edit_mode_v1.html` (verdigris count, easing-prose value, inviolables count), `wireframe_agent_tab_v1.html` (verdigris count and outdated update instructions), `wireframe_focus_mode_v1.html` (inviolables count). Seven wireframes confirmed current with no corrections required.
