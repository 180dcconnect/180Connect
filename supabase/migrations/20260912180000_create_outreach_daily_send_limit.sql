-- Migration: create_outreach_daily_send_limit
-- Story: F128 (#355) — Sending Limit Protection.
--
-- F227's EMAIL_SEND_RATE_LIMIT (20260820100000, this branch) throttles each CAM's own
-- send rate; every CAM sends from the same one branch mailbox, so that alone bounds
-- no individual's volume, but never the mailbox's total. F128 AC1 asks specifically
-- for a cap on the mailbox as a whole, and AC3 asks for it to be admin-configurable
-- "without a code change or redeploy" — env vars need a redeploy on this platform, so
-- the limit lives in the database instead, alongside the rest of the admin-configured
-- rule tables (see data_handling_rules for the pattern this follows).
--
-- Singleton table, same shape as data_handling_rule_versions: a boolean primary key
-- pinned to true guarantees exactly one row. Reads are cheap and need no lookup key;
-- writes only ever update that one row.
--
-- Schema change approval record (SOP §7):
--   Change        | Add OUTREACH_DAILY_SEND_LIMIT singleton +
--                 | set_outreach_daily_send_limit RPC
--   Reason        | F128 AC1/AC3 — a branch-wide daily send cap, editable by an admin
--                 | at runtime, distinct from F227's per-CAM rate limit.
--   Compatibility | New table. Nothing existing reads or writes it.
--   Data migration| None. Seeded with one row (daily_limit = 250) by this migration.
--   Security      | RLS on; any active authenticated user may SELECT (the send path
--                 | runs as the sending CAM and must be able to read the current
--                 | limit); no INSERT/UPDATE/DELETE grant for authenticated — the
--                 | only write path is the SECURITY DEFINER RPC below, which
--                 | re-checks app.is_admin() and writes audit_log in the same
--                 | transaction (docs/audit-log-pattern.md).
--   Documentation | Data Model tabs 02, 08, 11; matrix new §3.24.
-- Reversibility: paired rollback in
--   ../rollback/20260912180000_create_outreach_daily_send_limit.down.sql

create table public.outreach_daily_send_limit (
  id          boolean primary key default true check (id = true),
  daily_limit integer not null default 250 check (daily_limit > 0),
  updated_by  uuid references public.users (id) on delete set null,
  updated_at  timestamptz not null default now()
);

comment on table public.outreach_daily_send_limit is
  'F128 singleton: the branch-wide cap on emails sent per UTC calendar day. Read by '
  'every outreach send path (immediate and scheduled); written only by '
  'set_outreach_daily_send_limit.';
comment on column public.outreach_daily_send_limit.updated_by is
  'The admin who last changed the limit. Null means the seeded default has never '
  'been changed.';

insert into public.outreach_daily_send_limit (id, daily_limit) values (true, 250);

revoke all on public.outreach_daily_send_limit from anon, authenticated;
grant select on public.outreach_daily_send_limit to authenticated;

alter table public.outreach_daily_send_limit enable row level security;

create policy outreach_daily_send_limit_select_active on public.outreach_daily_send_limit
  for select to authenticated
  using (app.is_active_user());

-- No INSERT / UPDATE / DELETE policy for authenticated — the RPC below is the only
-- write path, matching the data_handling_rules pattern.

create or replace function public.set_outreach_daily_send_limit(p_limit integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor     uuid;
  v_old_limit integer;
begin
  v_actor := (select auth.uid());
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;
  if not app.is_admin() then
    raise exception 'Only admins can change the outreach daily sending limit';
  end if;
  if not app.is_active_user() then
    raise exception 'Inactive users cannot change the outreach daily sending limit';
  end if;
  if p_limit is null or p_limit < 1 then
    raise exception 'The daily sending limit must be a positive whole number';
  end if;

  select daily_limit into v_old_limit from public.outreach_daily_send_limit where id = true;

  -- No-op check (audit-log-pattern.md §5): record real transitions only.
  if v_old_limit = p_limit then
    return;
  end if;

  update public.outreach_daily_send_limit
    set daily_limit = p_limit, updated_by = v_actor, updated_at = now()
    where id = true;

  insert into public.audit_log (actor_user_id, action, target_table, target_id, detail)
  values (
    v_actor, 'outreach_daily_send_limit_changed', 'outreach_daily_send_limit', null,
    jsonb_build_object('from', v_old_limit, 'to', p_limit)
  );
end;
$$;

comment on function public.set_outreach_daily_send_limit is
  'Changes the branch-wide daily outreach sending cap and audit-logs the change '
  '(F128). Admin-only. No-op writes (same value) are skipped. See '
  'docs/audit-log-pattern.md.';

revoke execute on function public.set_outreach_daily_send_limit from public, anon;
grant execute on function public.set_outreach_daily_send_limit to authenticated;
