-- Read-only RPC exposing pg_cron job health to the app: cron.job and
-- cron.job_run_details live outside PostgREST's exposed schemas, so the
-- inbox sidebar's outreach-engine status card cannot query them directly.
--
-- Reversibility: ../rollback/20261002091000_create_outreach_cron_health_rpc.down.sql

create function public.get_outreach_cron_health(p_job_names text[])
returns table (
  job_name text,
  last_run_at timestamptz,
  last_run_succeeded boolean
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.is_active_user() then
    raise exception 'your account is not active' using errcode = '42501';
  end if;

  return query
  select j.jobname,
         d.last_run_at,
         d.last_run_succeeded
  from cron.job j
  left join lateral (
    select rd.end_time as last_run_at, rd.status = 'succeeded' as last_run_succeeded
    from cron.job_run_details rd
    where rd.jobid = j.jobid
    order by rd.end_time desc nulls last
    limit 1
  ) d on true
  where j.jobname = any(p_job_names);
end;
$$;

-- Read-only: no writes, no audit row (audit-log-pattern.md covers
-- state-changing writes only).
revoke execute on function public.get_outreach_cron_health(text[]) from public;
revoke execute on function public.get_outreach_cron_health(text[]) from anon;
grant execute on function public.get_outreach_cron_health(text[]) to authenticated;
