-- Migration 016 — Fix handle_new_user search_path
-- SECURITY DEFINER functions must set search_path explicitly; without it the
-- function inherits the caller's search_path.  GoTrue connects as
-- supabase_auth_admin whose search_path does not include public, so the
-- unqualified reference to "organisations" fails with 42P01.
-- Fix: replace the function with an identical body but add SET search_path = public.

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER SECURITY DEFINER SET search_path = public AS $$
DECLARE
  new_org_id UUID;
  user_name  TEXT;
  user_slug  TEXT;
BEGIN
  user_name := COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1));
  user_slug := lower(regexp_replace(user_name, '[^a-zA-Z0-9]+', '-', 'g'));
  user_slug := trim(both '-' from user_slug);
  IF user_slug = '' THEN
    user_slug := 'user';
  END IF;
  IF EXISTS (SELECT 1 FROM organisations WHERE slug = user_slug) THEN
    user_slug := user_slug || '-' || substr(NEW.id::text, 1, 8);
  END IF;

  INSERT INTO organisations (name, slug)
  VALUES (user_name, user_slug)
  RETURNING id INTO new_org_id;

  INSERT INTO organisation_members (organisation_id, user_id, role)
  VALUES (new_org_id, NEW.id, 'owner');

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
