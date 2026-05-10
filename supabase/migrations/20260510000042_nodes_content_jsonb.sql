-- Migration 042 — summary / prose / notes TEXT → JSONB
-- (round-3 audit B4.5, F-269).
--
-- Pre-fix the application stored Tiptap document JSON as JSON-encoded
-- text via JSON.stringify. F-269: corruption (truncated JSON, partial
-- write) wouldn't be caught at the DB level — extractPlainText's
-- legacy passthrough (F-17) treats malformed JSON as raw plain text,
-- so corrupted rows become "valid" plain-text content.
--
-- Converting to JSONB makes corruption physically impossible at the
-- DB layer: PostgreSQL parses the value at INSERT/UPDATE time and
-- rejects malformed JSON.
--
-- Disposable test data (per user directive 2026-05-10): old data is
-- wipeable, do not block fixes on legacy rows. 693 existing rows have
-- non-JSON content (legacy plain-text from j5-novel fixtures and
-- earlier seeds). Conversion strategy:
--   - Valid JSON → ::jsonb (round-trips cleanly)
--   - NULL / empty → NULL
--   - Plain-text content → wrapped in a Tiptap doc with a single
--     paragraph containing the text. Preserves the content; gives it
--     valid Tiptap structure.
--
-- After this migration, app writers must send JSONB-shaped objects
-- (not JSON-encoded strings) to summary/prose/notes. lib/editor/serialise.ts
-- toStorage / fromStorage, editor-store, API Zod schemas, and the
-- accept_agent_job RPC are updated in this same commit.

-- Helper: test whether a string parses as valid JSON without raising
-- to the caller. Local to this migration; dropped at the end.
CREATE OR REPLACE FUNCTION pg_temp_is_valid_json(t TEXT) RETURNS BOOLEAN
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  PERFORM t::jsonb;
  RETURN TRUE;
EXCEPTION WHEN others THEN
  RETURN FALSE;
END;
$$;

ALTER TABLE nodes
  ALTER COLUMN summary TYPE JSONB USING (
    CASE
      WHEN summary IS NULL OR summary = '' THEN NULL
      WHEN pg_temp_is_valid_json(summary) THEN summary::jsonb
      ELSE jsonb_build_object(
        'type', 'doc',
        'content', jsonb_build_array(
          jsonb_build_object(
            'type', 'paragraph',
            'content', jsonb_build_array(
              jsonb_build_object('type', 'text', 'text', summary)
            )
          )
        )
      )
    END
  ),
  ALTER COLUMN prose TYPE JSONB USING (
    CASE
      WHEN prose IS NULL OR prose = '' THEN NULL
      WHEN pg_temp_is_valid_json(prose) THEN prose::jsonb
      ELSE jsonb_build_object(
        'type', 'doc',
        'content', jsonb_build_array(
          jsonb_build_object(
            'type', 'paragraph',
            'content', jsonb_build_array(
              jsonb_build_object('type', 'text', 'text', prose)
            )
          )
        )
      )
    END
  ),
  ALTER COLUMN notes TYPE JSONB USING (
    CASE
      WHEN notes IS NULL OR notes = '' THEN NULL
      WHEN pg_temp_is_valid_json(notes) THEN notes::jsonb
      ELSE jsonb_build_object(
        'type', 'doc',
        'content', jsonb_build_array(
          jsonb_build_object(
            'type', 'paragraph',
            'content', jsonb_build_array(
              jsonb_build_object('type', 'text', 'text', notes)
            )
          )
        )
      )
    END
  );

-- node_versions stores historical snapshots of summary/prose/notes.
-- Converting to JSONB for consistency with the live nodes table.
ALTER TABLE node_versions
  ALTER COLUMN summary TYPE JSONB USING (
    CASE
      WHEN summary IS NULL OR summary = '' THEN NULL
      WHEN pg_temp_is_valid_json(summary) THEN summary::jsonb
      ELSE jsonb_build_object(
        'type', 'doc',
        'content', jsonb_build_array(
          jsonb_build_object(
            'type', 'paragraph',
            'content', jsonb_build_array(
              jsonb_build_object('type', 'text', 'text', summary)
            )
          )
        )
      )
    END
  ),
  ALTER COLUMN prose TYPE JSONB USING (
    CASE
      WHEN prose IS NULL OR prose = '' THEN NULL
      WHEN pg_temp_is_valid_json(prose) THEN prose::jsonb
      ELSE jsonb_build_object(
        'type', 'doc',
        'content', jsonb_build_array(
          jsonb_build_object(
            'type', 'paragraph',
            'content', jsonb_build_array(
              jsonb_build_object('type', 'text', 'text', prose)
            )
          )
        )
      )
    END
  ),
  ALTER COLUMN notes TYPE JSONB USING (
    CASE
      WHEN notes IS NULL OR notes = '' THEN NULL
      WHEN pg_temp_is_valid_json(notes) THEN notes::jsonb
      ELSE jsonb_build_object(
        'type', 'doc',
        'content', jsonb_build_array(
          jsonb_build_object(
            'type', 'paragraph',
            'content', jsonb_build_array(
              jsonb_build_object('type', 'text', 'text', notes)
            )
          )
        )
      )
    END
  );

DROP FUNCTION pg_temp_is_valid_json(TEXT);

