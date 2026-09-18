-- Migration: add_email_notification_types
-- Story: F179 (#175) — Email Notifications.
--
-- WHAT THIS ADDS, AND WHY ONLY THIS:
--   users.email_notification_types — which notification_type values a user
--   wants emailed "in addition to in-app" (AC1). Defaults to
--   `{client_reply_received}` — the one reply type this ticket emails.
--   F179 AC3's rule ("reply notifications are sent by email by default...
--   unless the CAM has explicitly opted out") is the column default itself,
--   not application logic that could drift from it.
--
-- WHY NO CHANGES TO capture_gmail_reply / reply_events:
--   The in-app half of "email in addition to in-app" already exists on dev:
--   F174 (#535, 20260912170300_notify_on_gmail_reply.sql) ships an AFTER
--   INSERT trigger on reply_events that calls create_notification for the
--   client's *current* owner with notification_type 'client_reply_received'
--   (admin fallback 'unowned_client_reply_received' when there is no active
--   owner). This migration deliberately does NOT add a second, in-function
--   create_notification call — that would double-notify the same reply. The
--   token below is F174's owner type, not a parallel vocabulary, so the
--   email preference always lines up with a notification that really exists.
--
-- WHY EMAIL SENDING ITSELF IS NOT IN THIS MIGRATION: Postgres cannot call
--   Gmail directly. The actual send happens in TypeScript
--   (src/lib/gmail/reply-sync.ts, right after the capture RPC succeeds)
--   using sendGmailMessage (F241) directly — deliberately NOT
--   sendBranchOutreach, which is documented as "the only transport entry
--   point for client outreach" and sits behind the approval/scheduling
--   pipeline. A platform notification to a CAM is not outreach to a client
--   and must never be reachable through, or mistakable for, that path — see
--   src/lib/notification-email.ts's header for the full reasoning (this
--   ticket's testing note: "verify no outreach email can be sent without
--   human approval").
--
-- Schema change approval record (SOP §7):
--   Change        | Add users.email_notification_types (text[], default
--                 | '{client_reply_received}').
--   Reason        | F179 AC1/AC3 — see above.
--   Compatibility | Additive column; no table, RPC or policy touched.
--   Data migration| None. Existing users get the column default.
--   Security      | Column carries no grant to `authenticated` by default;
--                 | the grant below is scoped the same way
--                 | notification_frequency was (F201, 20260828130000): a
--                 | user may update only their own row, via the existing
--                 | users_update_self_or_admin policy. SELECT on the whole
--                 | table is already granted to authenticated
--                 | (20260722103000), so the settings page's own-row read
--                 | needs nothing extra.
--   Documentation | Matrix §3.1/§3.19 updated alongside this migration.
--
-- Reversibility: paired rollback in
-- ../rollback/20260920090000_add_email_notification_types.down.sql

alter table public.users
  add column email_notification_types text[] not null default '{client_reply_received}';

comment on column public.users.email_notification_types is
  'F179: which notification_type values this user wants emailed in addition '
  'to in-app (AC1). Defaults to reply notifications only — client_reply_received '
  '(F174''s owning-CAM token) — per AC3; an empty array means "in-app only", '
  'not "use some other default".';

-- Same grant shape as notification_frequency (F201/F178,
-- 20260828130000_add_notification_frequency_and_followup_timing.sql): a user
-- manages their own preference; users_update_self_or_admin already scopes
-- the row.
grant update (email_notification_types) on public.users to authenticated;
