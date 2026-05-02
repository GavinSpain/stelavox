-- Migration 006 — Multi-Tenancy Support Tables
-- Source: stelavox_technical_architecture_v1_3.md §3.6 Migration 006

CREATE TABLE node_locks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  node_id UUID NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  locked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '5 minutes',
  UNIQUE(node_id)
);
ALTER TABLE node_locks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org_members_access_node_locks" ON node_locks
  FOR ALL USING (
    organisation_id IN (
      SELECT organisation_id FROM organisation_members WHERE user_id = auth.uid()
    )
  );

CREATE TABLE usage_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  year_month TEXT NOT NULL,            -- e.g. '2026-05'
  operation_type TEXT NOT NULL,
  provider TEXT NOT NULL,
  tokens_input BIGINT NOT NULL DEFAULT 0,
  tokens_output BIGINT NOT NULL DEFAULT 0,
  tokens_cache_write BIGINT NOT NULL DEFAULT 0,
  tokens_cache_read BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(organisation_id, year_month, operation_type, provider)
);
ALTER TABLE usage_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org_members_access_usage_records" ON usage_records
  FOR ALL USING (
    organisation_id IN (
      SELECT organisation_id FROM organisation_members WHERE user_id = auth.uid()
    )
  );

CREATE TABLE subscription_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  stripe_event_id TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE subscription_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owners_access_subscription_events" ON subscription_events
  FOR ALL USING (
    organisation_id IN (
      SELECT organisation_id FROM organisation_members
      WHERE user_id = auth.uid() AND role = 'owner'
    )
  );

CREATE TABLE audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID REFERENCES organisations(id) ON DELETE SET NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info'
    CHECK (severity IN ('info','medium','high','critical')),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- audit_log SELECT is owner/admin-only.
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owners_read_audit_log" ON audit_log
  FOR SELECT USING (
    organisation_id IN (
      SELECT organisation_id FROM organisation_members
      WHERE user_id = auth.uid() AND role IN ('owner','admin')
    )
  );
