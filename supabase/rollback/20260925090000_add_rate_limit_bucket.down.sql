-- Rollback: add_rate_limit_bucket (F214)
--
-- Restores F227's single shared counter. Rows in any bucket other than
-- 'generation' are deleted first: the unique key being restored cannot hold two
-- rows for one user, and a search counter has no meaning once search buckets no
-- longer exist. Counts in the 'generation' bucket survive untouched.

drop function if exists public.consume_ai_generation_allowance(uuid, integer, integer, text);

delete from public.ai_generation_rate_limit where bucket <> 'generation';

alter table public.ai_generation_rate_limit
  drop constraint if exists ai_generation_rate_limit_user_bucket_key;

alter table public.ai_generation_rate_limit
  add constraint ai_generation_rate_limit_user_id_key unique (user_id);

alter table public.ai_generation_rate_limit drop column if exists bucket;

create or replace function public.consume_ai_generation_allowance(
  p_user_id uuid,
  p_limit integer,
  p_window_seconds integer
)
returns timestamptz
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
  v_window_started_at timestamptz;
  v_window interval;
begin
  if p_limit < 1 or p_window_seconds < 1 then
    raise exception 'Invalid rate limit configuration' using errcode = '22023';
  end if;

  if not exists (select 1 from public.users where id = p_user_id and is_active) then
    raise exception 'Active user not found' using errcode = '42501';
  end if;

  v_window := make_interval(secs => p_window_seconds);

  insert into public.ai_generation_rate_limit (
    user_id, request_count, window_started_at, created_at, updated_at
  ) values (p_user_id, 1, now(), now(), now())
  on conflict (user_id) do update
     set request_count = case
           when public.ai_generation_rate_limit.window_started_at <= now() - v_window then 1
           else public.ai_generation_rate_limit.request_count + 1
         end,
         window_started_at = case
           when public.ai_generation_rate_limit.window_started_at <= now() - v_window then now()
           else public.ai_generation_rate_limit.window_started_at
         end,
         updated_at = now()
  returning request_count, window_started_at into v_count, v_window_started_at;

  if v_count <= p_limit then
    return null;
  end if;

  return v_window_started_at + v_window;
end;
$$;

revoke execute on function public.consume_ai_generation_allowance(uuid, integer, integer) from public;
revoke execute on function public.consume_ai_generation_allowance(uuid, integer, integer) from anon;
revoke execute on function public.consume_ai_generation_allowance(uuid, integer, integer) from authenticated;
grant execute on function public.consume_ai_generation_allowance(uuid, integer, integer) to service_role;
