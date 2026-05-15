-- Migration 126 — V1.x-B.3: drop one-active-Brief partial unique index.
--
-- Source: stelavox_v1x_b_3_build_checklist_v1_0.md §2 M-126.
--
-- V1.x-A.1 enforced one-Brief-at-a-time per document via a partial
-- unique index. V1.x-B.1.1 (M-091) tightened it to one-active-only
-- (queued + planned were unrestricted). V1.x-B.3 drops the constraint
-- entirely — multiple Briefs may be `active` on the same document
-- concurrently. Soft node-reservation warnings (lib/brief/nodeReservationWarnings.ts)
-- surface at proposal time when concurrent Briefs would target overlapping
-- nodes; the user makes the call.
--
-- The `accept_brief` RPC's `another_brief_active` pre-check is removed
-- in M-128. The 'queued' status stays in the briefs CHECK constraint
-- for backwards compatibility with V1.x-B.1.1 + V1.x-B.1.2 data; no
-- new code path produces 'queued' rows post-V1.x-B.3.

DROP INDEX IF EXISTS briefs_strict_one_active_per_document_uidx;
