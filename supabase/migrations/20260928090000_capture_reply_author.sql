-- Migration: capture_reply_author
-- Story: F131 Detect Replies (extends), F135 Reply Follow-up.
--
-- WHY THIS MIGRATION EXISTS: a Stage 2 reply draft has to greet whoever
-- actually wrote in, and until now nothing recorded who that was. The Gmail
-- capture RPC has always received the sender's address — it is written into the
-- AUDIT_LOG detail, where it is a fine forensic record and useless as a query
-- target — but it was never attached to the REPLY_EVENTS row itself. So the
-- reply follow-up could only address the record's *primary contact*, who in a
-- live thread is often a different person from the one who replied: the reply
-- comes from a finance lead, the greeting names the chief executive.
--
-- REPLY_EVENTS.contact_id has existed since 20260804200000 and has never been
-- populated by the Gmail path — the capture RPC simply did not take a sender to
-- match on. This migration fills that column rather than adding a new one, and
-- adds sender_email beside it so the match is auditable after the fact (which
-- address produced this contact) instead of inferable only from AUDIT_LOG.
--
-- Nullable on both counts, deliberately. A reply from an address that matches
-- no contact on the record is normal — a colleague answering from a shared
-- inbox, a trustee replying from their own — and the drafting prompt degrades
-- to an unnamed, team-form greeting rather than addressing the wrong person.
--
-- Schema change approval record (SOP §7):
--   Change        | One nullable text column, sender_email, on
--                 | public.reply_events; capture_gmail_reply replaced to
--                 | populate contact_id and sender_email. No column changes
--                 | type or nullability, no new table, no new RLS surface.
--   Reason        | Make the author of a reply a queryable fact on the row, so
--                 | the reply-follow-up draft can address the person who
--                 | actually wrote instead of the record's primary contact.
--   Compatibility | Additive and nullable, no default. REPLY_EVENTS keeps its
--                 | existing column-agnostic policies (row-level, so a new
--                 | column is not a policy change). Existing rows keep null and
--                 | are unaffected: no backfill is possible, because the only
--                 | record of an already-captured reply's sender is the
--                 | AUDIT_LOG detail, and reading a forensic log as a data
--                 | source is exactly the coupling this column removes.
--   Data migration| None. New captures populate it; old rows stay null and the
--                 | consumer treats null as "author unknown" by design.
--   Security      | A caller-visible email address, already written to
--                 | AUDIT_LOG by the same function under the same service-role
--                 | grant. End users retain no write access to REPLY_EVENTS.
--   Documentation | Data Model tab 07 gains the sender_email row; run
--                 | npm run export:data-model to refresh docs/data-model/.
--
-- Reversibility: ../rollback/20260928090000_capture_reply_author.down.sql

alter table public.reply_events
  add column if not exists sender_email text;

comment on column public.reply_events.sender_email is
  'The From address of the inbound reply, lowercased, as received. Retained '
  'beside contact_id so it stays possible to see which address produced the '
  'match — and, when contact_id is null, which address did not match any '
  'contact on the record.';

