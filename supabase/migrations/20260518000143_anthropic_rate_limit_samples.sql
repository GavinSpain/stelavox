-- V1.x-E.1 — anthropic_rate_limit_samples table.
--
-- Source: Component Spec §17.5 §3 (Anthropic header headroom) ·
-- wireframe_admin_dashboard_v1.html §05 M-143.
--
-- Each Anthropic API call returns rate-limit headers indicating the
-- caller's headroom across four dimensions (RPM, ITPM, OTPM, concurrent
-- connections). The agent runner now captures these per-response and
-- inserts a row here. The admin dashboard reads the most-recent row
-- per model to render the headroom widget.
--
-- 7-day retention matches dispatcher_tick_samples and route_capacity_
-- samples (M-115/M-116). Daily purge cron added in M-145 alongside the
-- existing purge_raw_metric_samples function.
--
-- The table is admin-scoped (no per-org filter); raw header info is
-- platform-wide capacity signal. RLS denies user reads; admin route
-- uses service-role client.
--
-- H-13: SET search_path = public preserved on supporting functions
-- (none required for this table — pure data store).

CREATE TABLE anthropic_rate_limit_samples (
  id BIGSERIAL PRIMARY KEY,
  sampled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  model_id TEXT NOT NULL,
  -- Header values as Anthropic returns them — request and token caps
  -- + remaining counts + UTC reset timestamps. Nullable to accommodate
  -- header-set evolution (Anthropic may add or rename fields).
  requests_limit INTEGER NULL,
  requests_remaining INTEGER NULL,
  requests_reset TIMESTAMPTZ NULL,
  input_tokens_limit INTEGER NULL,
  input_tokens_remaining INTEGER NULL,
  input_tokens_reset TIMESTAMPTZ NULL,
  output_tokens_limit INTEGER NULL,
  output_tokens_remaining INTEGER NULL,
  output_tokens_reset TIMESTAMPTZ NULL,
  -- Tier identifier and any other auxiliary info from
  -- anthropic-ratelimit-tokens or related headers.
  tier TEXT NULL
);

CREATE INDEX anthropic_rate_limit_samples_sampled_at_idx
  ON anthropic_rate_limit_samples (sampled_at DESC);

CREATE INDEX anthropic_rate_limit_samples_model_sampled_idx
  ON anthropic_rate_limit_samples (model_id, sampled_at DESC);

ALTER TABLE anthropic_rate_limit_samples ENABLE ROW LEVEL SECURITY;
-- No user-facing read policy: admin reads via service-role client only.

COMMENT ON TABLE anthropic_rate_limit_samples IS
  'V1.x-E.1 — per-API-call rate-limit headroom snapshots. Populated by the agent runner''s captureAnthropicHeaders hook on every Anthropic response. Admin dashboard reads the most-recent row per model for the headroom widget. 7-day retention via M-145 purge cron.';
