-- Migration: create_login_attempt
-- Sequence: addition to the Data Model migration sequence (not one of the original 17).
--   Standalone: no FK to public.users, deliberately (see below). Needs pgcrypto only.
-- Stories: F227 Rate Limiting (#222) AC1/AC2 for the login half — per-account throttling,
--   the control the F003 CAPTCHA does not provide. Email-send and AI-generation limits,
--   also in AC1, are NOT covered here. AC3 (thresholds configurable without a code change)
--   is NOT met: the numbers are the two immutable functions below.
-- Spec: docs/rls-permission-matrix.md §3.10
--
-- WHY THIS EXISTS ALONGSIDE THE CAPTCHA:
--   Turnstile prices a *scripted* flood. It does nothing about a patient attacker
--   guessing one account's password, because every attempt carries a freshly solved
--   token — and Supabase's own limits are per-IP (30 sign-ins / 5 min), which is the
--   wrong axis for a targeted guess and useless against a distributed one. This table
--   counts failures per account so the Nth wrong password costs wall-clock time.
--
-- WHY AN EMAIL HASH AND NO FK:
--   The submitted address is whatever the caller typed, so most rows in an attack name
--   accounts that do not exist. A FK would therefore be impossible, and storing the raw
--   strings would turn a security table into a log of who tried to sign in (PRD §15 data
--   minimisation). A digest is enough: the app only ever asks "how has *this* address
--   been doing", never "list the addresses".
--
-- WHY IT CANNOT LEAK ACCOUNT EXISTENCE:
--   Nothing here reads public.users or auth.users. An unknown address is counted and
--   blocked exactly like a real one, so the throttle's timing and messages are identical
--   either way and cannot be used to enumerate accounts.
--
-- Schema change approval record (SOP §7):
--   Change        | Add LOGIN_ATTEMPT table + 3 SECURITY DEFINER RPCs
--   Reason        | F227: the F003 CAPTCHA alone does not throttle per-account guessing.
--   Compatibility | New table, no FKs, no impact on existing streams. Written only by
--                 | the login Server Action through service_role.
--   Data migration| None.
--   Security      | RLS on; SELECT admin-only; no write policy for any role. anon holds
--                 | no privilege on the table and cannot execute the RPCs.
--   Documentation | Data Model tabs 02, 08 and 11 (step 18.0) updated 30 Jul 2026;
--                 | exported to docs/data-model/. Matrix row: §3.10.
--
-- Reversibility: paired rollback in ../rollback/20260730010000_create_login_attempt.down.sql

create table public.login_attempt (
  id               uuid primary key default gen_random_uuid(),
  -- sha256 of the normalised (trimmed, lowercased) email. Unique so the counter can be
  -- a single upsert: concurrent failed logins for one address must not race into two rows,
  -- which would halve the effective count and double the attempts an attacker gets.
  email_hash       text not null unique,
  failures         integer not null default 0,
  -- Start of the counting window. Failures older than the window do not accumulate, so a
  -- user who mistypes twice today and twice next week is never throttled.
  window_started_at timestamptz not null default now(),
  -- When set and in the future, login is refused before any credential is checked.
  blocked_until    timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

comment on table public.login_attempt is
  'Per-account failed-login counter behind the F227 login throttle. Keyed by a sha256 of '
  'the submitted email, never the address itself, and holding no FK — most rows in an '
  'attack name accounts that do not exist. Written only via the SECURITY DEFINER RPCs '
  'below, called by the login Server Action as service_role.';
comment on column public.login_attempt.email_hash is
  'sha256 hex of the trimmed, lowercased submitted email. Not reversible in bulk and not '
  'joinable to a user, which is the point: the app only ever probes a single address.';
comment on column public.login_attempt.blocked_until is
  'Null or past = attempts allowed. Future = refused before the password is checked.';

-- The only access pattern is by hash; the unique constraint above already indexes it.
-- This one supports the sweep in prune_login_attempts.
create index login_attempt_window_idx on public.login_attempt (window_started_at);

-- Privileges — revoke first (matrix §2.1). No role gets a write: every mutation runs
-- through the SECURITY DEFINER functions below. authenticated gets SELECT, gated to
-- admins by policy, so an admin can see whether an account is currently locked out.
revoke all on public.login_attempt from anon, authenticated;
grant select on public.login_attempt to authenticated;

alter table public.login_attempt enable row level security;

create policy login_attempt_select_admin on public.login_attempt
  for select to authenticated
  using (app.is_admin());

-- No INSERT / UPDATE / DELETE policy, by design: the RPCs below bypass RLS as the table
-- owner, and nothing else may write. A user who could reset their own counter could
-- brute-force freely.


-- ---------------------------------------------------------------------------
-- Throttle policy, in one place so the numbers are not scattered across SQL and TS.
--
--   window     15 min  — failures stop accumulating after this much quiet
--   free       5       — wrong passwords allowed before any delay (fat fingers, an old
--                        saved password, a password manager filling the wrong entry)
--   delay      30s doubling per failure past the 5th, capped at 15 min
--
-- Deliberately a *delay*, not a lockout. Anyone can drive a known address's counter up
-- by submitting wrong passwords, so a permanent lock would hand an attacker a way to
-- keep a real user out — the classic account-lockout denial of service. A capped,
-- self-clearing delay makes guessing expensive without ever removing someone's access.
-- ---------------------------------------------------------------------------

create or replace function public.login_throttle_window()
returns interval language sql immutable as $$ select interval '15 minutes' $$;

create or replace function public.login_throttle_free_attempts()
returns integer language sql immutable as $$ select 5 $$;

comment on function public.login_throttle_window() is
  'F227 throttle: how long failures accumulate for. Single source of truth, read by the '
  'RPCs below rather than repeated in each.';


-- Read-only probe, called before the password is checked.
create or replace function public.login_throttle_state(p_email text)
returns timestamptz
language sql
security definer
set search_path = ''
as $$
  select a.blocked_until
    from public.login_attempt a
   where a.email_hash = encode(
           extensions.digest(lower(trim(p_email)), 'sha256'), 'hex')
     and a.blocked_until is not null
     and a.blocked_until > now();
$$;

comment on function public.login_throttle_state(text) is
  'F227: returns when the given address may next attempt a login, or null if now. '
  'SECURITY DEFINER because no end-user role may read login_attempt directly. Reads no '
  'user table, so it cannot reveal whether the account exists.';


-- Records one failure and returns the block it earned, if any.
create or replace function public.record_login_failure(p_email text)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash      text := encode(extensions.digest(lower(trim(p_email)), 'sha256'), 'hex');
  v_window    interval := public.login_throttle_window();
  v_free      integer  := public.login_throttle_free_attempts();
  v_failures  integer;
  v_blocked   timestamptz;
begin
  -- A failure outside the window starts the record over rather than adding to a stale
  -- one. All three fields roll together, and `blocked_until` is the one that matters:
  -- a block belongs to the window that earned it. A block earned late in a window
  -- outlives that window (the window is 15 min and so is the longest block), so
  -- resetting the count while leaving the timestamp would strand an account — refused
  -- by login_throttle_state for up to 15 more minutes while its row claims one failure,
  -- and never re-extended, because a count below the free allowance sets no new block.
  -- The whole condition is repeated per column because SET has no way to alias it.
  insert into public.login_attempt (email_hash, failures, window_started_at, updated_at)
  values (v_hash, 1, now(), now())
  on conflict (email_hash) do update
     set failures = case
                      when public.login_attempt.window_started_at < now() - v_window
                        then 1
                      else public.login_attempt.failures + 1
                    end,
         window_started_at = case
                      when public.login_attempt.window_started_at < now() - v_window
                        then now()
                      else public.login_attempt.window_started_at
                    end,
         blocked_until = case
                      when public.login_attempt.window_started_at < now() - v_window
                        then null
                      else public.login_attempt.blocked_until
                    end,
         updated_at = now()
  returning failures into v_failures;

  if v_failures <= v_free then
    return null;
  end if;

  v_blocked := now() + least(
    (interval '30 seconds') * power(2, v_failures - v_free - 1),
    interval '15 minutes'
  );

  update public.login_attempt
     set blocked_until = v_blocked, updated_at = now()
   where email_hash = v_hash;

  return v_blocked;
end;
$$;

comment on function public.record_login_failure(text) is
  'F227: counts one failed login for the given address and returns the resulting block '
  'time, or null while inside the free allowance. Called by the login Server Action as '
  'service_role after Supabase rejects the credentials.';


-- Clears the counter after a successful sign-in.
create or replace function public.clear_login_failures(p_email text)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.login_attempt
   where email_hash = encode(
           extensions.digest(lower(trim(p_email)), 'sha256'), 'hex');
$$;

comment on function public.clear_login_failures(text) is
  'F227: forgets an address''s failures after it signs in successfully. Deletes rather '
  'than zeroes — a row with no failures carries no information worth keeping.';


-- Housekeeping. Rows whose window has long closed are dead weight; without this the
-- table grows for the lifetime of the project, one row per address ever mistyped.
create or replace function public.prune_login_attempts()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  delete from public.login_attempt
   where window_started_at < now() - interval '30 days'
     and (blocked_until is null or blocked_until <= now());
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

comment on function public.prune_login_attempts() is
  'F227 housekeeping: drops throttle rows whose window closed over 30 days ago. Safe to '
  'call from a scheduled job; keeps only rows that are live or recent.';


-- Execute grants. EXECUTE defaults to PUBLIC on create and Supabase additionally
-- default-grants it to anon and authenticated, so all three are revoked explicitly.
--
-- service_role only, and that is the security-relevant decision here. Exposing
-- record_login_failure to anon would let anyone inflate any address's counter over the
-- REST API without solving a CAPTCHA — cheaper than the login form it protects, and a
-- ready-made way to keep a chosen user delayed. The login Server Action is the only
-- caller and it holds the service-role key server-side.
do $$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'public.login_throttle_state(text)',
    'public.record_login_failure(text)',
    'public.clear_login_failures(text)',
    'public.prune_login_attempts()',
    'public.login_throttle_window()',
    'public.login_throttle_free_attempts()'
  ]
  loop
    execute format('revoke execute on function %s from public', v_fn);
    execute format('revoke execute on function %s from anon', v_fn);
    execute format('revoke execute on function %s from authenticated', v_fn);
    execute format('grant execute on function %s to service_role', v_fn);
  end loop;
end;
$$;
