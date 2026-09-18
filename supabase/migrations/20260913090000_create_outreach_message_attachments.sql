-- Migration: create_outreach_message_attachments
-- Story: F217 Attach File to Email (#212).
--
-- SCOPE: F080/F081 (20260823090000/20260824000000) already built the storage
--   half of F217 — a private Supabase Storage bucket, the ATTACHMENTS table,
--   record_attachment, size/type limits. That migration's own header says so
--   explicitly. What's missing is linking a client's existing attachment (or
--   a newly uploaded one) to a specific outreach draft, and enforcing that
--   only that draft's owner/admin may attach or detach while it is still
--   unsent.
--
-- WHY A LINK TABLE, NOT A COLUMN ON ATTACHMENTS: an attachment belongs to a
--   client, not to any one email — the same signed document may legitimately
--   ride along with a follow-up after already going out with the first
--   email. A single outreach_message_id column on attachments would make
--   that reuse impossible and would conflate "this file exists for this
--   client" with "this file is on this draft".
--
-- WHY TWO SECURITY DEFINER RPCS, NOT A GRANT ON THE LINK TABLE: same reason
--   set_outreach_status/record_attachment aren't plain grants — "only this
--   draft's owner or an admin, only while it's still a draft, only for an
--   attachment belonging to the same client" is exactly the kind of
--   cross-row check RLS's per-row `using`/`with check` can express for the
--   owner/status conditions (mirrored below from
--   outreach_messages_update_own_draft) but NOT for "does the attachment's
--   organisation_id match the draft's" without a subquery per policy
--   evaluation — cheaper and clearer as one explicit check in a function.
--
-- COMBINED SIZE CAP: new decision, not in F081. Gmail's real send limit is
--   25MB for the ENCODED message; base64 inflates raw bytes by ~33%, so
--   capping raw attachment bytes at 25MB would produce a message Gmail
--   itself rejects. 18MB raw (~24MB encoded, leaving headroom for headers/
--   boundaries) is the working default — provisional, not signed off, same
--   caveat F081's own limits carry. Mirrored by hand in
--   src/lib/attachments.ts (MAX_COMBINED_ATTACHMENT_SIZE_BYTES) for the
--   client-side fast-path check; this function is the enforcement boundary.
--
-- Spec: docs/rls-permission-matrix.md §3.21 (extends the attachments section)
--
-- Schema change approval record (SOP §7):
--   Change        | New table OUTREACH_MESSAGE_ATTACHMENTS (draft/attachment
--                 | link). New RPCs attach_file_to_draft, detach_file_from_draft.
--   Reason        | F217 AC1/AC2: a CAM must be able to attach an existing or
--                 | newly uploaded file to a draft, and have it actually leave
--                 | with the email.
--   Compatibility | Additive only. No existing table, policy or query changes.
--   Data migration| None.
--   Security      | RLS on: shared SELECT (matches ATTACHMENTS' own read
--                 | policy and how OUTREACH_MESSAGES itself is broadly
--                 | readable — F019). No INSERT/UPDATE/DELETE grant to
--                 | authenticated; both RPCs are SECURITY DEFINER and
--                 | re-check ownership themselves, mirroring
--                 | outreach_messages_update_own_draft exactly.
--   Documentation | Data Model tab 04 (OUTREACH_MESSAGE_ATTACHMENTS) + tab 02
--                 | Data Dictionary — still owed against the spreadsheet,
--                 | same as every table added directly by a migration ahead
--                 | of it.
--
-- Reversibility: paired rollback in
-- ../rollback/20260913090000_create_outreach_message_attachments.down.sql

create table public.outreach_message_attachments (
  outreach_message_id uuid not null references public.outreach_messages (id) on delete cascade,
  attachment_id        uuid not null references public.attachments (id) on delete cascade,
  attached_by           uuid references public.users (id),
  created_at             timestamptz not null default now(),

  primary key (outreach_message_id, attachment_id)
);

comment on table public.outreach_message_attachments is
  'F217: which ATTACHMENTS rows are riding along with which draft. Written '
  'only by attach_file_to_draft/detach_file_from_draft — no direct grant to '
  'authenticated.';

create index outreach_message_attachments_message_idx
  on public.outreach_message_attachments (outreach_message_id);

revoke all on public.outreach_message_attachments from anon, authenticated;
grant select on public.outreach_message_attachments to authenticated;

alter table public.outreach_message_attachments enable row level security;

-- Shared read, same shape as ATTACHMENTS (attachments_select_active) and
-- OUTREACH_MESSAGES itself.
create policy outreach_message_attachments_select_active on public.outreach_message_attachments
  for select to authenticated
  using (app.is_active_user());

-- ---------------------------------------------------------------------------
-- attach_file_to_draft
-- ---------------------------------------------------------------------------

create or replace function public.attach_file_to_draft(
  p_message_id    uuid,
  p_attachment_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor              uuid := (select auth.uid());
  v_message            record;
  v_attachment_org_id  uuid;
  v_current_count      integer;
  v_current_total_size bigint;
  v_new_size           bigint;
begin
  select id, organisation_id, sent_by_user_id, send_status
    into v_message
    from public.outreach_messages
   where id = p_message_id
     for update;

  if v_message.id is null then
    raise exception 'that draft could not be found' using errcode = 'P0002';
  end if;

  -- Mirrors outreach_messages_update_own_draft exactly: admin, or the CAM
  -- who owns this specific draft, and only while it is still unsent.
  if not (app.is_admin() or (app.is_cam() and v_message.sent_by_user_id = v_actor)) then
    raise exception 'only the draft''s owner or an admin may attach a file' using errcode = '42501';
  end if;
  if v_message.send_status <> 'draft' then
    raise exception 'this email is no longer an unsent draft' using errcode = 'P0002';
  end if;

  select organisation_id, size_bytes into v_attachment_org_id, v_new_size
    from public.attachments
   where id = p_attachment_id;

  if v_attachment_org_id is null then
    raise exception 'that attachment could not be found' using errcode = 'P0002';
  end if;
  if v_attachment_org_id <> v_message.organisation_id then
    raise exception 'that attachment belongs to a different client' using errcode = '22023';
  end if;

  if exists (
    select 1 from public.outreach_message_attachments
     where outreach_message_id = p_message_id and attachment_id = p_attachment_id
  ) then
    return; -- already attached — attaching twice is a no-op, not an error.
  end if;

  select count(*), coalesce(sum(a.size_bytes), 0)
    into v_current_count, v_current_total_size
    from public.outreach_message_attachments oma
    join public.attachments a on a.id = oma.attachment_id
   where oma.outreach_message_id = p_message_id;

  if v_current_count >= 10 then
    raise exception 'a draft can have at most 10 attachments' using errcode = '23514';
  end if;
  -- 18MB raw — see migration header for the base64/Gmail-limit reasoning.
  if v_current_total_size + coalesce(v_new_size, 0) > 18874368 then
    raise exception 'these attachments are too large to send together (25MB email limit)' using errcode = '23514';
  end if;

  insert into public.outreach_message_attachments (outreach_message_id, attachment_id, attached_by)
  values (p_message_id, p_attachment_id, v_actor);
end;
$$;

comment on function public.attach_file_to_draft(uuid, uuid) is
  'F217: links an existing ATTACHMENTS row to a draft. Only the draft''s '
  'owner or an admin, only while still a draft, only for an attachment '
  'belonging to the same client. Enforces a 10-file count cap and an 18MB '
  'combined-size cap (see migration header).';

revoke execute on function public.attach_file_to_draft(uuid, uuid) from public, anon;
grant execute on function public.attach_file_to_draft(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- detach_file_from_draft
-- ---------------------------------------------------------------------------

create or replace function public.detach_file_from_draft(
  p_message_id    uuid,
  p_attachment_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor   uuid := (select auth.uid());
  v_message record;
begin
  select id, sent_by_user_id, send_status
    into v_message
    from public.outreach_messages
   where id = p_message_id
     for update;

  if v_message.id is null then
    raise exception 'that draft could not be found' using errcode = 'P0002';
  end if;

  if not (app.is_admin() or (app.is_cam() and v_message.sent_by_user_id = v_actor)) then
    raise exception 'only the draft''s owner or an admin may remove an attachment' using errcode = '42501';
  end if;
  if v_message.send_status <> 'draft' then
    raise exception 'this email is no longer an unsent draft' using errcode = 'P0002';
  end if;

  delete from public.outreach_message_attachments
   where outreach_message_id = p_message_id and attachment_id = p_attachment_id;
end;
$$;

comment on function public.detach_file_from_draft(uuid, uuid) is
  'F217: removes a file from a draft before it is sent. Same ownership/'
  'draft-status guard as attach_file_to_draft. Removing something not '
  'attached is a no-op, not an error.';

revoke execute on function public.detach_file_from_draft(uuid, uuid) from public, anon;
grant execute on function public.detach_file_from_draft(uuid, uuid) to authenticated;
