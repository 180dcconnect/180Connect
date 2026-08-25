-- Rollback for send_reviewed_outreach_safety (F123, PR #458).
-- Reverses 20260901090000_send_reviewed_outreach_safety.sql:
-- drops the two RPCs and the send-claim column. Any in-flight claim is lost with
-- the column; drafts stay exactly as they were (send_status is untouched by this
-- migration, so nothing to restore there).

drop function if exists public.mark_outreach_sent(uuid, text, text);
drop function if exists public.claim_outreach_send(uuid);
drop function if exists public.send_claim_staleness_window();

alter table public.outreach_messages
  drop column if exists send_claimed_at;
