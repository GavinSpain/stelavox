-- M-229 — Phase 13.1 Landing Page: waitlist capture + phased-CTA config.
--
-- Source: docs/stelavox_landing_page_spec_v1_0.md §3 + §6;
--         docs/wireframes/wireframe_landing_page_v1.html.
--
-- Two small pieces of substrate; everything else on the landing page is
-- presentational.
--
--   1. waitlist_signups — pre-launch email capture. RLS on, no public
--      policies; the ONLY write path is the SECURITY DEFINER join_waitlist()
--      RPC (so the table can't be enumerated or scraped via PostgREST), and
--      the ONLY read path is a service-role client (admin export later).
--      Dedupe is case-insensitive via a lower(email) unique index — no
--      citext dependency (none exists elsewhere in the schema).
--
--   2. marketing.signup_mode — the phased CTA switch. 'waitlist' collects
--      emails (pre-launch); flip to 'open' (a single UPDATE, no deploy) to
--      turn the hero CTA into "Get started" → /signup at launch.

CREATE TABLE IF NOT EXISTS waitlist_signups (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email       TEXT NOT NULL,
  source      TEXT NOT NULL DEFAULT 'landing',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Case-insensitive dedupe + a created_at index for the eventual admin export.
CREATE UNIQUE INDEX IF NOT EXISTS waitlist_signups_email_lower_uidx
  ON waitlist_signups (lower(email));
CREATE INDEX IF NOT EXISTS waitlist_signups_created_at_idx
  ON waitlist_signups (created_at DESC);

-- RLS on, no policies — inserts go through the SECURITY DEFINER RPC below,
-- reads through the service-role client only.
ALTER TABLE waitlist_signups ENABLE ROW LEVEL SECURITY;

-- join_waitlist — the only public write path. Validates + flood-guards +
-- dedupes atomically. Returns whether THIS call added a new row (false =
-- already on the list) so the UI can show the right confirmation.
CREATE OR REPLACE FUNCTION join_waitlist(p_email TEXT, p_source TEXT DEFAULT 'landing')
RETURNS TABLE (inserted BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public   -- H-13
AS $$
DECLARE
  v_email  TEXT;
  v_source TEXT;
  v_recent INT;
BEGIN
  v_email  := lower(trim(p_email));
  v_source := COALESCE(NULLIF(trim(p_source), ''), 'landing');

  -- Shape validation (defence-in-depth; the route validates too).
  IF v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
     OR length(v_email) > 320 THEN
    RAISE EXCEPTION 'invalid_email';
  END IF;

  -- Crude global flood guard. The real abuse limiter is the platform edge
  -- (Vercel / Cloudflare); this just caps a runaway burst without storing
  -- any IP / PII beyond the email itself.
  SELECT count(*) INTO v_recent
  FROM waitlist_signups
  WHERE created_at > now() - interval '10 seconds';
  IF v_recent > 30 THEN
    RAISE EXCEPTION 'rate_limited';
  END IF;

  INSERT INTO waitlist_signups (email, source)
  VALUES (v_email, v_source)
  ON CONFLICT (lower(email)) DO NOTHING;

  RETURN QUERY SELECT FOUND;
END;
$$;

GRANT EXECUTE ON FUNCTION join_waitlist(TEXT, TEXT) TO anon, authenticated, service_role;

-- Phased CTA switch.
INSERT INTO platform_config (key, value, description, value_type) VALUES
  (
    'marketing.signup_mode',
    '"waitlist"',
    'Phase 13.1 — landing-page CTA mode: "waitlist" (collect emails via /api/waitlist) or "open" ("Get started" → /signup). Flip with a single UPDATE; no deploy.',
    'string'
  )
ON CONFLICT (key) DO NOTHING;
