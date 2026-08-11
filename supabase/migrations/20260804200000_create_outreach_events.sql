-- Migration: create_outreach_events
-- Sequence step 12.0 (Data Model tab 11). Runs after create_outreach (11.0).
-- Stories: F130 Delivery Status, F131/F132 Reply Capture, F133 Reply Notification,
--   F159 Contact Log, F157 Outcome Logging.
--   Built now for F257 AC4: "replies remain attached to the client" was the last part
--   of that criterion with no table behind it.
-- Spec: docs/rls-permission-matrix.md §3.4
--
-- WHY THESE THREE HOLD NO END-USER WRITE:
--   SEND_EVENTS and REPLY_EVENTS are what actually happened, reported by Gmail. They
--   are evidence, and evidence a user can write is not evidence. Both are inserted by
--   the webhook through service_role and carry no INSERT, UPDATE or DELETE policy for
--   any role — not even an admin. OUTCOMES is different: it is a human judgement about
--   how an engagement went, so a CAM records their own and an admin can correct any.
--
-- REPLY_EVENTS CARRIES organisation_id DIRECTLY, not only through the message it
--   answers. Tab 07 specifies it that way, and it is load-bearing for F257: a reply
--   stays attached to the client by its own column, so it survives a handover even if
--   the message it replies to is ever re-parented or removed.
--
-- STILL OPEN, AND NOT CLOSED HERE: create_organisations omitted
--   last_reply_sentiment and last_reply_intent because their enum values were defined
--   nowhere. This migration defines both value sets, so that deviation can now be
--   closed — but the comment there defers it to the reply-classification owner
--   (raised on F041 #41), so it stays their call rather than a side effect of this.
--
-- Schema change approval record (SOP §7):
--   Change        | Add SEND_EVENTS, REPLY_EVENTS, OUTCOMES + 4 enums (step 12.0)
--   Reason        | Delivery, replies and ground truth; F257 AC4 replies.
--   Compatibility | New tables. Nothing existing reads or writes them.
--   Data migration| None.
--   Security      | RLS on, policies in this migration. Event tables are append-only
--                 | to everyone except service_role — no write policy exists at all.
--   Documentation | Already in Data Model tab 07; no spreadsheet change needed.
--                 | Approved by Bashir (Project Leader), 3 Aug 2026.
--
-- Reversibility: paired rollback in ../rollback/20260804200000_create_outreach_events.down.sql

create type public.send_event_type as enum ('sent', 'delivered', 'bounced', 'opened');
create type public.reply_sentiment as enum ('positive', 'neutral', 'negative');
create type public.reply_intent    as enum ('interested', 'not_interested', 'more_info', 'referral');
create type public.outcome_type    as enum ('converted', 'no_response', 'rejected', 'follow_up', 'referral');


create table public.send_events (
  id                  uuid primary key default gen_random_uuid(),
  outreach_message_id uuid not null references public.outreach_messages (id) on delete cascade,
  event_type          public.send_event_type not null,
  occurred_at         timestamptz not null,
  -- Whatever Gmail returned, unmodified. Kept raw so a delivery dispute can be settled
  -- against the provider's own words rather than our reading of them.
  metadata            jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now()
);

comment on table public.send_events is
  'Delivery events reported by Gmail (Data Model tab 07). Append-only: written by the '
  'webhook through service_role, with no write policy for any end-user role.';

create index send_events_message_idx on public.send_events (outreach_message_id, occurred_at desc);
-- The same event can arrive twice — webhooks retry. One row per message per event per
-- instant is the natural key, and this makes a replayed delivery a no-op.
create unique index send_events_dedup_idx
  on public.send_events (outreach_message_id, event_type, occurred_at);


create table public.reply_events (
  id                  uuid primary key default gen_random_uuid(),
  -- SET NULL rather than CASCADE: a reply is a real thing that happened and must not
  -- vanish because the draft it answers was tidied away.
  outreach_message_id uuid references public.outreach_messages (id) on delete set null,
  -- The client link that makes a reply survive independently — see the header.
  organisation_id     uuid not null references public.organisations (id) on delete cascade,
  contact_id          uuid references public.contacts (id) on delete set null,
  reply_body          text not null,
  sentiment           public.reply_sentiment,
  intent              public.reply_intent,
  received_at         timestamptz not null,
  -- Null until the classifier has run; the two classification columns are null with it.
  processed_at        timestamptz,
  created_at          timestamptz not null default now(),

  constraint reply_events_classified_after_processing
    check (processed_at is not null or (sentiment is null and intent is null))
);

comment on table public.reply_events is
  'Replies received from contacts (Data Model tab 07). Carries organisation_id directly '
  'so it stays attached to the client through a handover (F257 AC4), independently of '
  'the message it answers.';
comment on column public.reply_events.processed_at is
  'When sentiment/intent analysis finished. The check constraint stops a row claiming a '
  'classification it never ran.';

create index reply_events_organisation_idx on public.reply_events (organisation_id, received_at desc);
create index reply_events_message_idx on public.reply_events (outreach_message_id);
-- F133 notifies on unprocessed replies; this is the queue it sweeps.
create index reply_events_unprocessed_idx on public.reply_events (received_at)
  where processed_at is null;


create table public.outcomes (
  id                  uuid primary key default gen_random_uuid(),
  organisation_id     uuid not null references public.organisations (id) on delete cascade,
  outreach_message_id uuid references public.outreach_messages (id) on delete set null,
  outcome_type        public.outcome_type not null,
  notes               text,
  -- Who judged it. SET NULL so the outcome outlives the account, like every other
  -- attribution in this schema.
  recorded_by_user_id uuid references public.users (id) on delete set null,
  created_at          timestamptz not null default now()
);

comment on table public.outcomes is
  'Ground truth for the scoring model: how an engagement actually went (Data Model tab '
  '07). Unlike the event tables this is a human judgement, so a CAM records their own '
  'and an admin can correct any.';

create index outcomes_organisation_idx on public.outcomes (organisation_id, created_at desc);
create index outcomes_type_idx on public.outcomes (outcome_type);


-- ---------------------------------------------------------------------------
-- Security — REVOKE before GRANT (matrix §2.1), then §3.4
-- ---------------------------------------------------------------------------
revoke all on public.send_events  from anon, authenticated;
revoke all on public.reply_events from anon, authenticated;
revoke all on public.outcomes     from anon, authenticated;

alter table public.send_events  enable row level security;
alter table public.reply_events enable row level security;
alter table public.outcomes     enable row level security;

-- Shared read (F019), and the reason F257's incoming CAM can see what was said before
-- they arrived.
grant select on public.send_events  to authenticated;
grant select on public.reply_events to authenticated;
grant select on public.outcomes     to authenticated;

create policy send_events_select_active on public.send_events
  for select to authenticated using (app.is_active_user());
create policy reply_events_select_active on public.reply_events
  for select to authenticated using (app.is_active_user());
create policy outcomes_select_active on public.outcomes
  for select to authenticated using (app.is_active_user());

-- SEND_EVENTS and REPLY_EVENTS get NO write grant and NO write policy, for anyone.
-- Append-only by omission, exactly as audit_log is. service_role bypasses RLS and is
-- the only writer. Deliberately not even an admin delete: a bounced delivery or an
-- unwelcome reply is precisely the record someone would want removed.

grant insert, update, delete on public.outcomes to authenticated;

create policy outcomes_insert_admin on public.outcomes
  for insert to authenticated
  with check (app.is_active_user() and app.is_admin());

create policy outcomes_insert_cam on public.outcomes
  for insert to authenticated
  with check (app.is_active_user()
              and app.is_cam()
              and recorded_by_user_id = auth.uid());

create policy outcomes_update_admin on public.outcomes
  for update to authenticated
  using (app.is_active_user() and app.is_admin())
  with check (app.is_active_user() and app.is_admin());

create policy outcomes_update_own on public.outcomes
  for update to authenticated
  using (app.is_active_user()
         and app.is_cam()
         and coalesce(recorded_by_user_id = auth.uid(), false))
  with check (app.is_active_user()
              and app.is_cam()
              and coalesce(recorded_by_user_id = auth.uid(), false));

create policy outcomes_delete_admin on public.outcomes
  for delete to authenticated
  using (app.is_active_user() and app.is_admin());
