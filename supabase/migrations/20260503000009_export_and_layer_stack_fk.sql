-- Migration 007 — Export and Layer Stack Foreign Keys
-- Source: stelavox_technical_architecture_v1_3.md §3.6 Migration 007

-- Update layer_stacks with document FK now that documents table exists
ALTER TABLE layer_stacks
  ADD CONSTRAINT fk_layer_stacks_document
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE;

-- Export jobs (generated files stored in Supabase Storage)
CREATE TABLE export_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  format TEXT NOT NULL CHECK (format IN ('docx','pdf','epub','kdp','json','markdown','outline')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','completed','failed')),
  storage_path TEXT,
  signed_url TEXT,
  signed_url_expires_at TIMESTAMPTZ,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);
ALTER TABLE export_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org_members_access_export_jobs" ON export_jobs
  FOR ALL USING (
    organisation_id IN (
      SELECT organisation_id FROM organisation_members WHERE user_id = auth.uid()
    )
  );
