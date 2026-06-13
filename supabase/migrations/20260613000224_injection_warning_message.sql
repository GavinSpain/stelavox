-- M-224 — injection-scanner security-warning message (Phase 9.E, DR-050).
--
-- When the injection scanner flags content as a possible prompt-injection
-- attempt, the agent/Director request is blocked (422 injection_blocked
-- foreground, or agent_jobs.error_message='injection_blocked:<field>'
-- for background jobs). Until now the author saw a raw error code.
--
-- DR-050 surfaces a clear security warning explaining WHY the content was
-- rejected + the author's two options. Per the author lock: "Security is
-- paramount and we can not compromise on security." There is NO override
-- — the message tells the author they can rewrite the flagged text or
-- write that prose manually (manual edits are never scanned).
--
-- Stored in platform_config (like the failure.* class messages from
-- M-147) so the wording is admin-tunable without a deploy. Read via the
-- failure-message bundle (getFailureMessageBundle) so the client picks
-- it up through the same /api/failure-messages endpoint.

INSERT INTO platform_config (key, value, description, value_type) VALUES
  ('failure.injection_blocked_message',
   '"The security scanner flagged this text as a possible prompt-injection attempt, so the AI request was blocked. This protects the system from instructions hidden inside content. You can either rewrite the flagged passage so it does not read like an instruction to the AI, or write this prose yourself — manual edits are never scanned. For security reasons this check cannot be overridden."',
   'Security warning shown when the injection scanner blocks an agent/Director request (DR-050). NO override is offered by design — the author rewrites the flagged text or writes manually.',
   'string')
ON CONFLICT (key) DO NOTHING;
