-- Migration: create_outreach
-- Sequence step 11.0 (Data Model tab 11). Runs after create_org_children (4.0) — needs
--   ORGANISATIONS, CONTACTS and USERS.
-- Stories: F114 Generate Draft, F119 Save Email Draft, F120 Discard Draft,
--   F123 Send Email, F126 Schedule Email, F130 Delivery Status.
--   Built now for F257 AC8 ("linked to the correct client and email record") and the
--   drafts half of AC4 — neither could be verified while there was no email record.
-- Spec: docs/rls-permission-matrix.md §3.4
--
-- STEP 10.0 IS SKIPPED FOR NOW: EMAIL_PERFORMANCE_LIBRARY FKs to OUTREACH_MESSAGES and
--   tab 11 says it may be created after step 11 instead. Nothing here depends on it.
--
-- AGENT_RUNS DOES NOT EXIST YET (step 9.0), so agent_run_id is a plain uuid with no
--   foreign key. It is documented on the column and must gain the FK when step 9.0
--   lands — a nullable uuid that nothing enforces is exactly the sort of column that
--   quietly fills with orphans. Adding the constraint later is a one-line migration;
--   forgetting it is a data-quality problem nobody sees.
--
-- WHAT F257 NEEDS FROM THIS TABLE:
--   Drafts hang off organisation_id, not off the owner, so a handover moves them with
--   the client and the incoming CAM inherits the saved work. sent_by_user_id is *not*
--   rewritten by a reassignment: who sent an email is a fact about the email. Same rule
--   as note authorship (matrix §3.11).
--
-- Schema change approval record (SOP §7):
--   Change        | Add OUTREACH_MESSAGES, AI_GENERATIONS + enum send_status (step 11.0)
--   Reason        | Draft/send records; F257 AC8 and the drafts half of AC4.
--   Compatibility | New tables. Nothing existing reads or writes them.
--   Data migration| None.
--   Security      | RLS on, policies in this migration. The F018 contact-permission rule
--                 | is the INSERT policy on OUTREACH_MESSAGES. A sent message is
--                 | immutable. AI_GENERATIONS takes no end-user write.
--   Documentation | Already in Data Model tab 07; no spreadsheet change needed.
--                 | Approved by Bashir (Project Leader), 3 Aug 2026.
--
-- Reversibility: paired rollback in ../rollback/20260804190000_create_outreach.down.sql

create type public.send_status as enum ('draft', 'scheduled', 'sent', 'failed');

create table public.outreach_messages (
  id                 uuid primary key default gen_random_uuid(),
  organisation_id    uuid not null references public.organisations (id) on delete cascade,
  -- The contact may be removed while the record of writing to them must remain.
  contact_id         uuid references public.contacts (id) on delete set null,
  -- SET NULL for the same reason authorship survives elsewhere: deleting a departed
  -- CAM's account must not delete the outreach history they built.
  sent_by_user_id    uuid references public.users (id) on delete set null,
  subject            text not null,
  body               text not null,
  send_status        public.send_status not null default 'draft',
  scheduled_at       timestamptz,
  sent_at            timestamptz,
  -- No FK yet — see the header. References AGENT_RUNS once step 9.0 lands.
  agent_run_id       uuid,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  -- Tab 07: "null until sent". Status and timestamp cannot disagree, or F130's delivery
  -- state and the timeline can each be right about a different answer.
  constraint outreach_messages_sent_at_matches_status
    check ((send_status = 'sent') = (sent_at is not null)),
  -- A scheduled message without a time would never be picked up by the sender.
  constraint outreach_messages_scheduled_at_present
    check (send_status <> 'scheduled' or scheduled_at is not null)
);

comment on table public.outreach_messages is
  'Draft and sent outreach emails (Data Model tab 07). Hangs off organisation_id and '
  'carries no owner column, so a handover moves saved drafts with the client (F257 AC4). '
  'sent_by_user_id is never rewritten by a reassignment — who sent an email is a fact '
  'about the email.';
comment on column public.outreach_messages.agent_run_id is
  'The VOICE AGENT_RUNS record that generated the draft. NOT YET A FOREIGN KEY: '
  'AGENT_RUNS arrives in sequence step 9.0, and the constraint must be added then.';
comment on column public.outreach_messages.sent_at is
  'Set by the Gmail send path only. The check constraint keeps it in step with '
  'send_status so F130 cannot report a state the timestamp contradicts.';

create index outreach_messages_organisation_idx
  on public.outreach_messages (organisation_id, created_at desc);
