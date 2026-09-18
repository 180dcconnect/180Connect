-- Migration: get_clients_last_activity
-- Sequence: addition (needs public.organisations, public.outreach_messages,
--   public.reply_events, public.audit_log, app.is_admin, app.is_active_user).
--   Not a numbered step — RPC migrations are not rows in Data Model tab 11.
-- Story: F160 (#155) — Follow-Up Recommendations.
--
-- WHAT THIS CHANGES:
--   Adds one read-only aggregation RPC: for a batch of clients, the timestamp of
--   each client's LAST recorded activity per F160's agreed clock — latest email
--   sent (outreach_messages.sent_at, sent rows only), latest reply received
--   (reply_events.received_at), latest pipeline status change (audit_log rows
--   action='status_changed' against the organisation). The dashboard merges the
--   three per client and measures silence from the newest of them; F175 will
--   consume the same shape when recommendations become notifications.
--
-- WHY AN RPC RATHER THAN THREE CLIENT-SIDE QUERIES: silence is measured in
-- weeks, so every relevant timestamp can be old — windowed/capped queries (the
-- recent-updates pattern) would structurally miss exactly the stalest clients
-- recommendations exist to surface, and unbounded fetches of all messages or
-- audit rows grow forever. Max-per-group is one indexed query here and O(rows
-- requested) for the caller.
--
-- PERMISSION SHAPE: owner-scoped unless admin, matching the Needs Attention
-- panel this feeds — the result set silently drops requested ids the caller
-- neither owns nor admins, rather than erroring, because the caller legitimately
-- cannot know which ids will survive the ownership line. Read-only: no writes,
-- no audit row (audit-log-pattern.md covers state-changing writes only).
--
-- Schema change approval record (SOP §7):
--   Change        | Add get_clients_last_activity(uuid[]) returning one row per
--               | accessible organisation with three nullable timestamps.
--   Reason        | F160 AC1/AC2 need days-of-silence per client; the clock is
--               | defined as the latest of the three activity sources.
--   Compatibility | Additive only. No existing query changes.
--   Security      | SECURITY DEFINER, search_path pinned, re-checks active user
--               | inside the body and filters to owned-or-admin rows. EXECUTE
--               | revoked from public/anon, granted to authenticated.
--   Documentation | docs/rls-permission-matrix.md §3.4 updated in the same PR.
--   Approved by   | Bashir (Project Manager), 26 Aug 2026.
--
-- Reversibility: paired rollback in ../rollback/20260910100000_get_clients_last_activity.down.sql

create function public.get_clients_last_activity(
  p_organisation_ids uuid[]
)
returns table (
  organisation_id uuid,
  last_email_sent_at timestamptz,
  last_reply_received_at timestamptz,
  last_status_change_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.is_active_user() then
    raise exception 'your account is not active'
      using errcode = '42501';
  end if;

  return query
  select o.id,
         (select max(m.sent_at)
            from public.outreach_messages m
           where m.organisation_id = o.id
             and m.send_status = 'sent'),
         (select max(r.received_at)
            from public.reply_events r
           where r.organisation_id = o.id),
         (select max(a.created_at)
            from public.audit_log a
           where a.target_table = 'organisations'
             and a.action = 'status_changed'
             and a.target_id = o.id)
    from public.organisations o
   where o.id = any(p_organisation_ids)
     and (app.is_admin() or o.owner_id = (select auth.uid()));
end;
$$;

comment on function public.get_clients_last_activity(uuid[]) is
  'F160: per-client last-activity timestamps — the newest sent email, received '
  'reply, and audited pipeline status change. Read-only; owner-scoped unless '
  'admin (inaccessible ids are dropped, not errored). Feeds the Needs Attention '
  'panel''s follow-up recommendations and, later, reminder notifications (F175).';

revoke execute on function public.get_clients_last_activity(uuid[]) from public;
revoke execute on function public.get_clients_last_activity(uuid[]) from anon;
grant execute on function public.get_clients_last_activity(uuid[]) to authenticated;
