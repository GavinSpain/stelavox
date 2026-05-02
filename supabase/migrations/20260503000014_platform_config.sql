-- Migration 012 — Platform configuration table
-- Source: stelavox_technical_architecture_v1_3.md §3.7.2

CREATE TABLE platform_config (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  description TEXT NOT NULL,     -- human-readable explanation for the admin UI
  value_type TEXT NOT NULL       -- 'integer' | 'number' | 'string' | 'boolean' | 'object'
    CHECK (value_type IN ('integer','number','string','boolean','object')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by TEXT                -- audit: who last changed this value
);

-- No RLS read access for users. All reads are via the server-side service-role
-- client. Writes are restricted to the service role (admin operations only).
ALTER TABLE platform_config ENABLE ROW LEVEL SECURITY;
-- No user-facing read policy is created. This prevents any client-side
-- enumeration of platform configuration values.