create index outreach_messages_sender_idx on public.outreach_messages (sent_by_user_id);
-- The scheduler sweeps for due messages; the pipeline view filters by state.
create index outreach_messages_due_idx
  on public.outreach_messages (scheduled_at) where send_status = 'scheduled';

create trigger outreach_messages_set_updated_at
  before update on public.outreach_messages
  for each row execute function public.set_updated_at();


create table public.ai_generations (
  id                  uuid primary key default gen_random_uuid(),
  -- CASCADE: the generation record describes one message and is meaningless without it.
  outreach_message_id uuid not null references public.outreach_messages (id) on delete cascade,
  generated_subject   text,
  generated_body      text,
  cam_edited          boolean not null default false,
  edit_distance       integer,
  created_at          timestamptz not null default now(),

  constraint ai_generations_edit_distance_non_negative
    check (edit_distance is null or edit_distance >= 0)
);

comment on table public.ai_generations is
  'What the model produced before the CAM edited it (Data Model tab 07). Written by the '
  'generation worker through service_role; no end-user role may write it, or the '
  '"how much did the CAM change" measure could be edited to say anything.';

create index ai_generations_message_idx on public.ai_generations (outreach_message_id);


-- ---------------------------------------------------------------------------
-- Security — REVOKE before GRANT (matrix §2.1), then §3.4
-- ---------------------------------------------------------------------------
revoke all on public.outreach_messages from anon, authenticated;
revoke all on public.ai_generations     from anon, authenticated;

alter table public.outreach_messages enable row level security;
alter table public.ai_generations     enable row level security;

-- Read is shared: relationship history belongs to the team (F019), and F257 depends on
-- the incoming CAM being able to read what was already sent before they take over.
grant select on public.outreach_messages to authenticated;
grant select on public.ai_generations     to authenticated;

create policy outreach_messages_select_active on public.outreach_messages
  for select to authenticated using (app.is_active_user());
create policy ai_generations_select_active on public.ai_generations
  for select to authenticated using (app.is_active_user());

grant insert, update, delete on public.outreach_messages to authenticated;

-- THE F018 CONTACT PERMISSION RULE, in the database rather than in app code.
-- "Send to an organisation owned by another CAM: Admin yes, CAM no." A CAM may write to
-- a client they own or one nobody owns, and only ever as themselves — the
-- sent_by_user_id predicate is what stops a message being attributed to someone else.
create policy outreach_messages_insert_admin on public.outreach_messages
  for insert to authenticated
  with check (app.is_active_user() and app.is_admin());

create policy outreach_messages_insert_cam on public.outreach_messages
  for insert to authenticated
  with check (
    app.is_active_user()
    and app.is_cam()
    and sent_by_user_id = auth.uid()
    and app.can_contact_organisation(organisation_id)
  );

-- A SENT MESSAGE IS IMMUTABLE. The USING clause pins both policies to drafts, so no
-- role — admin included — can edit the text of something already delivered. The record
-- of what was actually sent is the point of the table; if it can be rewritten
-- afterwards, the contact log (F159) and every reply thread built on it become
-- unreliable. Correcting a sent message means sending another one.
create policy outreach_messages_update_admin on public.outreach_messages
  for update to authenticated
  using (app.is_active_user() and app.is_admin() and send_status = 'draft')
  with check (app.is_active_user() and app.is_admin());

create policy outreach_messages_update_own_draft on public.outreach_messages
  for update to authenticated
  using (app.is_active_user()
         and app.is_cam()
         and coalesce(sent_by_user_id = auth.uid(), false)
         and send_status = 'draft')
  with check (app.is_active_user()
              and app.is_cam()
              and coalesce(sent_by_user_id = auth.uid(), false));

-- F120 Discard Draft. Same drafts-only restriction, same reason.
create policy outreach_messages_delete_admin on public.outreach_messages
  for delete to authenticated
  using (app.is_active_user() and app.is_admin() and send_status = 'draft');

create policy outreach_messages_delete_own_draft on public.outreach_messages
  for delete to authenticated
  using (app.is_active_user()
         and app.is_cam()
         and coalesce(sent_by_user_id = auth.uid(), false)
         and send_status = 'draft');

-- AI_GENERATIONS: service-role write only (§3.4). An admin may remove a bad record.
grant delete on public.ai_generations to authenticated;

create policy ai_generations_delete_admin on public.ai_generations
  for delete to authenticated
  using (app.is_active_user() and app.is_admin());
