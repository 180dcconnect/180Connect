-- Migration: add_rate_limit_bucket
-- Sequence: fix-forward addition to 20260902140000_create_ai_generation_rate_limit.sql.
-- Story: F214 Natural Language Charity Search (#209)
-- Spec: docs/rls-permission-matrix.md (existing AI_GENERATION_RATE_LIMIT row, unchanged)
--
-- PURPOSE: give each AI feature its own allowance bucket instead of one shared
--   counter per user.
--
--   F227 built AI_GENERATION_RATE_LIMIT as one row per user, shared across every
--   Gemini feature. That was right when every feature was a *generation* — a
--   booklet, a Stage 1 draft, a Stage 2 draft — all of them deliberate, expensive
--   and rare. Natural language search is none of those: it is something a CAM
--   does dozens of times in an afternoon while working a list.
--
--   Left on the shared counter, a CAM who searches twenty times would find they
--   could no longer generate a booklet for the rest of the hour. That is a live
--   regression to two shipped features caused by a third, so search gets its own
--   bucket with its own, tighter, daily limit.
--
--   The bucket also makes the cost ceiling legible per feature: search's worst
--   case is (users x search limit x $0.0006/search) and cannot borrow from
--   anyone else's headroom.
--
-- Schema change approval record (SOP §7):
--   Change        | Add AI_GENERATION_RATE_LIMIT.bucket (text, default 'generation');
--                 | replace the unique key on (user_id) with (user_id, bucket);
--                 | add a 4-argument consume_ai_generation_allowance overload.
--   Reason        | F214 — a per-search counter must not consume the booklet/draft
--                 | allowance created by F227.
--   Compatibility | Backwards compatible. Existing rows default to 'generation',
--                 | which is the bucket the retained 3-argument function uses, so
--                 | every existing caller keeps its exact current behaviour and
--                 | its accumulated count.
--   Data migration| None beyond the column default.
--   Security      | Unchanged. RLS already on; admin SELECT only; the new overload
--                 | is SECURITY DEFINER and executable by service_role alone,
--                 | exactly like the function it sits beside.
--   Documentation | Data Model tab 04 — AI_GENERATION_RATE_LIMIT gains one column.
--   Approved by   | Bashir (Project Leader), 9 Sep 2026 — SOP §7.
--
-- Reversibility: paired rollback in
--   ../rollback/20260925090000_add_rate_limit_bucket.down.sql

alter table public.ai_generation_rate_limit
  add column if not exists bucket text not null default 'generation';

comment on column public.ai_generation_rate_limit.bucket is
  'Which AI feature this counter is for: ''generation'' (F082/F100 booklets and drafts, '
  'the F227 original) or ''search'' (F214 natural language search). Separate buckets so '
  'a cheap high-frequency feature cannot exhaust an expensive low-frequency one.';

-- One row per user *per bucket* from here on. The old single-column unique key
-- is what forced every feature to share a counter.
alter table public.ai_generation_rate_limit
  drop constraint if exists ai_generation_rate_limit_user_id_key;

alter table public.ai_generation_rate_limit
  add constraint ai_generation_rate_limit_user_bucket_key unique (user_id, bucket);

-- ---------------------------------------------------------------------------
-- The bucketed function. Body is F227's, with the bucket threaded through the
-- upsert's conflict target; the fixed-window arithmetic is deliberately
-- untouched so the two allowances behave identically apart from their key.
-- ---------------------------------------------------------------------------
create or replace function public.consume_ai_generation_allowance(
  p_user_id uuid,
  p_limit integer,
  p_window_seconds integer,
  p_bucket text
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
  v_bucket text := coalesce(nullif(btrim(p_bucket), ''), 'generation');
begin
  if p_limit < 1 or p_window_seconds < 1 then
    raise exception 'Invalid rate limit configuration' using errcode = '22023';
  end if;

  if not exists (select 1 from public.users where id = p_user_id and is_active) then
    raise exception 'Active user not found' using errcode = '42501';
  end if;

  v_window := make_interval(secs => p_window_seconds);

  insert into public.ai_generation_rate_limit (
    user_id, bucket, request_count, window_started_at, created_at, updated_at
  ) values (p_user_id, v_bucket, 1, now(), now(), now())
  on conflict (user_id, bucket) do update
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

comment on function public.consume_ai_generation_allowance(uuid, integer, integer, text) is
  'F214 atomically consumes one user allowance from a named bucket. Returns null when '
  'allowed or the fixed-window reset timestamp when blocked. The 3-argument overload '
  'delegates here with bucket ''generation''.';

revoke execute on function public.consume_ai_generation_allowance(uuid, integer, integer, text) from public;
revoke execute on function public.consume_ai_generation_allowance(uuid, integer, integer, text) from anon;
revoke execute on function public.consume_ai_generation_allowance(uuid, integer, integer, text) from authenticated;
grant execute on function public.consume_ai_generation_allowance(uuid, integer, integer, text) to service_role;

-- ---------------------------------------------------------------------------
-- The original 3-argument signature stays, now a thin delegation. Rewriting the
-- four existing call sites instead would have been a wider change for no gain,
-- and leaving two copies of the window arithmetic to drift apart would be worse
-- than either.
-- ---------------------------------------------------------------------------
create or replace function public.consume_ai_generation_allowance(
  p_user_id uuid,
  p_limit integer,
  p_window_seconds integer
)
returns timestamptz
language sql
security definer
set search_path = public, pg_temp
as $$
  select public.consume_ai_generation_allowance(p_user_id, p_limit, p_window_seconds, 'generation');
$$;

comment on function public.consume_ai_generation_allowance(uuid, integer, integer) is
  'F227 atomically consumes one user AI-generation allowance. Returns null when allowed '
  'or the fixed-window reset timestamp when blocked. Delegates to the 4-argument '
  'overload with bucket ''generation'' (F214).';

revoke execute on function public.consume_ai_generation_allowance(uuid, integer, integer) from public;
revoke execute on function public.consume_ai_generation_allowance(uuid, integer, integer) from anon;
revoke execute on function public.consume_ai_generation_allowance(uuid, integer, integer) from authenticated;
grant execute on function public.consume_ai_generation_allowance(uuid, integer, integer) to service_role;
