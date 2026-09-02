-- Migration: notify_reply_owner
-- Story: F174 Reply Notifications (#170).
-- Sequence: fix-forward on capture_gmail_reply (F131), already applied to
--   staging at 20260912170100_wire_capture_gmail_reply_to_mark_responded.sql —
--   that migration is not edited (MIGRATIONS.md: never edit an applied
--   migration).
--
-- WHAT THIS ADDS: capture_gmail_reply is the one place a reply from a real
--   client is detected (F131) — every downstream effect of "a reply arrived"
--   already lives here (REPLY_EVENTS row, audit_log, the responded-status
--   transition via mark_organisation_responded). F174 AC1 asks for an in-app
--   notification "sourced from the same event as F133", and this is that
--   event: no second trigger, no polling, just one more call in the same
--   transaction that already exists.
--
-- WHO GETS NOTIFIED: the client's current owner_id, looked up fresh inside
--   this function rather than passed in — the owner can be reassigned between
--   when Gmail sync queued the job and when this function actually runs, and
--   AC1 says "a client THEY OWN replies", not whoever owned it when the sync
--   pass started. An unowned client notifies nobody; create_notification's
--   own unknown/inactive-recipient skip would have produced the same silent
--   no-op for a null recipient, but checking first avoids a pointless call
--   and reads as an intentional case, not a fallthrough.
--
-- WHY create_notification, NOT A DIRECT INSERT: NOTIFICATIONS grants no
--   INSERT to anyone (matrix §3.19) — the RPC is the only door, same as every
--   other producer (see e.g. src/lib/outreach/scheduled-worker.ts's
--   notifySendFailed for the identical shape from application code). Calling
--   it from inside capture_gmail_reply rather than from a second, separate
--   Gmail-sync step keeps "a reply was captured" and "its owner was told"
--   atomic — a crash between the two would otherwise leave a captured reply
--   nobody was ever notified about.
--
-- AC2 (links directly to the reply, not a generic list): link_path is the
--   client profile, `/clients/<organisation_id>`, matching every other
--   client-scoped notification already in this codebase
--   (notifySendFailed's own p_link_path). The client page's timeline (F075)
--   is where the reply itself renders — there is no separate reply-detail
--   route to link deeper into.
--
-- AC3 (high-priority by default): NOTIFICATIONS carries no priority column —
--   adding one to the shared table would force every existing and future
--   producer to decide a value for a distinction only this one type needs
--   today. Priority is instead a property of notification_type itself,
--   decided in application code (src/lib/notifications.ts's
--   notificationPriority, which maps 'reply_received' to 'high') — the same
--   place notification_type already drives icon/copy choices. This migration
--   only needs to use that literal type string consistently with what the
--   app-side lookup expects.
--
-- Schema change approval record (SOP §7):
--   Change        | Redefine capture_gmail_reply to also call
--                 | create_notification for the client's owner.
--   Reason        | F174 AC1 — a reply notification sourced from the same
--                 | event F131/F133 already detect replies from.
--   Compatibility | Signature, grants, dedup/lock behaviour and the F149
--                 | responded-transition delegation are all unchanged. Only
--                 | the notification call is added, at the end of the
--                 | existing function body.
--   Data migration| None.
--   Security      | Unchanged — service_role only, same as
--                 | 20260912160000/20260912170100. create_notification
--                 | itself already accepts service_role callers (matrix
--                 | §3.19); no new grant needed for that half.
--   Documentation | Matrix §3.19 updated alongside this migration.
--
-- Reversibility: paired rollback in
-- ../rollback/20260913090000_notify_reply_owner.down.sql (restores
-- capture_gmail_reply to its 20260912170100 body).

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
  v_owner_id uuid;
  v_org_name text;
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

  insert into public.reply_events (
    outreach_message_id, organisation_id, reply_body, received_at
  ) values (
    p_outreach_message_id, p_organisation_id, btrim(p_reply_body), p_received_at
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
      'sender_email', lower(p_sender_email)
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

  -- F149 AC2: mark_organisation_responded carries the "never override a
  -- manual/final status" guarantee and writes its own status_changed audit
  -- row (trigger: 'reply_detected') when it actually transitions. A no-op
  -- (already responded, or a final status) is expected and silent here —
  -- the reply itself is still captured either way.
  perform public.mark_organisation_responded(p_organisation_id);

  -- F174 AC1/AC2: tell the client's current owner, in the same transaction
  -- as the capture itself — see migration header for why this is the right
  -- place and why the owner is looked up fresh rather than passed in.
  select owner_id, legal_name into v_owner_id, v_org_name
    from public.organisations
   where id = p_organisation_id;

  if v_owner_id is not null then
    perform public.create_notification(
      p_recipient_user_id => v_owner_id,
      p_notification_type => 'reply_received',
      p_title             => coalesce(v_org_name, 'A client') || ' replied',
      p_body              => left(btrim(p_reply_body), 200),
      p_link_path         => '/clients/' || p_organisation_id::text,
      p_target_table      => 'reply_events',
      p_target_id         => v_reply_id,
      p_actor_user_id     => null
    );
  end if;

  return v_reply_id;
end;
$$;

comment on function public.capture_gmail_reply(text, uuid, uuid, text, timestamptz, text) is
  'F131: atomically deduplicates and captures a matched Gmail reply, resolves a '
  'prior unmatched-reply review flag for the same provider message id if one '
  'exists, delegates the responded transition to mark_organisation_responded '
  '(F149), and notifies the client''s current owner (F174, notification_type '
  E'''reply_received'', app-side treated as high priority). Service-role sync only.';
