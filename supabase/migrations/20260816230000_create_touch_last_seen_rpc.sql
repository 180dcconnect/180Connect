-- Migration: create_touch_last_seen_rpc
-- Story: "last active" on the team members page — not last login, last time the
--   user was seen on any signed-in page (getCurrentActor runs on every one of them).
--
-- WHY AN RPC, AND WHY SECURITY DEFINER:
--   users.last_seen_at is granted to no one (20260722103000_create_users.sql only
--   grants `update (full_name)` to authenticated), so no policy or INVOKER function
--   can write it — same shape as set_user_role/set_user_active. A plain column grant
--   was rejected: unlike full_name, this column should only ever be set to "now", and
--   a self-service grant would let a client backdate or forge it. SECURITY DEFINER
--   writes it from inside the function instead, and the function only ever touches
--   the caller's own row.
--
-- Not audited: last_seen_at is presence, not an ownership/status/role/approval change
-- (docs/audit-log-pattern.md), so it does not go through audit_log.
--
-- Reversibility: paired rollback in ../rollback/20260816230000_create_touch_last_seen_rpc.down.sql

create or replace function public.touch_last_seen()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.users
  set last_seen_at = now()
  where id = (select auth.uid());
end;
$$;

comment on function public.touch_last_seen() is
  'Marks the caller as seen just now. SECURITY DEFINER because last_seen_at is '
  'granted to no one; writes only auth.uid()''s own row. Not audited — presence, '
  'not a state change.';

revoke execute on function public.touch_last_seen() from public;
revoke execute on function public.touch_last_seen() from anon;
grant execute on function public.touch_last_seen() to authenticated;
