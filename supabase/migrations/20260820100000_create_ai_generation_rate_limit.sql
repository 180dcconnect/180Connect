-- Migration: create_ai_generation_rate_limit
-- Story: F227 (#222), AI-generation portion.
--
-- One row per user makes consumption atomic across serverless instances and across all
-- Gemini-backed features. The application supplies the configurable limit/window to the
-- RPC on every call; changing environment configuration needs no SQL or code change.
--
-- Schema change approval record (SOP §7):
--   Change        | Add AI_GENERATION_RATE_LIMIT + consume_ai_generation_allowance RPC
--   Compatibility | Additive. All existing AI entry points use the same service-role RPC.
--   Data migration| None.
--   Security      | RLS enabled; admin SELECT only; writes are RPC-only; RPC executable
--                 | by service_role only. User ids are server-derived after permission checks.
--   Documentation | Data Model tabs 02, 08 and 11; matrix §3.18.
-- Reversibility: paired rollback in ../rollback/20260820100000_create_ai_generation_rate_limit.down.sql

create table public.ai_generation_rate_limit (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null unique references public.users (id) on delete cascade,
  request_count     integer not null default 0 check (request_count >= 0),
  window_started_at timestamptz not null default now(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

comment on table public.ai_generation_rate_limit is
  'F227 fixed-window Gemini request counter, shared across every AI generation feature. '
  'One row per authenticated user; mutated only by consume_ai_generation_allowance.';

revoke all on public.ai_generation_rate_limit from anon, authenticated;
grant select on public.ai_generation_rate_limit to authenticated;

alter table public.ai_generation_rate_limit enable row level security;

create policy ai_generation_rate_limit_select_admin
  on public.ai_generation_rate_limit
  for select to authenticated
  using (app.is_active_user() and app.is_admin());

create or replace function public.consume_ai_generation_allowance(
  p_user_id uuid,
  p_limit integer,
  p_window_seconds integer
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_window interval;
  v_count integer;
  v_window_started_at timestamptz;
begin
  if p_limit < 1 or p_window_seconds < 1 then
    raise exception 'AI rate-limit configuration must be positive';
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

comment on function public.consume_ai_generation_allowance(uuid, integer, integer) is
  'F227 atomically consumes one user AI-generation allowance. Returns null when allowed '
  'or the fixed-window reset timestamp when blocked.';

revoke execute on function public.consume_ai_generation_allowance(uuid, integer, integer) from public;
revoke execute on function public.consume_ai_generation_allowance(uuid, integer, integer) from anon;
revoke execute on function public.consume_ai_generation_allowance(uuid, integer, integer) from authenticated;
grant execute on function public.consume_ai_generation_allowance(uuid, integer, integer) to service_role;
