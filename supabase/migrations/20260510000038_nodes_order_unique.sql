-- Migration 038 — UNIQUE(parent_id, "order") on nodes (round-3 audit B4.1, F-265).
--
-- TA H-04: integer node ordering must update all affected siblings in a
-- single transaction. The audit found that no DB-level guard exists:
-- two concurrent appends (`createNode` with `MAX(order) + 1`) or a
-- partial `renumberSiblingsAfterDelete` could leave duplicate `order`
-- values for the same parent. Adding the UNIQUE constraint at the
-- database layer makes the duplicate physically impossible regardless
-- of application-side races.
--
-- DEFERRABLE INITIALLY DEFERRED is critical: the existing `move_node`
-- RPC (Migration 021) does multi-row UPDATEs that shift order values
-- (`SET "order" = "order" + 1` / `- 1` over a range). Without the
-- DEFERRED setting, the constraint would be checked after each row
-- update, and a perfectly legal mid-transaction state (two rows
-- temporarily sharing an order value) would fail. With DEFERRED, the
-- check runs at COMMIT time so the final post-shift state is what's
-- validated.
--
-- NULL parent_id: PostgreSQL UNIQUE defaults to NULLS DISTINCT, so the
-- ~1000 root structural and context nodes that share parent_id=NULL,
-- order=1 are not affected — multiple NULL parent_ids in the same
-- (NULL, order) tuple are permitted.

ALTER TABLE nodes
  ADD CONSTRAINT nodes_parent_order_unique
  UNIQUE (parent_id, "order")
  DEFERRABLE INITIALLY DEFERRED;
