-- M-163 — throttle_reservations: add V1.x-B.2 columns that the dispatcher
-- + buckets module assume exist.
--
-- Background. V1.x-B.1.1 (M-095) created throttle_reservations with a
-- per-reservation route+user_id+org_id+slots+tokens shape. V1.x-B.2 (M-112
-- + lib/scheduler/buckets.ts) re-abstracted the reservation model around
-- a pool_key (text) keyed off user_throttle_buckets, plus an agent_job_id
-- back-reference for reconcile-on-completion, plus estimated_tokens for
-- the refund delta. None of those columns were added to the table.
--
-- The mismatch is silent: checkAndReserve() in lib/scheduler/buckets.ts
-- runs an INSERT with pool_key/agent_job_id/estimated_tokens — those
-- columns don't exist — supabase-js returns an error — the error branch
-- refunds the bucket UPDATE eagerly and returns reserved=false with
-- reason='insufficient_tokens'. The dispatcher counts this as a no_capacity
-- skip. Every ticket gets re-queued forever; the WFQ scheduler can never
-- dispatch anything.
--
-- Discovered 2026-05-17 during the Phase 8 prep pre-launch test pass.
--
-- Fix: add the V1.x-B.2 columns alongside the V1.x-B.1.1 columns. The
-- legacy columns (route/user_id/organisation_id/slots_reserved) stay for
-- backward-compat; route is relaxed to NULL-able since the V1.x-B.2
-- dispatcher doesn't populate it (pool_key is the authoritative routing
-- key). Indexes for the V1.x-B.2 lookup paths.

-- 1. Add the V1.x-B.2 columns.
ALTER TABLE public.throttle_reservations
  ADD COLUMN IF NOT EXISTS pool_key TEXT,
  ADD COLUMN IF NOT EXISTS agent_job_id UUID REFERENCES public.agent_jobs(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS estimated_tokens BIGINT;

-- 2. Relax route. V1.x-B.2 doesn't populate it (pool_key carries the
--    routing information). Existing rows from V1.x-B.1.1 already have a
--    value; this only loosens the constraint for new inserts.
ALTER TABLE public.throttle_reservations ALTER COLUMN route DROP NOT NULL;

-- 3. Index for the reconcile() lookup — find the active reservation for a
--    given (pool_key, agent_job_id) pair when a runner completes.
CREATE INDEX IF NOT EXISTS idx_throttle_reservations_v1xb2_active
  ON public.throttle_reservations (pool_key, agent_job_id)
  WHERE consumed_at IS NULL AND released_at IS NULL;

-- 4. Index for the recovery sweep — find expired reservations to refund.
CREATE INDEX IF NOT EXISTS idx_throttle_reservations_v1xb2_sweep
  ON public.throttle_reservations (expires_at)
  WHERE consumed_at IS NULL AND released_at IS NULL;
