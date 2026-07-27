-- RLS coverage gate — F224 (#224), migration sequence step 15.
-- Spec: docs/rls-permission-matrix.md §5 test 12.
--
-- Step 15 (`enable_rls_policies`) is a verification pass, not the place RLS is
-- introduced: policies land in the same migration as their table (SOP §7,
-- decision of 21 Jul 2026). This script is that pass, and it runs on every
-- migration rather than once at the end — a table that ships without RLS is
-- readable by every authenticated user for as long as it takes anyone to notice.
--
-- Raises an exception on failure so `psql -v ON_ERROR_STOP=1` fails the build.
-- Passes trivially while the schema is still empty.
--
-- Escape hatch: a table may opt out with a comment beginning 'RLS-EXEMPT:' and a
-- reason. It shows up in the diff, so the exemption is reviewed like any other
-- change rather than being silently absent.
--   comment on table public.some_table is 'RLS-EXEMPT: reference data, no rows are user-specific';

\set ON_ERROR_STOP on

do $$
declare
  v_no_rls    text;
  v_no_policy text;
  v_to_public  text;
  v_anon_grants text;
  v_bad_views  text;
  v_checked   int;
begin
  select count(*) into v_checked
    from pg_tables t
   where t.schemaname = 'public'
     and coalesce(obj_description(format('public.%I', t.tablename)::regclass, 'pg_class'), '')
           not like 'RLS-EXEMPT:%';

  -- 1. RLS enabled on every table.
  select string_agg(t.tablename, ', ' order by t.tablename)
    into v_no_rls
    from pg_tables t
   where t.schemaname = 'public'
     and t.rowsecurity = false
     and coalesce(obj_description(format('public.%I', t.tablename)::regclass, 'pg_class'), '')
           not like 'RLS-EXEMPT:%';

  -- 2. At least one policy. RLS on with zero policies denies everyone except
  --    service_role, which usually means the policies were forgotten rather than
  --    that total lockout was intended.
  select string_agg(t.tablename, ', ' order by t.tablename)
    into v_no_policy
    from pg_tables t
   where t.schemaname = 'public'
     and t.rowsecurity = true
     and not exists (
       select 1 from pg_policies p
        where p.schemaname = t.schemaname and p.tablename = t.tablename)
     and coalesce(obj_description(format('public.%I', t.tablename)::regclass, 'pg_class'), '')
           not like 'RLS-EXEMPT:%';

  -- 3. No policy granted to PUBLIC. PUBLIC includes anon, and public self-sign-up
  --    is prohibited (PRD §4.2). Policies are written `to authenticated`.
  select string_agg(format('%s.%s', p.tablename, p.policyname), ', ' order by p.tablename, p.policyname)
    into v_to_public
    from pg_policies p
   where p.schemaname = 'public'
     and (p.roles = '{public}' or 'public' = any(p.roles));

  -- 4. No table privileges for `anon`. Supabase's default privileges grant ALL on
  --    every new public table to anon and authenticated, so a migration that omits
  --    `revoke all on public."X" from anon, authenticated;` leaves the table exposed
  --    to the public API key with only RLS in the way. See matrix §2.1 — this is the
  --    check that would have caught the 22 Jul privilege escalation at review time.
  select string_agg(distinct format('%s (%s)', c.relname, g.privilege_type), ', ')
    into v_anon_grants
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    cross join lateral (
      select unnest(array['SELECT','INSERT','UPDATE','DELETE']) as privilege_type
    ) g
   where n.nspname = 'public'
     and c.relkind = 'r'
     and has_table_privilege('anon', c.oid, g.privilege_type);

  -- 5. Views over RLS-protected tables must be security_invoker, or they run with
  --    the definer's rights and return rows the caller could not select directly.
  select string_agg(c.relname, ', ' order by c.relname)
    into v_bad_views
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relkind = 'v'
     and coalesce(
           (select option_value from pg_options_to_table(c.reloptions)
             where option_name = 'security_invoker'), 'false') <> 'true';

  if v_no_rls is not null then
    raise exception E'RLS coverage gate failed.\nTables without row-level security enabled: %\nAdd `alter table ... enable row level security;` and its policies to the migration that creates the table (SOP §7).', v_no_rls;
  end if;

  if v_no_policy is not null then
    raise exception E'RLS coverage gate failed.\nTables with RLS enabled but no policies: %\nThese are unreadable by every role except service_role. Add the policies from docs/rls-permission-matrix.md, or mark the table RLS-EXEMPT with a reason.', v_no_policy;
  end if;

  if v_to_public is not null then
    raise exception E'RLS coverage gate failed.\nPolicies granted TO PUBLIC (which includes anon): %\nRewrite as `to authenticated`.', v_to_public;
  end if;

  if v_anon_grants is not null then
    raise exception E'RLS coverage gate failed.\nThe anon role holds table privileges on: %\nSupabase grants ALL on new public tables to anon and authenticated by default. Start the table''s security block with `revoke all on public.<table> from anon, authenticated;` and grant back only what docs/rls-permission-matrix.md allows.', v_anon_grants;
  end if;

  if v_bad_views is not null then
    raise exception E'RLS coverage gate failed.\nViews that are not security_invoker: %\nRecreate with `with (security_invoker = on)`, or they bypass the policies of every table they read.', v_bad_views;
  end if;

  raise notice 'RLS coverage gate passed: % table(s) checked, all with RLS enabled and at least one policy.', v_checked;
end;
$$;
