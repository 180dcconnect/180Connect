-- Migration: link_attachments_to_timeline
-- Story: F219 — Link Attachment to Timeline (#214)
-- Spec: docs/rls-permission-matrix.md §3.21
--
-- Each attachment keeps an explicit, stable reference to the timeline source it
-- belongs to. `client` is a real client-level "File shared" event for uploads
-- which are not part of an email, reply, note, or audited change. Existing rows
-- are backfilled to that event so no attachment is left disconnected.
--
-- Schema change approval record (SOP §7):
--   Story / PR     | F219 / #214
--   Affected       | ATTACHMENTS; link_attachment_to_timeline(uuid,uuid,text,uuid)
--   Migration      | 20260912180000 (after every migration currently on dev)
--   Compatibility  | Additive columns with a safe default; existing readers work.
--   Data migration | Existing attachments become client-level timeline events.
--   Security       | No new table grants. Linking is only through a SECURITY
--                  | DEFINER RPC which checks app.can_write(), attachment/client
--                  | ownership, and the target event's client.
--   Documentation | RLS matrix plus Data Model tabs 02/04/11 updated and exported.
--
-- Reversibility: paired rollback in
-- ../rollback/20260912180000_link_attachments_to_timeline.down.sql

alter table public.attachments
  add column timeline_context_type text not null default 'client',
  add column timeline_context_id uuid;

alter table public.attachments
  add constraint attachments_timeline_context_type_check
    check (timeline_context_type in ('client', 'note', 'outreach_message', 'reply_event', 'audit_log')),
  add constraint attachments_timeline_context_id_check
    check (
      (timeline_context_type = 'client' and timeline_context_id is null)
      or
      (timeline_context_type <> 'client' and timeline_context_id is not null)
    );

comment on column public.attachments.timeline_context_type is
  'F219: timeline source this file belongs to: client, note, outreach_message, reply_event, or audit_log.';
comment on column public.attachments.timeline_context_id is
  'F219: stable id of the linked timeline source; null only for a client-level File shared event.';

create index attachments_timeline_context_idx
  on public.attachments (timeline_context_type, timeline_context_id);

create or replace function public.link_attachment_to_timeline(
  p_attachment_id uuid,
  p_organisation_id uuid,
  p_context_type text,
  p_context_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_context_type text := btrim(coalesce(p_context_type, ''));
  v_target_matches boolean := false;
begin
  if not app.can_write() then
    raise exception 'only a CAM or admin can link an attachment' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.attachments
     where id = p_attachment_id and organisation_id = p_organisation_id
  ) then
    raise exception 'attachment not found for this client' using errcode = 'P0002';
  end if;

  if v_context_type = 'client' then
    if p_context_id is not null then
      raise exception 'a client-level event must not have a context id' using errcode = '22023';
    end if;
    v_target_matches := true;
  elsif p_context_id is null then
    raise exception 'choose a timeline event' using errcode = '22023';
  elsif v_context_type = 'note' then
    select exists (
      select 1 from public.notes
       where id = p_context_id and organisation_id = p_organisation_id
    ) into v_target_matches;
  elsif v_context_type = 'outreach_message' then
    select exists (
      select 1 from public.outreach_messages
       where id = p_context_id and organisation_id = p_organisation_id
         and send_status = 'sent' and sent_at is not null
    ) into v_target_matches;
  elsif v_context_type = 'reply_event' then
    select exists (
      select 1 from public.reply_events
       where id = p_context_id and organisation_id = p_organisation_id
    ) into v_target_matches;
  elsif v_context_type = 'audit_log' then
    select exists (
      select 1 from public.audit_log
       where id = p_context_id
         and target_table = 'organisations'
         and target_id = p_organisation_id
         and action in (
           'status_changed', 'ownership_reassigned',
           'edit_suggestion_approved', 'edit_suggestion_rejected'
         )
    ) into v_target_matches;
  else
    raise exception 'that timeline event type is not supported' using errcode = '22023';
  end if;

  if not v_target_matches then
    raise exception 'timeline event not found for this client' using errcode = 'P0002';
  end if;

  update public.attachments
     set timeline_context_type = v_context_type,
         timeline_context_id = p_context_id
   where id = p_attachment_id and organisation_id = p_organisation_id;
end;
$$;

comment on function public.link_attachment_to_timeline(uuid, uuid, text, uuid) is
  'F219: links an attachment to a verified timeline source belonging to the same client. '
  'SECURITY DEFINER because ATTACHMENTS has no direct UPDATE grant.';

revoke execute on function public.link_attachment_to_timeline(uuid, uuid, text, uuid)
  from public, anon;
grant execute on function public.link_attachment_to_timeline(uuid, uuid, text, uuid)
  to authenticated;

-- Email/reply ingestion can create metadata and its link in one transaction.
-- The existing five-argument function remains unchanged for F081 callers.
create function public.record_attachment(
  p_organisation_id uuid,
  p_filename text,
  p_storage_path text,
  p_content_type text,
  p_size_bytes bigint,
  p_context_type text,
  p_context_id uuid
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_attachment_id uuid;
begin
  v_attachment_id := public.record_attachment(
    p_organisation_id,
    p_filename,
    p_storage_path,
    p_content_type,
    p_size_bytes
  );
  perform public.link_attachment_to_timeline(
    v_attachment_id,
    p_organisation_id,
    p_context_type,
    p_context_id
  );
  return v_attachment_id;
end;
$$;

comment on function public.record_attachment(uuid, text, text, text, bigint, text, uuid) is
  'F219: atomic attachment metadata + timeline-context overload for email/reply ingestion.';
revoke execute on function public.record_attachment(uuid, text, text, text, bigint, text, uuid)
  from public, anon;
grant execute on function public.record_attachment(uuid, text, text, text, bigint, text, uuid)
  to authenticated;

alter publication supabase_realtime add table public.attachments;
