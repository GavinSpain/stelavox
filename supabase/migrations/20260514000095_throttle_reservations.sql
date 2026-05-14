-- Migration 095 — V1.x-B.1.1: throttle_reservations table.
-- Source: stelavox_v1x_b_1_1_build_checklist_v1_0.md §3.1 T-1.5
--         + Director Architecture v2.0 §9.9 (reservation pattern)
--         + H-17 (reservation TTL hygiene).
--
-- Before opening an Anthropic streaming connection, the throttle
-- reserves one concurrent-connection slot + an estimated token cost.
-- After response: reconcile actuals; release the slot.
--
-- H-17 mitigation — every reservation has a TTL. If the reserving
-- function dies before consuming, the cleanup sweep (M-099) releases
-- the slot. Without TTL hygiene, crashed reservations create phantom
-- holds on capacity and cause false saturation.
--
-- B.1.1 policy:
--   route='platform' → consumes one slot under cap=1 (M-101).
--   route='byok' → no-op reservation (pass-through; logged for audit).
--
-- B.2 swaps the implementation to WFQ-aware reservation; the schema
-- is the contract.

CREATE TABLE throttle_reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  route TEXT NOT NULL CHECK (route IN ('platform','byok')),
  traffic_class INTEGER CHECK (traffic_class IS NULL OR traffic_class BETWEEN 1 AND 4),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  organisation_id UUID REFERENCES organisations(id) ON DELETE SET NULL,
  slots_reserved INTEGER NOT NULL DEFAULT 1 CHECK (slots_reserved >= 1),
  tokens_reserved BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  released_at TIMESTAMPTZ
);

-- Sweep query support — find expired-but-not-consumed-or-released.
CREATE INDEX idx_throttle_reservations_sweep
  ON throttle_reservations(route, expires_at)
  WHERE consumed_at IS NULL AND released_at IS NULL;

-- Active-count query support — current capacity utilisation.
CREATE INDEX idx_throttle_reservations_active
  ON throttle_reservations(route, traffic_class)
  WHERE consumed_at IS NOT NULL AND released_at IS NULL;

-- Add the FK from agent_jobs.reservation_id (added in M-092 without FK).
ALTER TABLE agent_jobs
  ADD CONSTRAINT agent_jobs_reservation_id_fk
  FOREIGN KEY (reservation_id) REFERENCES throttle_reservations(id) ON DELETE SET NULL;

-- Service-role only — throttle decisions live in lib/scheduler/.
ALTER TABLE throttle_reservations ENABLE ROW LEVEL SECURITY;
