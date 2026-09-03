-- Migration: add_email_notification_preferences
-- Story: F179 (#175) — Email Notifications.
-- Sequence: fix-forward on capture_gmail_reply (F131), already applied to
--   staging at 20260912170100_wire_capture_gmail_reply_to_mark_responded.sql —
--   that migration is not edited (MIGRATIONS.md: never edit an applied
--   migration).
--
-- WHAT THIS ADDS, AND WHY BOTH HALVES LAND TOGETHER:
--   1. users.email_notification_types — F178's preferences (AC1: "based on
--      their preferences") are not built on this branch (F178 is a listed
--      dependency, not something this ticket owns rebuilding), so this adds
--      the one preference column F179 itself actually needs: which
--      notification types a CAM wants emailed, "in addition to in-app"
--      (AC1). Defaults to `{reply_received}` — AC3's own rule ("reply
--      notifications are sent by email by default... unless the CAM has
--      explicitly opted out") is the column default, not application logic
--      that could drift from it.
--   2. capture_gmail_reply also creates an in-app `reply_received`
--      notification for the client's owner. AC1 promises email "in addition
--      to in-app" — that only means something once the in-app half exists,
--      and it didn't on this branch (F133/F174, the tickets that own
--      building it, are not dependencies here either). This is the same
--      minimal addition made on the F174 branch; the two branches will
--      reconcile at merge time, same as every other case in this codebase
--      where sibling feature branches don't share unmerged work.
--
-- WHY EMAIL SENDING ITSELF IS NOT IN THIS MIGRATION: Postgres cannot call
--   Gmail directly. The actual send happens in TypeScript
--   (src/lib/gmail/reply-sync.ts, right after this RPC call succeeds) using
--   sendGmailMessage (F241) directly — deliberately NOT sendBranchOutreach,
--   which is documented as "the only transport entry point for client
--   outreach" and sits behind the approval/scheduling pipeline. A platform
--   notification to a CAM is not outreach to a client and must never be
--   reachable through, or mistakable for, that path — see
--   src/lib/notification-email.ts's header for the full reasoning (this
--   ticket's testing note: "verify no outreach email can be sent without
--   human approval").
--
-- Schema change approval record (SOP §7):
--   Change        | Add users.email_notification_types (text[], default
--                 | '{reply_received}'). Redefine capture_gmail_reply to
--                 | also call create_notification for the client's owner.
--   Reason        | F179 AC1/AC3 — see above.
--   Compatibility | Additive column. capture_gmail_reply's signature,
--                 | grants, dedup/lock behaviour and the F149
--                 | responded-transition delegation are all unchanged; only
--                 | the notification call is added, at the end of the
--                 | existing function body.
--   Data migration| None. Existing users get the column default.
--   Security      | New column carries no grant to `authenticated` by
--                 | default here — see the follow-up grant statement below,
--                 | scoped the same way notification_frequency was (F201,
--                 | 20260828130000): a user may update only their own row,
--                 | via the existing users_update_self_or_admin policy.
--   Documentation | Matrix §3.1/§3.19 updated alongside this migration.
--
-- Reversibility: paired rollback in
-- ../rollback/20260913090000_add_email_notification_preferences.down.sql

alter table public.users
  add column email_notification_types text[] not null default '{reply_received}';

comment on column public.users.email_notification_types is
  'F179: which notification_type values this user wants emailed in addition '
  'to in-app (AC1). Defaults to reply notifications only (AC3) — an empty '
  'array means "in-app only", not "use some other default".';

-- Same grant shape as notification_frequency (F201/F178,
-- 20260828130000_add_notification_frequency_and_followup_timing.sql): a user
-- manages their own preference; users_update_self_or_admin already scopes
-- the row.
grant update (email_notification_types) on public.users to authenticated;

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
  v_reply_id   uuid;
  v_owner_id   uuid;
  v_org_name   text;
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

  -- F179 AC1: the in-app half of "email in addition to in-app" — see
  -- migration header. Looked up fresh rather than passed in, since ownership
  -- can move between when Gmail sync queued the job and when this runs.
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
  '(F149), and notifies the client''s current owner in-app (F179 AC1, '
  'notification_type reply_received). The email half of F179 happens '
  'application-side, in src/lib/gmail/reply-sync.ts, right after this RPC '
  'returns — see that file and src/lib/notification-email.ts. Service-role '
  'sync only.';
