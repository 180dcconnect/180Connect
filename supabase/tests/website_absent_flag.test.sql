-- website_absent_flag tests (20261018090000). Run by `supabase test db`.
--
-- The mark is "this client has no website", which is what stops the
-- incomplete-records queue counting an empty website column as a gap. Four things
-- have to hold, and each one is a test below: only an admin can set it, a client
-- that HAS a website cannot be marked, the mark clears itself the moment a website
-- arrives, and the two writes are audited.
--
-- Runs as real end-user roles: the RPC is SECURITY DEFINER, so testing it as a
-- superuser would exercise a code path no user can reach.

begin;

create extension if not exists pgtap with schema extensions;

select no_plan();

create schema if not exists tests;

create or replace function tests.login_as(p_user_id uuid)
returns void language plpgsql as $$
begin
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', p_user_id::text, 'role', 'authenticated')::text,
    true  -- local: reset at transaction end
  );
  execute 'set local role authenticated';
end;
$$;

-- No tests.logout() helper: while impersonating, the session IS `authenticated`,
-- which has no USAGE on schema `tests`, so it could not call one. Dropping back is
-- inlined at each call site (same shape as list_restrictable_edit_fields.test.sql).
create or replace function tests.sqlstate_of(p_user_id uuid, p_sql text)
returns text language plpgsql as $$
declare v_state text;
begin
  perform tests.login_as(p_user_id);
  begin
    execute p_sql;
    v_state := null;
  exception when others then
    v_state := sqlstate;
  end;
  execute 'reset role';
  perform set_config('request.jwt.claims', null, true);
  return v_state;
end;
$$;

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

