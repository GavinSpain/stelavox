-- M-172 — word_count_actual maintained automatically from prose.
--
-- Background. nodes.word_count_actual was defined in M-004 but no trigger,
-- RPC, or write path ever maintained it. Seed scripts populated it on
-- insert; every subsequent prose update left it stale or NULL. The
-- user-facing <WordCount> component bypasses the column entirely
-- (counts from live editor text), so the staleness was invisible until
-- 2026-05-18 testing surfaced the Director receiving NULL word counts
-- and faithfully reporting "actuals haven't been calculated yet" on
-- 37 beats that all had prose. This is a derived-field-staleness
-- bug — candidate hazard H-26 in TA §5.
--
-- Fix: a BEFORE INSERT OR UPDATE trigger on nodes that recomputes
-- word_count_actual from the prose JSONB via a SQL helper function.
-- Backfill existing rows. Every write path is then covered for free
-- (PATCH /api/nodes/[id], accept_agent_job, direct UPDATEs, future
-- import paths).
--
-- See also H-06 (Tiptap text extraction before LLM prompt) — same
-- shape of extraction logic, now mirrored in PL/pgSQL.

-- ---------------------------------------------------------------------------
-- 1. SQL helper: tiptap_word_count(doc JSONB) → INTEGER
-- ---------------------------------------------------------------------------
--
-- Walks Tiptap JSON {type:"doc", content:[{type:"paragraph", content:[
-- {type:"text", text:"..."}]}]} collecting all "text" leaf values, then
-- counts whitespace-separated words.
--
-- Edge cases:
--   doc = NULL                  → 0
--   doc = empty Tiptap doc      → 0
--   doc = {} or no content      → 0
--   doc = JSONB string scalar   → counted as plain string (legacy / fixtures)
--   doc = trimmed empty string  → 0
--
-- IMMUTABLE so PostgreSQL can use it in indexes / planning. Pure
-- function — no side effects, no time-dependent reads. SET search_path
-- = public per H-13 discipline.

CREATE OR REPLACE FUNCTION public.tiptap_word_count(doc JSONB)
RETURNS INTEGER
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  text_concat TEXT;
BEGIN
  IF doc IS NULL THEN
    RETURN 0;
  END IF;

  -- Plain string scalar — legacy data or test fixtures may store this.
  IF jsonb_typeof(doc) = 'string' THEN
    text_concat := doc #>> '{}';
  ELSE
    -- Walk the Tiptap tree, collecting every text-node leaf.
    WITH RECURSIVE walk(node) AS (
      SELECT doc
      UNION ALL
      SELECT child
      FROM walk
      CROSS JOIN LATERAL jsonb_array_elements(walk.node->'content') AS child
      WHERE jsonb_typeof(walk.node->'content') = 'array'
    )
    SELECT string_agg(node->>'text', ' ')
    INTO text_concat
    FROM walk
    WHERE node->>'type' = 'text' AND (node->>'text') IS NOT NULL;
  END IF;

  -- regex-trim ALL whitespace (newlines, tabs, NBSP, ...) — PostgreSQL's
  -- default trim() strips only spaces, which would leave \n\t-only
  -- text counting as 2 tokens after the regexp_split. Caught by the
  -- "whitespace-only text" unit test in tests/unit/m172-word-count-trigger.
  text_concat := regexp_replace(text_concat, '^\s+|\s+$', '', 'g');

  IF text_concat IS NULL OR length(text_concat) = 0 THEN
    RETURN 0;
  END IF;

  RETURN array_length(
    regexp_split_to_array(text_concat, '\s+'),
    1
  );
END;
$$;

COMMENT ON FUNCTION public.tiptap_word_count(JSONB) IS
  'Count words in a Tiptap-shaped JSONB document. Walks content tree, joins all type=text leaves, splits on whitespace. Returns 0 for NULL, empty, or whitespace-only input. Used by the nodes word_count_actual trigger and any future consumers.';

-- ---------------------------------------------------------------------------
-- 2. Trigger: recompute word_count_actual on prose change
-- ---------------------------------------------------------------------------
--
-- Fires BEFORE INSERT OR UPDATE on nodes. Skips re-computation if prose
-- didn't change (saves work on the common case of summary-only,
-- status-only, name-only updates).

CREATE OR REPLACE FUNCTION public.compute_node_word_count_actual()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.prose IS DISTINCT FROM OLD.prose THEN
    NEW.word_count_actual := public.tiptap_word_count(NEW.prose);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_compute_word_count_actual ON public.nodes;
CREATE TRIGGER trg_compute_word_count_actual
  BEFORE INSERT OR UPDATE ON public.nodes
  FOR EACH ROW
  EXECUTE FUNCTION public.compute_node_word_count_actual();

-- ---------------------------------------------------------------------------
-- 3. Backfill existing rows
-- ---------------------------------------------------------------------------
--
-- The trigger fires on this UPDATE but short-circuits because prose
-- isn't changing — so we set word_count_actual explicitly. One pass
-- covers every node in the database, including the 37 stale rows that
-- surfaced this bug. Idempotent.

UPDATE public.nodes
SET word_count_actual = public.tiptap_word_count(prose);

-- ---------------------------------------------------------------------------
-- 4. Sanity check
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_null_count INTEGER;
  v_prose_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_null_count FROM public.nodes WHERE word_count_actual IS NULL;
  SELECT COUNT(*) INTO v_prose_count FROM public.nodes WHERE prose IS NOT NULL;

  IF v_null_count > 0 THEN
    RAISE EXCEPTION 'M-172: backfill incomplete — % rows have NULL word_count_actual after trigger install', v_null_count;
  END IF;

  RAISE NOTICE 'M-172: backfill complete — % rows with prose, all word_count_actual values now non-NULL', v_prose_count;
END $$;
