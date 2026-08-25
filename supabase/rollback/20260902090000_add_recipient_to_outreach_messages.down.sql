-- Rollback of 20260902090000_add_recipient_to_outreach_messages.sql
alter table public.outreach_messages
  drop column if exists sent_to_email;
