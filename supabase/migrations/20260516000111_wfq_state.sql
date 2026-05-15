-- Migration 111 — V1.x-B.2.2: wfq_state singleton table.
--
-- Source: stelavox_v1x_b_2_build_checklist_v1_0.md §4.2.1 M-111 +
--         Director Architecture v2.0 §9 (throttling) + §9.4 (WFQ).
--
-- Single-row table holding the global Virtual Finish Time (VFT) state
-- for the WFQ scheduler. Concurrency-safe: every dispatcher tick that
-- picks a ticket does FOR UPDATE on this row (id=1) before computing
-- the next VFT — serialises picks across concurrent dispatchers.
--
-- VFT semantics (per §9.4 of the architecture doc):
--   For each non-empty class, ticketVft = max(class_N_last_vft, virtual_clock)
--                                       + (ticketCost / classWeight)
--   Pick the ticket with the smallest ticketVft.
--   On dispatch: class_N_last_vft = ticketVft; virtual_clock = ticketVft.
--
-- Aging promotion (per §9.4): a ticket queued > agent.aging_promotion_ms
-- gets effective traffic_class = max(1, traffic_class - 1) for the VFT
-- calc only. Persistent traffic_class on agent_jobs unchanged. Prevents
-- class-4 starvation under sustained heavy class-1/2 load.
--
-- H-22 (VFT virtual clock overflow) — NUMERIC(20,6) gives 14 digits
-- before decimal. At 1M tokens/sec sustained dispatch (orders of
-- magnitude beyond reality), overflow is millennia away. Cumulative
-- drift over years of operation can be reset by a future periodic
-- re-zero job: subtract min(class_N_last_vft) from virtual_clock and
-- all class_N_last_vfts simultaneously. Job lands in V1.x-D operational
-- maintenance; B.2.2 just lays the table.

CREATE TABLE wfq_state (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  virtual_clock NUMERIC(20,6) NOT NULL DEFAULT 0,
  class_1_last_vft NUMERIC(20,6) NOT NULL DEFAULT 0,
  class_2_last_vft NUMERIC(20,6) NOT NULL DEFAULT 0,
  class_3_last_vft NUMERIC(20,6) NOT NULL DEFAULT 0,
  class_4_last_vft NUMERIC(20,6) NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO wfq_state (id) VALUES (1);

-- No RLS — service role only (the dispatcher is the only writer; the
-- admin dashboard reads via the metrics_minute_buckets view).
ALTER TABLE wfq_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_only_wfq_state" ON wfq_state
  FOR ALL USING (FALSE);  -- no authenticated reads; service role bypasses RLS
