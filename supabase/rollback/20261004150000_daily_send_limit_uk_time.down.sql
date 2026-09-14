-- Rollback: 20261004150000_daily_send_limit_uk_time
-- Reverts both claim RPCs to the UTC window they used before.

create or replace function public.claim_outreach_send(p_message_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor        uuid := (select auth.uid());
  v_message      record;
  v_claimed      uuid;
  v_daily_limit  integer;
  v_today_start  timestamptz;
  v_today_count  bigint;
begin
  if not app.is_active_user() then
    raise exception 'your account is not active'
      using errcode = '42501';
  end if;

  select m.id,
         m.sent_by_user_id,
         m.organisation_id,
         o.owner_id as org_owner_id
    into v_message
    from public.outreach_messages m
    join public.organisations o on o.id = m.organisation_id
   where m.id = p_message_id
     for update of m;

  if v_message.id is null then
    raise exception 'that draft could not be found'
      using errcode = 'P0002';
  end if;

  if not (
    app.is_admin()
    or v_message.org_owner_id = v_actor
    or v_message.sent_by_user_id = v_actor
  ) then
    raise exception 'only the client''s owner or an admin may send this draft'
      using errcode = '42501';
  end if;

  if exists (
    select 1
      from public.suppressions s
     where s.organisation_id = v_message.organisation_id
       and s.status = 'active'
  ) then
    raise exception 'this client is suppressed; outreach is blocked'
      using errcode = 'P0001';
  end if;

  select daily_limit into v_daily_limit
    from public.outreach_daily_send_limit
   where id = true
     for update;

  v_daily_limit := coalesce(v_daily_limit, 250);
  v_today_start := date_trunc('day', now() at time zone 'utc') at time zone 'utc';

  select count(*) into v_today_count
    from public.outreach_messages
   where (send_status = 'sent' and sent_at >= v_today_start)
      or (send_claimed_at is not null and send_claimed_at >= v_today_start);

  if v_today_count >= v_daily_limit then
    raise exception 'the daily outreach sending limit (%) has been reached (% sent or in flight today)',
      v_daily_limit, v_today_count
      using errcode = 'P0003';
  end if;

  update public.outreach_messages
     set send_claimed_at = now()
   where id = v_message.id
     and send_status = 'draft'
     and (
       send_claimed_at is null
       or send_claimed_at < now() - public.send_claim_staleness_window()
     )
  returning id into v_claimed;

  return v_claimed is not null;
end;
$$;

comment on function public.claim_outreach_send(uuid) is
  'F123/F128: atomically claim a draft for sending. Returns true once per unsent '
  'draft (false for everyone else until the claim goes stale or is released), '
  'refuses non-owners with 42501, suppressed clients with P0001, and a reached '
  'branch-wide daily send cap with P0003 — all before any provider call. Not '
  'audited — the audited transition is mark_outreach_sent.';

create or replace function public.claim_scheduled_outreach_send(
  p_message_id uuid,
  p_claimed_at timestamptz
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row          record;
  v_daily_limit  integer;
  v_today_start  timestamptz;
  v_today_count  bigint;
  v_claimed      uuid;
begin
  if (select auth.uid()) is not null then
    raise exception 'service role required' using errcode = '42501';
  end if;

  select m.id
    into v_row
    from public.outreach_messages m
   where m.id = p_message_id
     for update of m;

  if v_row.id is null then
    return 'lost_claim';
  end if;

  select daily_limit into v_daily_limit
    from public.outreach_daily_send_limit
   where id = true
     for update;

  v_daily_limit := coalesce(v_daily_limit, 250);
  v_today_start := date_trunc('day', now() at time zone 'utc') at time zone 'utc';

  select count(*) into v_today_count
    from public.outreach_messages
   where (send_status = 'sent' and sent_at >= v_today_start)
      or (send_claimed_at is not null and send_claimed_at >= v_today_start);

  if v_today_count >= v_daily_limit then
    return 'daily_limit_reached';
  end if;

  update public.outreach_messages
     set send_claimed_at = p_claimed_at
   where id = p_message_id
     and send_status = 'scheduled'
     and (
       send_claimed_at is null
       or send_claimed_at < p_claimed_at - public.send_claim_staleness_window()
     )
  returning id into v_claimed;

  if v_claimed is null then
    return 'lost_claim';
  end if;

  return 'claimed';
end;
$$;

comment on function public.claim_scheduled_outreach_send(uuid, timestamptz) is
  'F129/F128: service_role-only atomic claim for the scheduled-delivery worker. '
  'Returns ''claimed'', ''daily_limit_reached'' (the branch-wide cap is exhausted — '
  'transient, reported in the run summary), or ''lost_claim'' (someone else claimed '
  'or cancelled it — silent, same as before F128).';

revoke execute on function public.claim_scheduled_outreach_send(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.claim_scheduled_outreach_send(uuid, timestamptz) to service_role;
