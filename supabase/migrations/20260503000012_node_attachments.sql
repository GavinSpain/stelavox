-- Migration 010 — Node Attachments
-- Source: stelavox_technical_architecture_v1_3.md §3.6 Migration 010

CREATE TABLE node_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  node_id UUID NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_type TEXT NOT NULL CHECK (file_type IN ('pdf','image','text','other')),
  mime_type TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  storage_path TEXT NOT NULL,
  created_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE node_attachments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "attachments_org_access" ON node_attachments
  FOR ALL USING (
    organisation_id IN (
      SELECT organisation_id FROM organisation_members WHERE user_id = auth.uid()
    )
  );

-- Trigger: keep attachment_count in sync
CREATE OR REPLACE FUNCTION update_attachment_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE nodes SET attachment_count = attachment_count + 1 WHERE id = NEW.node_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE nodes SET attachment_count = attachment_count - 1 WHERE id = OLD.node_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_attachment_count
AFTER INSERT OR DELETE ON node_attachments
FOR EACH ROW EXECUTE FUNCTION update_attachment_count();

-- Supabase Storage bucket for attachments
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'node-attachments', 'node-attachments', FALSE, 52428800,
  ARRAY['application/pdf','image/jpeg','image/png','image/webp','image/gif',
        'text/plain','text/markdown']
)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "attachments_storage_access" ON storage.objects
  FOR ALL USING (
    bucket_id = 'node-attachments'
    AND (storage.foldername(name))[1] = 'organisations'
    AND (storage.foldername(name))[2] IN (
      SELECT organisation_id::text FROM organisation_members WHERE user_id = auth.uid()
    )
  );

-- Storage path format: organisations/{org_id}/documents/{doc_id}/nodes/{node_id}/{attachment_id}/{file_name}
