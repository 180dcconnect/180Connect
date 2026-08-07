-- Rollback for 20260804200000_create_outreach_events.sql
--
-- Drops the delivery, reply and outcome tables and their four enums.
--
-- REPLY_EVENTS is the serious loss here. A reply's text lives only in this table once
-- the webhook has processed it, and OUTCOMES is the ground truth the scoring model
-- trains against — neither can be reconstructed from anywhere else in the schema.
-- Export both before running this against any environment that has received real
-- outreach.
--
-- Order follows the foreign keys: outcomes and reply_events reference
-- outreach_messages, which this migration does not own, so only these three drop.

drop table if exists public.outcomes;
drop table if exists public.reply_events;
drop table if exists public.send_events;

drop type if exists public.outcome_type;
drop type if exists public.reply_intent;
drop type if exists public.reply_sentiment;
drop type if exists public.send_event_type;
