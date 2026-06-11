-- V1.x-F.2 — per-failure-class user-facing message templates +
-- thresholds, stored in platform_config (decision D2 locked at V1.x-F
-- wireframe kickoff: 5 string templates with simple {var} interpolation
-- don't justify a new table).
--
-- Source: stelavox_v1x_f_build_checklist_v1_1.md §2 M-147 +
--         docs/wireframes/wireframe_failure_mode_ux_v1.html §05 D1-D5.
--
-- Keys:
--   failure.class_a_message            — Class A retry toast body
--   failure.class_c_message            — Class C capacity toast body
--   failure.class_c_min_pause_seconds  — Sub-threshold Class C events
--                                        stay silent (D2 locked: 15s)
--   failure.class_d_message_template   — Class D banner body; {reason}
--                                        token interpolates
--   failure.class_e_message            — Class E banner body; {job_id}
--                                        token interpolates
--   failure.class_e_admin_contact      — mailto: target for Class E
--                                        (D3 locked: support@stelavox.io)
--
-- Interpolation tokens supported: {job_id}, {failure_class}, {reason}.
-- Simple replaceAll — no full templating engine. lib/ui/failureMessages.ts
-- performs the substitution at message-build time.

INSERT INTO platform_config (key, value, description, value_type) VALUES
  (
    'failure.class_a_message',
    '"Provider returned a transient error · attempt {attempt} of {max_attempts}"',
    'V1.x-F — Class A retry toast body. Surfaces on 2nd retry onward (D1: silent on 1st). Tokens: {attempt}, {max_attempts}.',
    'string'
  ),
  (
    'failure.class_c_message',
    '"Job paused for ~{pause_seconds}s while the system catches up · no action needed"',
    'V1.x-F — Class C capacity toast body. Surfaces only when pause_seconds >= failure.class_c_min_pause_seconds. Tokens: {pause_seconds}.',
    'string'
  ),
  (
    'failure.class_c_min_pause_seconds',
    '15',
    'V1.x-F — Minimum back-off duration (seconds) before Class C toast surfaces. D2 locked: 15. Sub-threshold pauses are dispatcher-internal and stay silent.',
    'integer'
  ),
  (
    'failure.class_d_message_template',
    '"The {failure_class} step for ''{node_name}'' was rejected: {reason}. The job is marked failed; the node is unchanged."',
    'V1.x-F — Class D validation banner body. Tokens: {failure_class}, {node_name}, {reason}.',
    'string'
  ),
  (
    'failure.class_e_message',
    '"Job {job_id} failed with a hard system error. This isn''t a normal failure mode — the team has been notified, and we''d appreciate any details you can share."',
    'V1.x-F — Class E hard-system banner body. Tokens: {job_id}.',
    'string'
  ),
  (
    'failure.class_e_admin_contact',
    '"support@stelavox.io"',
    'V1.x-F — Class E mailto: target. D3 locked at wireframe kickoff: mailto: for V1; in-app feedback form is V2.',
    'string'
  )
ON CONFLICT (key) DO NOTHING;
