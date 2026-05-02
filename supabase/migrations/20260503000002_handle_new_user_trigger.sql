-- Migration 001a — Auto-organisation creation on auth.users insert
-- Source: stelavox_technical_architecture_v1_3.md §5 Hazard H-03
-- Build Checklist: T-3.14
-- Two safeguards added beyond the H-03 sketch:
--   (a) fallback to split_part(email, '@', 1) when no `name` metadata is supplied
--       (e.g. magic-link signups carry no name);
--   (b) slug uniqueness via user-id suffix when the derived slug collides with
--       an existing organisation slug.
-- Both safeguards are flagged for absorption into TA v1.4 (SU-1).

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER SECURITY DEFINER AS $$
DECLARE
  new_org_id UUID;
  user_name  TEXT;
  user_slug  TEXT;
BEGIN
  user_name := COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1));
  user_slug := lower(regexp_replace(user_name, '[^a-zA-Z0-9]+', '-', 'g'));
  -- Strip leading/trailing dashes that regexp_replace can leave behind.
  user_slug := trim(both '-' from user_slug);
  -- Fallback if the resulting slug is empty (e.g. user_name was all symbols).
  IF user_slug = '' THEN
    user_slug := 'user';
  END IF;
  -- Ensure slug uniqueness by suffixing the user id if a collision exists.
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

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();
