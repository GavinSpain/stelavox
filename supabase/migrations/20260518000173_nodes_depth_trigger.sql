-- M-173 — nodes.depth maintained automatically from parent_id chain.
--
-- H-26 audit (2026-05-18) found 1/460 drift: probe-fixture beat
-- `__probe_refine_target_scene` stored depth=4 but parent chain gives 3.
-- Root cause: depth was application-maintained — set explicitly in
-- create_document_with_layer_stack on INSERT and updated by move_node's
-- cascade — but ad-hoc INSERTs (like the probe seed) could write any
-- value with no enforcement.
--
-- Fix: BEFORE INSERT OR UPDATE trigger that derives depth from parent_id
-- chain. Idempotent — writing depth = correct-value is a no-op; writing
-- wrong-value gets overridden. Catches every write path (RPC, PATCH,
-- direct INSERT, future imports).
--
-- create_document_with_layer_stack continues to pass depth=0 for root,
-- depth=1 for the layer-1 seed child; trigger validates this against the
-- chain and writes the same value. move_node continues to cascade depth
-- updates to descendants; trigger recomputes during each descendant
-- UPDATE — same result, plus a guarantee that the cascade can never
-- diverge from the chain.

-- ---------------------------------------------------------------------------
-- 1. SQL helper: compute_node_depth(parent_id UUID) → INTEGER
-- ---------------------------------------------------------------------------
--
-- Walks parent_id chain from the candidate parent up to root, returning
-- (1 + length of chain). Root nodes have parent_id IS NULL → returns 0.
-- Safety cap at 20 hops (no real document tree is deeper than ~5;
-- the cap is defensive against cycles, which shouldn't exist by FK
-- constraint but we don't assume).

CREATE OR REPLACE FUNCTION public.compute_node_depth(p_parent_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_depth INTEGER := 0;
  v_cursor UUID := p_parent_id;
  v_safety INTEGER := 20;
BEGIN
  WHILE v_cursor IS NOT NULL AND v_safety > 0 LOOP
    v_depth := v_depth + 1;
    SELECT parent_id INTO v_cursor FROM public.nodes WHERE id = v_cursor;
    v_safety := v_safety - 1;
  END LOOP;
  IF v_safety = 0 THEN
    -- Cycle or runaway chain. Surface as an exception so the caller
    -- knows the data is broken; don't silently return a wrong number.
    RAISE EXCEPTION 'compute_node_depth: parent chain exceeded 20 hops from %', p_parent_id;
  END IF;
  RETURN v_depth;
END;
$$;

COMMENT ON FUNCTION public.compute_node_depth(UUID) IS
  'Compute a node''s depth from its parent_id chain. Root (parent_id IS NULL) = 0; each level adds 1. Used by the nodes depth trigger; safe to call directly. STABLE (deterministic within a query).';

-- ---------------------------------------------------------------------------
-- 2. Trigger: recompute depth on INSERT and on parent_id-touching UPDATEs
-- ---------------------------------------------------------------------------
--
-- Fires BEFORE INSERT OR UPDATE on nodes. The condition `OLD IS DISTINCT
-- FROM NEW` covers parent_id changes; we additionally always recompute on
-- INSERT. Performance: each call walks ≤5 rows for a typical document
-- tree, so the trigger cost is sub-millisecond.

CREATE OR REPLACE FUNCTION public.compute_node_depth_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.parent_id IS DISTINCT FROM OLD.parent_id THEN
    NEW.depth := public.compute_node_depth(NEW.parent_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_compute_node_depth ON public.nodes;
CREATE TRIGGER trg_compute_node_depth
  BEFORE INSERT OR UPDATE ON public.nodes
  FOR EACH ROW
  EXECUTE FUNCTION public.compute_node_depth_trigger();

-- ---------------------------------------------------------------------------
-- 3. Backfill — fixes the one drifted probe-fixture row + verifies
-- ---------------------------------------------------------------------------

UPDATE public.nodes
SET depth = public.compute_node_depth(parent_id)
WHERE depth IS DISTINCT FROM public.compute_node_depth(parent_id);

-- ---------------------------------------------------------------------------
-- 4. Sanity check
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_drift INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_drift
  FROM public.nodes
  WHERE depth IS DISTINCT FROM public.compute_node_depth(parent_id);

  IF v_drift > 0 THEN
    RAISE EXCEPTION 'M-173: % rows still have depth-vs-parent-chain drift after backfill', v_drift;
  END IF;

  RAISE NOTICE 'M-173: depth invariant holds for all % rows', (SELECT COUNT(*) FROM public.nodes);
END $$;