-- The accept_agent_job RPC continues to accept TEXT for the content
-- columns (the route handler still passes pre-stringified Tiptap from
-- the agent job's result fields — those stay TEXT in agent_jobs).
-- Inside the RPC we now cast to JSONB before assigning. CREATE OR
-- REPLACE works because we're not changing the parameter types — only
-- the body. (See lib/director/workflow-executor.ts and the accept
-- route for the upstream behavior.)

CREATE OR REPLACE FUNCTION accept_agent_job(
  p_job_id UUID,
  p_actor_id TEXT,
  p_target_summary TEXT DEFAULT NULL,
  p_target_prose TEXT DEFAULT NULL,
  p_target_notes TEXT DEFAULT NULL,
  p_target_metadata JSONB DEFAULT NULL,
  p_child_nodes JSONB DEFAULT NULL
)
RETURNS TABLE (
  out_node_id UUID,
  out_new_version INTEGER,
  out_child_node_ids UUID[]
)
SECURITY DEFINER SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_job RECORD;
  v_node RECORD;
  v_new_child_ids UUID[] := ARRAY[]::UUID[];
  v_child JSONB;
  v_max_position INTEGER;
  v_new_node_id UUID;
  v_child_node_type TEXT;
  v_layer_stack_id UUID;
BEGIN
  SELECT * INTO v_job FROM agent_jobs WHERE id = p_job_id FOR UPDATE;
  IF v_job IS NULL THEN
    RAISE EXCEPTION 'agent_job_not_found' USING ERRCODE = 'P0001';
  END IF;

  IF v_job.status = 'accepted' THEN
    RETURN QUERY SELECT v_job.node_id, NULL::INTEGER, ARRAY[]::UUID[];
    RETURN;
  END IF;

  IF v_job.status != 'completed' THEN
    RAISE EXCEPTION 'agent_job_already_terminal:%', v_job.status USING ERRCODE = 'P0001';
  END IF;

  IF v_job.node_id IS NULL THEN
    RAISE EXCEPTION 'target_node_not_found' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_node FROM nodes WHERE id = v_job.node_id FOR UPDATE;
  IF v_node IS NULL THEN
    RAISE EXCEPTION 'target_node_not_found' USING ERRCODE = 'P0001';
  END IF;

  IF v_job.target_node_version_at_capture IS NOT NULL
     AND v_node.version != v_job.target_node_version_at_capture THEN
    RAISE EXCEPTION 'target_version_mismatch:%:%',
      v_node.version, v_job.target_node_version_at_capture USING ERRCODE = 'P0001';
  END IF;

  -- Snapshot pre-agent state into node_versions. Both nodes and
  -- node_versions content columns are now JSONB; direct copy works.
  INSERT INTO node_versions (
    node_id, organisation_id, version,
    summary, prose, notes, metadata,
    changed_by, change_reason
  ) VALUES (
    v_node.id, v_node.organisation_id, v_node.version,
    v_node.summary, v_node.prose, v_node.notes, v_node.metadata,
    p_actor_id, 'agent_' || v_job.operation_type
  );

  IF v_job.operation_type IN ('synthesise', 'refine', 'generate_context') THEN
    UPDATE nodes SET
      summary = COALESCE(p_target_summary::JSONB, summary),
      prose = COALESCE(p_target_prose::JSONB, prose),
      notes = COALESCE(p_target_notes::JSONB, notes),
      metadata = CASE
        WHEN p_target_metadata IS NOT NULL
        THEN COALESCE(metadata, '{}'::jsonb) || p_target_metadata
        ELSE metadata
      END
    WHERE id = v_node.id;
  END IF;

  IF v_job.operation_type = 'expand' AND p_child_nodes IS NOT NULL THEN
    SELECT layer_stack_id INTO v_layer_stack_id
    FROM documents WHERE id = v_node.document_id;

    SELECT layers->((v_node.layer_index + 1)::INT)->>'node_type'
    INTO v_child_node_type
    FROM layer_stacks WHERE id = v_layer_stack_id;

    IF v_child_node_type IS NULL THEN
      RAISE EXCEPTION 'no_child_layer' USING ERRCODE = 'P0001';
    END IF;

    SELECT COALESCE(MAX("order"), 0) INTO v_max_position
    FROM nodes WHERE parent_id = v_node.id;

    FOR v_child IN SELECT * FROM jsonb_array_elements(p_child_nodes)
    LOOP
      v_max_position := v_max_position + 1;
      -- v_child->'summary' returns JSONB (the parsed object/string from
      -- the JSONB array element). Use -> not ->> to preserve JSONB.
      INSERT INTO nodes (
        organisation_id, project_id, document_id, parent_id,
        node_category, node_type,
        layer_index, depth, "order",
        name, short_description, summary,
        metadata, word_count_target,
        status, version
      ) VALUES (
        v_node.organisation_id, v_node.project_id, v_node.document_id, v_node.id,
        'structural', v_child_node_type,
        v_node.layer_index + 1, COALESCE(v_node.depth, 0) + 1, v_max_position,
        v_child->>'name',
        v_child->>'short_description',
        v_child->'summary',
        COALESCE(v_child->'metadata', '{}'::jsonb),
        NULLIF((v_child->>'word_count_target')::TEXT, '')::INTEGER,
        'draft', 1
      ) RETURNING id INTO v_new_node_id;
      v_new_child_ids := array_append(v_new_child_ids, v_new_node_id);
    END LOOP;
  END IF;

  UPDATE agent_jobs SET
    status = 'accepted',
    completed_at = NOW()
  WHERE id = p_job_id;

  RETURN QUERY SELECT
    v_node.id,
    (SELECT version FROM nodes WHERE id = v_node.id),
    v_new_child_ids;
END;
$$;
