-- Migration: configurable_signup_domains
-- Sequence: addition (after enforce_180dc_email_trigger; needs the app schema).
--   Not a numbered step — replaces the body of an existing guard and adds a table
--   in `app`, which Data Model tab 11 does not sequence (it sequences public entities).
-- Story: F008 Invite New CAM — the flow cannot be tested end to end while every
--   address outside one domain is unreachable, and the team currently holds no
--   @180dc.org mailbox at all.
-- Supersedes the hardcoded check in 20260726112609_enforce_180dc_email_trigger.sql.
--
-- WHAT WAS WRONG WITH THE OLD ONE:
--   `if user_email not ilike '%@180dc.org'` — the domain was a literal in a function
--   body, so widening it for a staging test meant editing a security control and
--   deploying it everywhere, or making an untracked manual change to a live database.
--   Neither is acceptable (MIGRATIONS.md). Meanwhile AUTH_ALLOWED_EMAIL_DOMAIN exists
--   in `src/lib/env.ts` and *looks* like the knob for this, but only governs the
--   application's own validation — set it to anything else and sign-up still failed
--   here, with a P0001 that reads like a bug.
--
-- WHY A TABLE AND NOT A SETTING:
--   `current_setting('app.allowed_domains')` would work and is less code, but it is
--   invisible: nobody can see what an environment permits without knowing to look for
--   a GUC nobody documented, and its behaviour under connection pooling is one more
--   thing to reason about. A table can be read, diffed and backed up like anything
--   else, and `select * from app.allowed_email_domains` answers the question.
--
-- IT FAILS CLOSED, TWICE OVER:
--   An empty table permits nothing — sign-up stops entirely rather than opening up.
--   And an environment that is never configured keeps only the seeded row below, so
--   production is locked to 180dc.org by default and stays locked without anyone
--   having to remember to re-lock it at the end of the project. Widening is a
--   deliberate, visible INSERT against one environment; narrowing is the default.
--
-- Schema change approval record (SOP §7):
--   Change        | Add app.allowed_email_domains; replace check_180dc_email_domain()
--                 | with check_allowed_email_domain(), which reads it.
--   Reason        | F008 cannot be tested with no reachable mailbox. Staging needs to
--                 | permit additional domains without a code change; production must
--                 | stay restricted by default.
--   Compatibility | Behaviour-preserving on any environment that does not add a row:
--                 | the seeded 180dc.org reproduces the previous rule exactly. The old
--                 | trigger and function are dropped, so there is one guard, not two.
--   Data migration| One seeded row, 180dc.org.
--   Security      | Table in `app`, which PostgREST does not expose. RLS enabled with
--                 | no policies — deny-all; the trigger reads it as SECURITY DEFINER.
--                 | No grants to anon or authenticated.
--   Documentation | docs/rls-permission-matrix.md §2, docs/auth/invite-email.md.
--                 | No Data Model tab change — `app` is not an application entity.
--                 | Approved by Bashir (Project Leader), 4 Aug 2026.
--
-- Reversibility: paired rollback in ../rollback/20260804110000_configurable_signup_domains.down.sql

create table if not exists app.allowed_email_domains (
  -- Stored bare and lower case: '180dc.org', never '@180dc.org' or 'FOO.ORG'.
  -- The check keeps the table itself honest so the trigger does not have to
  -- normalise on every insert into auth.users.
  domain     text primary key
             check (domain = lower(btrim(domain)) and domain !~ '@' and domain ~ '\.'),
  -- Why this domain is permitted, and — for anything that is not 180DC's own — when
  -- it should go. An entry nobody can explain is an entry nobody dares remove.
  note       text,
  created_at timestamptz not null default now()
);

comment on table app.allowed_email_domains is
  'Email domains permitted to hold an account (F008). Read by '
  'public.check_allowed_email_domain() on every auth.users insert. Empty means no '
  'sign-up is possible — the guard fails closed. Production holds 180dc.org alone; '
  'staging may hold more, added by hand and removed when the testing that needed '
  'them is done.';
comment on column app.allowed_email_domains.note is
  'Why this domain is here. Required in spirit for anything that is not 180DC''s own.';

-- Deny-all. The table is in `app`, which PostgREST does not expose, and the only
-- reader is a SECURITY DEFINER function that runs as the owner and so bypasses this.
-- scripts/verify-rls-coverage.sql checks `public` only, so a policy-free table here
-- is a deliberate lockout rather than a gap the gate will flag.
alter table app.allowed_email_domains enable row level security;

revoke all on app.allowed_email_domains from public, anon, authenticated;

-- The rule as it stood before this migration. Seeded rather than assumed: an empty
-- table denies everyone, so this row is what keeps every existing environment working.
insert into app.allowed_email_domains (domain, note)
values ('180dc.org', '180 Degrees Consulting. The permanent entry — do not remove.')
on conflict (domain) do nothing;