insert into auth.users (id, instance_id, aud, role, email)
values
  ('00000000-0000-4000-d400-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'wa-admin@180dc.org'),
  ('00000000-0000-4000-d400-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'wa-cam@180dc.org'),
  ('00000000-0000-4000-d400-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'wa-cam2@180dc.org')
on conflict (id) do nothing;

insert into public.users (id, email, full_name, role, is_active)
values
  ('00000000-0000-4000-d400-000000000001', 'wa-admin@180dc.org', 'WA Admin', 'admin', true),
  ('00000000-0000-4000-d400-000000000002', 'wa-cam@180dc.org',   'WA CAM',   'cam',   true),
  ('00000000-0000-4000-d400-000000000003', 'wa-cam2@180dc.org',  'WA CAM 2', 'cam',   true)
on conflict (id) do update
  set role = excluded.role,
      is_active = excluded.is_active,
      full_name = excluded.full_name;

insert into public.organisations (id, legal_name, entry_method, organisation_type, outreach_status)
values
  -- No website: the record the mark exists for.
  ('00000000-0000-4000-d400-000000000101', 'WA No Website',    'manual', 'charity', 'not_contacted'),
  -- Has a website: marking it as having none must be refused.
  ('00000000-0000-4000-d400-000000000102', 'WA Has Website',   'manual', 'charity', 'not_contacted')
on conflict (id) do nothing;

update public.organisations
   set website = 'https://has-website.example.org'
 where id = '00000000-0000-4000-d400-000000000102';

-- ---------------------------------------------------------------------------
-- Who may set it
-- ---------------------------------------------------------------------------

select is(
  tests.sqlstate_of('00000000-0000-4000-d400-000000000002',
    $q$select public.set_website_absent('00000000-0000-4000-d400-000000000101', true)$q$),
  '42501',
  'a CAM cannot record that a client has no website'
);

select is(
  tests.sqlstate_of('00000000-0000-4000-d400-000000000001',
    $q$select public.set_website_absent('00000000-0000-4000-d400-000000000101', true)$q$),
  null,
  'an admin can record that a client has no website'
);

select ok(
  (select website_absent_at is not null
      and website_absent_by = '00000000-0000-4000-d400-000000000001'
     from public.organisations
    where id = '00000000-0000-4000-d400-000000000101'),
  'the mark records who made it and when'
);

select is(
  (select count(*) from public.audit_log
    where action = 'website_marked_absent'
      and target_id = '00000000-0000-4000-d400-000000000101'),
  1::bigint,
  'recording the mark writes one audit row'
);

-- A second identical call is not a transition, so it adds nothing to the trail.
select is(
  tests.sqlstate_of('00000000-0000-4000-d400-000000000001',
    $q$select public.set_website_absent('00000000-0000-4000-d400-000000000101', true)$q$),
  null,
  'recording the mark twice is accepted'
);

select is(
  (select count(*) from public.audit_log where action = 'website_marked_absent'),
  1::bigint,
  'a no-op mark is not audited again'
);

-- ---------------------------------------------------------------------------
-- A website on file always wins
-- ---------------------------------------------------------------------------

select is(
  tests.sqlstate_of('00000000-0000-4000-d400-000000000001',
    $q$select public.set_website_absent('00000000-0000-4000-d400-000000000102', true)$q$),
  '23514',
  'a client that already has a website cannot be marked as having none'
);

-- The undo an admin has instead of a second button: add a website. The trigger
-- clears the mark for every writer, so this is the same path the pipeline takes.
update public.organisations
   set website = 'https://found-later.example.org'
 where id = '00000000-0000-4000-d400-000000000101';

select ok(
  (select website_absent_at is null and website_absent_by is null
     from public.organisations
    where id = '00000000-0000-4000-d400-000000000101'),
  'adding a website clears the mark'
);

-- ---------------------------------------------------------------------------
-- The columns are not directly writable
-- ---------------------------------------------------------------------------

update public.organisations
   set website = null
 where id = '00000000-0000-4000-d400-000000000101';

select is(
  tests.sqlstate_of('00000000-0000-4000-d400-000000000001',
    $q$update public.organisations
          set website_absent_at = now(),
              website_absent_by = '00000000-0000-4000-d400-000000000001'
        where id = '00000000-0000-4000-d400-000000000101'$q$),
  '42501',
  'even an admin cannot set the mark by a direct update — the RPC is the only door'
);

-- ---------------------------------------------------------------------------
-- Taking it back
-- ---------------------------------------------------------------------------

-- The trigger cleared the original mark when a website arrived, so mark it again
-- to put the record back where an admin deciding to undo would find it.
select is(
  tests.sqlstate_of('00000000-0000-4000-d400-000000000001',
    $q$select public.set_website_absent('00000000-0000-4000-d400-000000000101', true)$q$),
  null,
  'the mark can be recorded again once the website is gone'
);

select is(
  tests.sqlstate_of('00000000-0000-4000-d400-000000000001',
    $q$select public.set_website_absent('00000000-0000-4000-d400-000000000101', false)$q$),
  null,
  'an admin can put the client back on the website list'
);

select ok(
  (select website_absent_at is null and website_absent_by is null
     from public.organisations
    where id = '00000000-0000-4000-d400-000000000101'),
  'taking the mark back empties both halves of it'
);

select is(
  (select count(*) from public.audit_log
    where action = 'website_absent_cleared'
      and target_id = '00000000-0000-4000-d400-000000000101'),
  1::bigint,
  'taking the mark back is audited too'
);

select is(
  tests.sqlstate_of('00000000-0000-4000-d400-000000000001',
    $q$select public.set_website_absent('00000000-0000-4000-d400-00000000dead', true)$q$),
  'P0002',
  'an unknown client is refused'
);

select ok(
  not has_function_privilege('anon', 'public.set_website_absent(uuid, boolean)', 'execute'),
  'anon cannot call set_website_absent'
);

-- ---------------------------------------------------------------------------
-- A CAM proposes it, an admin confirms it
-- ---------------------------------------------------------------------------
--
-- The CAM's route to the same mark: they cannot write the column, so the claim
-- goes into the queue an admin already works, and nothing on the record changes
-- until that admin decides.

select is(
  tests.sqlstate_of('00000000-0000-4000-d400-000000000002',
    $q$select public.suggest_website_absent('00000000-0000-4000-d400-000000000101', 'Rang them — no website.')$q$),
  null,
  'a CAM can propose that a client has no website'
);

select ok(
  (select proposed_absent and field_name = 'website' and proposed_value = '' and status = 'pending'
     from public.edit_suggestions
    where organisation_id = '00000000-0000-4000-d400-000000000101'),
  'the proposal is stored as a claim about the field, not a value'
);

select ok(
  (select website_absent_at is null
     from public.organisations
    where id = '00000000-0000-4000-d400-000000000101'),
  'the proposal on its own changes nothing on the record'
);

select is(
  tests.sqlstate_of('00000000-0000-4000-d400-000000000001',
    $q$select public.suggest_website_absent('00000000-0000-4000-d400-000000000101')$q$),
  '42501',
  'an admin records the mark rather than proposing it'
);

select is(
  tests.sqlstate_of('00000000-0000-4000-d400-000000000003',
    $q$select public.suggest_website_absent('00000000-0000-4000-d400-000000000101')$q$),
  '23505',
  'a second CAM cannot pile a proposal onto the same field'
);

select is(
  tests.sqlstate_of('00000000-0000-4000-d400-000000000001',
    $q$select public.decide_edit_suggestion(
         (select id from public.edit_suggestions
           where organisation_id = '00000000-0000-4000-d400-000000000101'
             and status = 'pending'),
         true
       )$q$),
  null,
  'an admin can approve the proposal'
);

select ok(
  (select website_absent_at is not null
      and website_absent_by = '00000000-0000-4000-d400-000000000001'
      and website is null
     from public.organisations
    where id = '00000000-0000-4000-d400-000000000101'),
  'approval records the mark and leaves the website column empty'
);

select ok(
  not has_function_privilege('anon', 'public.suggest_website_absent(uuid, text)', 'execute'),
  'anon cannot call suggest_website_absent'
);

select * from finish();

rollback;
