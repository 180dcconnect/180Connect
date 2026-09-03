-- Rollback: 20260912180100_enforce_daily_send_limit_atomically
-- Restores claim_outreach_send's prior body (20260901110000): the per-message
-- claim with no daily-cap check, and drops claim_scheduled_outreach_send. This
-- is a functional regression (F128's daily cap stops being enforced atomically,
-- and the scheduled-delivery worker loses its own claim path entirely) — only
-- ever use this to fully revert the F128 concurrency fix, not as a routine
-- rollback. Reverting this migration alone without also reverting
-- scheduled-worker.ts leaves the worker calling a function that no longer
-- exists.

drop function if exists public.claim_scheduled_outreach_send(uuid, timestamptz);

create or replace function public.claim_outreach_send(p_message_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor    uuid := (select auth.uid());
  v_message  record;
  v_claimed  uuid;
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
  'F123: atomically claim a draft for sending. Returns true once per unsent draft '
  '(false for everyone else until the claim goes stale or is released), refuses '
  'non-owners with 42501 and suppressed clients outright. Not audited — the audited '
  'transition is mark_outreach_sent.';
