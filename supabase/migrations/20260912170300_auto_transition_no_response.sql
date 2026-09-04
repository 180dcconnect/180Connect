-- Schema change approval record (SOP §7):
--   Change        | Add mark_organisation_no_response(p_organisation_id) and
--                 | sweep_no_response_status(), a system-triggered status
--                 | transition to 'no_response' for clients whose silence has
--                 | crossed their owner's second follow-up threshold.
--   Reason        | F154 AC3 (#149): a client sitting at Initial Outreach Sent
--                 | or Follow-Up Sent must move to No Response automatically,
--                 | without a CAM setting it by hand. Deliberately deferred
--                 | when F160 was planned (issue #149 comment, 26 Aug 2026) —
--                 | this closes that gap. Mirrors mark_organisation_responded
--                 | (20260912170000, F149) — a background process has no
--                 | authenticated actor, so this needs its own function
--                 | rather than the manual set_outreach_status (F145).
--   Compatibility | Additive only. Does not change set_outreach_status or the
--                 | outreach_status enum (no_response already exists, added by
--                 | F145's migration).
--   Data migration| None.
--   Security      | Both security definer, service-role only — EXECUTE
--                 | explicitly revoked from public/anon/authenticated before
--                 | granting to service_role (Postgres grants EXECUTE to
--                 | PUBLIC on function creation by default; omitting a grant
--                 | to authenticated is not enough on its own). Meant to be
--                 | called by the daily cron sweep
--                 | (src/app/api/cron/no-response-sweep), not directly by a
--                 | CAM's browser session or anon.
create or replace function public.mark_organisation_no_response(
  p_organisation_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current_status public.outreach_status;
begin
  select outreach_status into v_current_status
    from public.organisations
   where id = p_organisation_id
     for update;

  if v_current_status is null then
    raise exception 'that client could not be found'
      using errcode = 'P0002';
  end if;

  -- AC3 names exactly these two source statuses — a client anywhere else
  -- (including an existing manual/final decision) is left untouched.
  if v_current_status not in ('initial_outreach_sent', 'follow_up_sent') then
    return false;
  end if;

  update public.organisations
    set outreach_status = 'no_response',
        updated_at = now()
    where id = p_organisation_id;

  -- Same audit shape mark_organisation_responded uses (action:
  -- 'status_changed'), actor_user_id null since this is a system, not a CAM,
  -- action.
  insert into public.audit_log (actor_user_id, action, target_table, target_id, detail)
  values (
    null,
    'status_changed',
    'organisations',
    p_organisation_id,
    jsonb_build_object('from', v_current_status, 'to', 'no_response', 'trigger', 'silence_window_elapsed')
  );

  return true;
end;
$$;
comment on function public.mark_organisation_no_response(uuid) is
  'F154 AC3: system-triggered transition to no_response when a client''s '
  'silence crosses its owner''s follow-up window. Only transitions from '
  'initial_outreach_sent or follow_up_sent. Service-role only — not callable '
  'directly from an authenticated CAM session.';

-- Postgres grants EXECUTE to PUBLIC on function creation by default — an
-- explicit revoke is required, not just omitting a grant, or this stays
-- callable by anon and authenticated over the REST RPC endpoint despite the
-- comment above. Same defensive pattern as get_clients_last_activity
-- (20260910100000).
revoke execute on function public.mark_organisation_no_response(uuid) from public, anon, authenticated;
grant execute on function public.mark_organisation_no_response(uuid) to service_role;

-- The sweep itself: last-activity is computed inline rather than via
-- get_clients_last_activity (20260910100000, F160) because that RPC is
-- authenticated-only and owner-scoped through auth.uid(), which is null for
-- a service-role caller — it cannot serve a company-wide sweep.
create or replace function public.sweep_no_response_status()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org record;
  v_transitioned integer := 0;
  v_last_activity timestamptz;
  v_window_days integer;
begin
  for v_org in
    select o.id, o.owner_id, p.second_follow_up_days
      from public.organisations o
      left join public.outreach_preferences p on p.user_id = o.owner_id
     where o.outreach_status in ('initial_outreach_sent', 'follow_up_sent')
     for update of o
  loop
    v_window_days := coalesce(v_org.second_follow_up_days, 14);

    select greatest(
             (select max(m.sent_at) from public.outreach_messages m
               where m.organisation_id = v_org.id and m.send_status = 'sent'),
             (select max(r.received_at) from public.reply_events r
               where r.organisation_id = v_org.id),
             (select max(a.created_at) from public.audit_log a
               where a.target_table = 'organisations'
                 and a.action = 'status_changed'
                 and a.target_id = v_org.id)
           )
      into v_last_activity;

    -- No measurable activity means silence cannot be judged — skip rather
    -- than guess, matching F160/F183's own convention.
    if v_last_activity is null then
      continue;
    end if;

    if v_last_activity < now() - (v_window_days || ' days')::interval then
      if public.mark_organisation_no_response(v_org.id) then
        v_transitioned := v_transitioned + 1;
      end if;
    end if;
  end loop;

  return v_transitioned;
end;
$$;
comment on function public.sweep_no_response_status() is
  'F154 AC3: daily sweep — transitions every initial_outreach_sent/'
  'follow_up_sent client whose last activity (sent email, received reply, '
  'audited status change) is older than its owner''s second_follow_up_days '
  '(default 14) to no_response. Returns the count transitioned. '
  'Service-role only, called from src/app/api/cron/no-response-sweep.';

revoke execute on function public.sweep_no_response_status() from public, anon, authenticated;
grant execute on function public.sweep_no_response_status() to service_role;