-- create or replace, not drop-and-create: the grants and the comment below are
-- re-issued anyway, and replacing in place keeps the function's OID stable for
-- any dependent object.
create or replace function public.capture_gmail_reply(
  p_provider_message_id text,
  p_outreach_message_id uuid,
  p_organisation_id uuid,
  p_reply_body text,
  p_received_at timestamptz,
  p_sender_email text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reply_id uuid;
  v_old_status public.outreach_status;
  v_sender_email text;
  v_contact_id uuid;
begin
  if nullif(btrim(p_provider_message_id), '') is null
     or nullif(btrim(p_reply_body), '') is null then
    raise exception 'provider message id and reply body are required'
      using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_provider_message_id, 131));

  if exists (
    select 1
      from public.audit_log
     where action = 'gmail_reply_captured'
       and detail ->> 'provider_message_id' = p_provider_message_id
  ) then
    return null;
  end if;

  if not exists (
    select 1
      from public.outreach_messages
     where id = p_outreach_message_id
       and organisation_id = p_organisation_id
       and send_status = 'sent'
  ) then
    raise exception 'reply does not match a sent outreach message'
      using errcode = '23503';
  end if;

  v_sender_email := nullif(lower(btrim(p_sender_email)), '');

  -- Match the sender to a contact ON THIS ORGANISATION. Scoped to the
  -- organisation rather than matched globally, because a shared address
  -- ("info@") would otherwise be free to resolve to whoever holds it on some
  -- other record. Primary contacts win a tie, then the oldest row, so the
  -- result is deterministic rather than whatever the planner returns first.
  if v_sender_email is not null then
    select contact.id into v_contact_id
      from public.contacts as contact
     where contact.organisation_id = p_organisation_id
       and contact.email is not null
       and lower(btrim(contact.email)) = v_sender_email
     order by contact.is_primary desc, contact.created_at, contact.id
     limit 1;
  end if;

  insert into public.reply_events (
    outreach_message_id, organisation_id, reply_body, received_at,
    contact_id, sender_email
  ) values (
    p_outreach_message_id, p_organisation_id, btrim(p_reply_body), p_received_at,
    v_contact_id, v_sender_email
  ) returning id into v_reply_id;

  insert into public.audit_log (actor_user_id, action, target_table, target_id, detail)
  values (
    null,
    'gmail_reply_captured',
    'reply_events',
    v_reply_id,
    jsonb_build_object(
      'organisation_id', p_organisation_id,
      'outreach_message_id', p_outreach_message_id,
      'provider_message_id', p_provider_message_id,
      'sender_email', v_sender_email,
      'contact_id', v_contact_id
    )
  );

  -- A prior cron run may have been unable to match this same message and
  -- flagged it for manual review (flag_unmatched_gmail_reply). The two RPCs
  -- use different advisory-lock salts, so overlapping runs seeing different
  -- snapshots of the sent-outreach list can genuinely disagree — this closes
  -- the resulting gap rather than leaving a resolved review item looking
  -- unresolved. Append-only, same as every other audit_log write here.
  if exists (
    select 1
      from public.audit_log
     where action = 'gmail_reply_needs_review'
       and detail ->> 'provider_message_id' = p_provider_message_id
  ) then
    insert into public.audit_log (actor_user_id, action, target_table, target_id, detail)
    values (
      null,
      'gmail_reply_review_resolved',
      'reply_events',
      v_reply_id,
      jsonb_build_object(
        'provider_message_id', p_provider_message_id,
        'organisation_id', p_organisation_id
      )
    );
  end if;

  select outreach_status into v_old_status
    from public.organisations
   where id = p_organisation_id
   for update;

  if v_old_status is distinct from 'responded'::public.outreach_status then
    update public.organisations
       set outreach_status = 'responded'
     where id = p_organisation_id;

    insert into public.audit_log (actor_user_id, action, target_table, target_id, detail)
    values (
      null,
      'status_changed',
      'organisations',
      p_organisation_id,
      jsonb_build_object(
        'from', v_old_status,
        'to', 'responded',
        'source', 'gmail_reply_sync',
        'reply_event_id', v_reply_id
      )
    );
  end if;

  return v_reply_id;
end;
$$;

comment on function public.capture_gmail_reply(text, uuid, uuid, text, timestamptz, text) is
  'F131: atomically deduplicates and captures a matched Gmail reply, resolves '
  'the sender to a contact on the record (reply_events.contact_id + '
  'sender_email), marks the organisation responded, and audits both writes. '
  'Resolves a prior unmatched-reply review flag for the same provider message '
  'id, if one exists. Service-role sync only.';

revoke execute on function public.capture_gmail_reply(text, uuid, uuid, text, timestamptz, text) from public;
revoke execute on function public.capture_gmail_reply(text, uuid, uuid, text, timestamptz, text) from anon;
revoke execute on function public.capture_gmail_reply(text, uuid, uuid, text, timestamptz, text) from authenticated;
grant execute on function public.capture_gmail_reply(text, uuid, uuid, text, timestamptz, text) to service_role;
