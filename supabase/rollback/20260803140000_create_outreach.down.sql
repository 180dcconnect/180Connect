-- Rollback for 20260803140000_create_outreach.sql
--
-- Drops the outreach tables and the send_status enum. This discards every draft and
-- every record of what was actually sent. Sent messages exist nowhere else in the
-- schema — Gmail holds the delivered copy, but the link between a message, its client
-- and its contact lives only here, and the contact log (F159) cannot be rebuilt from
-- the mailbox alone. Export before running this anywhere a CAM has sent outreach.
--
-- ai_generations drops first: it FKs to outreach_messages.

drop table if exists public.ai_generations;
drop table if exists public.outreach_messages;

drop type if exists public.send_status;
