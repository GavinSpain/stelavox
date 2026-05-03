-- supabase/seed.sql
-- Phase 1 seed data.  Safe to re-run: every INSERT uses ON CONFLICT DO NOTHING.
-- Apply: supabase db execute --file supabase/seed.sql
-- Verify: Studio at http://127.0.0.1:54333

-- ============================================================
-- Layer-stack templates
-- Build Checklist T-3.17 | Spec: Build Checklist §3.4
--
-- Three system templates: Novel, Short Story, Series.
-- is_template = TRUE, organisation_id = NULL, document_id = NULL.
-- Fixed UUIDs allow ON CONFLICT (id) DO NOTHING without a unique
-- constraint on (document_type, is_template, organisation_id).
-- The layers column stores a JSONB array (migration default '[]').
-- ============================================================

INSERT INTO layer_stacks (id, name, document_type, is_template, organisation_id, document_id, layers)
VALUES
  (
    '00000000-0000-0000-0000-000000000001',
    'Novel',
    'novel',
    TRUE,
    NULL,
    NULL,
    '[
      {"index": 0, "node_type": "book",    "label": "Book",    "description": "Top-level container"},
      {"index": 1, "node_type": "act",     "label": "Act",     "description": "Major structural division"},
      {"index": 2, "node_type": "chapter", "label": "Chapter", "description": "Standard chapter"},
      {"index": 3, "node_type": "scene",   "label": "Scene",   "description": "A single dramatic unit"},
      {"index": 4, "node_type": "beat",    "label": "Beat",    "description": "Atomic prose unit"}
    ]'::jsonb
  ),
  (
    '00000000-0000-0000-0000-000000000002',
    'Short Story',
    'short_story',
    TRUE,
    NULL,
    NULL,
    '[
      {"index": 0, "node_type": "story", "label": "Story", "description": "Top-level container"},
      {"index": 1, "node_type": "scene", "label": "Scene", "description": "A single dramatic unit"},
      {"index": 2, "node_type": "beat",  "label": "Beat",  "description": "Atomic prose unit"}
    ]'::jsonb
  ),
  (
    '00000000-0000-0000-0000-000000000003',
    'Series',
    'series',
    TRUE,
    NULL,
    NULL,
    '[
      {"index": 0, "node_type": "series",  "label": "Series",  "description": "Top-level container"},
      {"index": 1, "node_type": "book",    "label": "Book",    "description": "Major structural division"},
      {"index": 2, "node_type": "act",     "label": "Act",     "description": "Act within a book"},
      {"index": 3, "node_type": "chapter", "label": "Chapter", "description": "Standard chapter"},
      {"index": 4, "node_type": "scene",   "label": "Scene",   "description": "A single dramatic unit"},
      {"index": 5, "node_type": "beat",    "label": "Beat",    "description": "Atomic prose unit"}
    ]'::jsonb
  )
ON CONFLICT (id) DO NOTHING;


-- ============================================================
-- Platform configuration
-- Build Checklist T-3.18 | Spec: Technical Architecture v1.3 §3.7.4 and §3.7.5
--
-- 41 keys — the complete canonical key list.
-- String values are stored as JSON strings (double-quoted inside the SQL string).
-- Re-running is safe: ON CONFLICT (key) DO NOTHING never overwrites admin edits.
-- ============================================================

