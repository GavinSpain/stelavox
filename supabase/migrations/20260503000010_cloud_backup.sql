-- Migration 008 — Cloud Backup Tables
-- Source: stelavox_technical_architecture_v1_3.md §3.6 Migration 008

CREATE TABLE backup_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('google_drive','dropbox','onedrive')),
  access_token_vault_id TEXT NOT NULL,
  refresh_token_vault_id TEXT NOT NULL,
  folder_path TEXT NOT NULL DEFAULT '/Stelavox Backups/',
  schedule TEXT NOT NULL DEFAULT 'manual' CHECK (schedule IN ('daily','weekly','manual')),
  schedule_hour_utc INTEGER CHECK (schedule_hour_utc BETWEEN 0 AND 23),
  schedule_day_of_week INTEGER CHECK (schedule_day_of_week BETWEEN 0 AND 6),
  formats TEXT[] NOT NULL DEFAULT ARRAY['json','markdown'],
  include_version_history BOOLEAN NOT NULL DEFAULT FALSE,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  last_backup_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE backup_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  config_id UUID NOT NULL REFERENCES backup_configs(id) ON DELETE CASCADE,
  trigger TEXT NOT NULL CHECK (trigger IN ('scheduled','manual')),
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','complete','failed')),
  document_count INTEGER,
  node_count INTEGER,
  file_size_bytes INTEGER,
  provider_file_id TEXT,
  provider_file_url TEXT,
  error_message TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

ALTER TABLE backup_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE backup_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "backup_configs_org_access" ON backup_configs
  FOR ALL USING (
    organisation_id IN (
      SELECT organisation_id FROM organisation_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "backup_jobs_org_access" ON backup_jobs
  FOR ALL USING (
    organisation_id IN (
      SELECT organisation_id FROM organisation_members WHERE user_id = auth.uid()
    )
  );