-- ---------------------------------------------------------------------------
-- The guard
-- ---------------------------------------------------------------------------
create or replace function public.check_allowed_email_domain()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email  text := lower(pg_catalog.btrim(new.email));
  v_domain text;
begin
  -- Exactly one '@', with something either side. The old check was
  -- `ilike '%@180dc.org'`, which accepts 'attacker@evil.com@180dc.org' — and so
  -- would any version that simply reads what follows the *last* '@'. An address
  -- with two of them is malformed, not an address on the second domain. GoTrue
  -- would reject it first on its own paths; this trigger also guards raw SQL and
  -- the admin API, where nothing else would.
  if v_email is null
     or pg_catalog.array_length(pg_catalog.string_to_array(v_email, '@'), 1) <> 2
     or pg_catalog.split_part(v_email, '@', 1) = ''
     or pg_catalog.split_part(v_email, '@', 2) = ''
  then
    raise exception 'A valid email address is required.'
      using errcode = 'P0001', hint = 'email_malformed';
  end if;

  v_domain := pg_catalog.split_part(v_email, '@', 2);

  if not exists (
    select 1 from app.allowed_email_domains where domain = v_domain
  ) then
    -- The message names the domains rather than one hardcoded string, so a staging
    -- tester refused on a domain someone removed can see what is actually permitted.
    raise exception 'Email domain % is not permitted. Allowed: %',
      v_domain,
      coalesce(
        (select pg_catalog.string_agg(domain, ', ' order by domain)
           from app.allowed_email_domains),
        '(none — sign-up is disabled)'
      )
      using errcode = 'P0001', hint = 'email_domain_not_allowed';
  end if;

  return new;
end;
$$;

comment on function public.check_allowed_email_domain() is
  'F008: refuses an auth.users insert whose email domain is not in '
  'app.allowed_email_domains. Replaces check_180dc_email_domain(), which hardcoded '
  '180dc.org. SECURITY DEFINER so it can read a table granted to no one; fails closed '
  'when the table is empty. Fires on every sign-up path — hook, admin API and raw SQL '
  'alike — which is why it is a trigger rather than an auth hook.';

-- Swap the trigger over, then retire the old function. Dropped rather than left in
-- place: two functions enforcing the same rule is how they drift apart.
drop trigger if exists enforce_180dc_domain_on_signup on auth.users;

create trigger enforce_allowed_email_domain_on_signup
  before insert on auth.users
  for each row
  execute function public.check_allowed_email_domain();

drop function if exists public.check_180dc_email_domain();

-- The no-argument, trigger-shaped version from 20260726101730. Never attached to
-- anything (see that migration's header), superseded twice over, and dropping it
-- leaves one fewer copy of the rule to drift. The `()` targets that overload alone —
-- the jsonb one below is a separate function as far as Postgres is concerned.
drop function if exists public.restrict_signup_domain();

-- ---------------------------------------------------------------------------
-- The auth-hook overload
-- ---------------------------------------------------------------------------
-- `public.restrict_signup_domain(event jsonb)` (20260726110410) is the "before user
-- created" hook shape. `auth.hook.before_user_created` is commented out in
-- config.toml, so it is off locally — but that file does not describe what a hosted
-- project has enabled in its dashboard, and this function hardcodes '%@180dc.org'
-- exactly as the trigger used to.
--
-- Left alone, it is a second gate on the same door with a different key: if the hook
-- is enabled anywhere, adding a domain to the table below would appear to do nothing,
-- and the error would name a domain restriction that the table says is permitted.
-- Pointed at the same table, the two agree whether the hook is on or off.
create or replace function public.restrict_signup_domain(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email  text;
  v_domain text;
begin
  v_email := lower(pg_catalog.btrim(event -> 'user' ->> 'email'));
  v_domain := case
    when v_email is not null
     and pg_catalog.array_length(pg_catalog.string_to_array(v_email, '@'), 1) = 2
     and pg_catalog.split_part(v_email, '@', 1) <> ''
    then pg_catalog.split_part(v_email, '@', 2)
  end;

  if v_domain is null or v_domain = '' or not exists (
    select 1 from app.allowed_email_domains where domain = v_domain
  ) then
    return jsonb_build_object(
      'error', jsonb_build_object(
        'http_code', 400,
        'message', 'That email domain is not permitted.'
      )
    );
  end if;

  return jsonb_build_object();
end;
$$;

comment on function public.restrict_signup_domain(jsonb) is
  'Before-user-created auth hook, kept in step with public.check_allowed_email_domain() '
  'so the two cannot disagree about which domains are permitted. The trigger is what '
  'actually enforces the rule on every path; this only matters where the hook is '
  'enabled. Retire both together, or neither.';