INSERT INTO platform_config (key, value, description, value_type) VALUES

  -- Token budgets (per billing period)
  ('token_budget.trial',             '1000000',   'Token budget for trial organisations (full period)',        'integer'),
  ('token_budget.writer',            '1000000',   'Token budget for Writer tier per billing period',          'integer'),
  ('token_budget.author',            '4000000',   'Token budget for Author tier per billing period',          'integer'),
  ('token_budget.pro',               '16000000',  'Token budget for Pro tier per billing period',             'integer'),

  -- Subscription prices (USD cents — Stripe uses cents)
  ('price.byok_solo.monthly_cents',  '1500',      'BYOK Solo monthly price in USD cents',                    'integer'),
  ('price.byok_team.monthly_cents',  '3500',      'BYOK Team per-seat monthly price in USD cents',           'integer'),
  ('price.writer.monthly_cents',     '2000',      'Writer tier monthly price in USD cents',                  'integer'),
  ('price.author.monthly_cents',     '5000',      'Author tier monthly price in USD cents',                  'integer'),
  ('price.pro.monthly_cents',        '12000',     'Pro tier monthly price in USD cents',                     'integer'),
  ('price.annual_discount_percent',  '20',        'Discount percentage applied to all annual plans',         'integer'),

  -- Billing behaviour
  ('billing.trial_duration_days',          '30', 'Trial period length in days',                                             'integer'),
  ('billing.payment_failure_grace_days',   '7',  'Grace period after payment failure before AI suspension (days)',          'integer'),
  ('billing.invite_token_expiry_hours',    '72', 'Organisation invite token expiry in hours',                               'integer'),

  -- Token budget notifications
  ('budget.warning_threshold_percent', '80', 'Budget % used before in-app warning nudge appears', 'integer'),

  -- Agent operation limits
  ('agent.director_max_tool_iterations',     '20',       'Safety ceiling on Director agentic loop iterations',                  'integer'),
  ('agent.director_session_max_tokens',      '60000',    'Conversation token count triggering rolling summarisation',           'integer'),
  ('agent.node_lock_expiry_minutes',         '5',        'Minutes of inactivity before node lock auto-expires',                'integer'),
  ('agent.node_lock_max_force_release_role', '"owner"',  'Minimum role required to force-release another user''s lock',        'string'),
  ('agent.scheduler_max_deferrals',          '3',        'Times a scheduled job defers for locked nodes before failing',       'integer'),
  ('agent.scheduler_deferral_minutes',       '15',       'Minutes a scheduled job is deferred when nodes are locked',          'integer'),

  -- Model selections (per operation type)
  ('model.synthesise',          '"claude-opus-4-6"',          'Model for prose synthesis operations',         'string'),
  ('model.expand',              '"claude-sonnet-4-6"',        'Model for expand operations',                  'string'),
  ('model.refine',              '"claude-sonnet-4-6"',        'Model for refine operations',                  'string'),
  ('model.generate_context',    '"claude-sonnet-4-6"',        'Model for context generation',                 'string'),
  ('model.critique',            '"claude-sonnet-4-6"',        'Model for critique operations',                'string'),
  ('model.document_operation',  '"claude-sonnet-4-6"',        'Model for document-level operations',          'string'),
  ('model.byok_key_validation', '"claude-haiku-4-5-20251001"','Model for BYOK key validation test call',      'string'),

  -- Export defaults
  ('export.docx_default_font',              '"Georgia"',         'Default body font for DOCX export',            'string'),
  ('export.docx_default_font_size_pt',      '12',                'Default body font size in points',             'integer'),
  ('export.docx_default_line_spacing',      '1.5',               'Default line spacing multiplier',              'number'),
  ('export.kdp_trim_width_inches',          '6.0',               'KDP trim width in inches',                     'number'),
  ('export.kdp_trim_height_inches',         '9.0',               'KDP trim height in inches',                    'number'),
  ('export.kdp_margin_top_inches',          '0.5',               'KDP top/bottom margin in inches',              'number'),
  ('export.kdp_margin_outer_inches',        '0.5',               'KDP outer margin in inches',                   'number'),
  ('export.kdp_margin_gutter_inches',       '0.75',              'KDP gutter margin in inches',                  'number'),
  ('export.kdp_font',                       '"Times New Roman"', 'KDP body font',                                'string'),
  ('export.kdp_font_size_pt',               '12',                'KDP body font size in points',                 'integer'),
  ('export.kdp_first_line_indent_inches',   '0.3',               'KDP first-line paragraph indent in inches',    'number'),

  -- Node and attachment limits
  ('limits.attachment_max_file_size_bytes', '52428800', 'Maximum attachment file size in bytes (50 MB)', 'integer'),
  ('limits.attachment_max_per_node',        '20',       'Maximum number of attachments per node',        'integer'),

  -- Mobile
  ('mobile.sync_queue_purge_days', '7', 'Days before uploaded local sync queue records are purged', 'integer')

ON CONFLICT (key) DO NOTHING;
