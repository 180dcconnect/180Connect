-- Outreach cycle non-overlap tests.
-- Spec: 20261005140000_outreach_cycles_reject_overlap.sql. The rule — every
-- email belongs to exactly one cycle, or cycle-over-cycle comparisons stop
-- adding up — was enforced only by a read-then-write check in the settings
-- actions, which two admins saving at the same moment can both pass. The
-- trigger is the backstop, so what is pinned here is that the database itself
-- refuses an overlap on INSERT and on UPDATE, that abutting windows are allowed
-- (a cycle ending 3 Apr and one starting 4 Apr do not share a day), and that a
-- cycle is never a clash with itself.
--
-- Run by `supabase test db` (pg_prove). The harness is a deliberate copy of the
-- other suites' rather than an import: pg_prove runs each file in its own
-- session and transaction, so there is nothing to import from.
--
-- Everything runs inside one transaction and is rolled back; fixtures never persist.

begin;

create extension if not exists pgtap with schema extensions;

select no_plan();

create schema if not exists tests;

create or replace function tests.suite_outreach_cycles_overlap()
returns setof text language plpgsql as $$
declare
  v_spring uuid;
  v_summer uuid;
  v_autumn uuid;
begin
  -- Lets the file merge ahead of its migration, same convention as the other suites.
  if to_regprocedure('app.outreach_cycles_reject_overlap()') is null then
    return next skip(1, 'outreach cycles overlap trigger not yet migrated');
    return;
  end if;

  -- 1 Jan 2026 – 31 Mar 2026.
  insert into public.outreach_cycles (name, starts_on, ends_on)
  values ('Spring 26', '2026-01-01', '2026-03-31')
  returning id into v_spring;
  return next ok(v_spring is not null, 'a cycle with free dates is stored');

  -- A window that abuts the first one is not an overlap: they share no day.
  insert into public.outreach_cycles (name, starts_on, ends_on)
  values ('Summer 26', '2026-04-01', '2026-06-30')
  returning id into v_summer;
  return next ok(v_summer is not null, 'a cycle starting the day after another ends is allowed');

  -- The day they would share is 31 Mar.
  return next throws_ok(
    $sql$insert into public.outreach_cycles (name, starts_on, ends_on)
          values ('Overlapping', '2026-03-31', '2026-05-01')$sql$,
    '23P01',
    null,
    'an insert that shares even one day with an existing cycle is refused'
  );

  -- Fully inside an existing cycle.
  return next throws_ok(
    $sql$insert into public.outreach_cycles (name, starts_on, ends_on)
          values ('Inside Spring', '2026-02-01', '2026-02-28')$sql$,
    '23P01',
    null,
    'an insert swallowed by an existing cycle is refused'
  );

  -- Saving a cycle's own dates back is not a clash with itself: this is the
  -- rename path, and the self-check is what keeps it working.
  update public.outreach_cycles set name = 'Spring 2026' where id = v_spring;
  return next is(
    (select name from public.outreach_cycles where id = v_spring),
    'Spring 2026',
    'renaming a cycle without moving its dates is allowed'
  );

  -- Moving a cycle onto another's window is refused, too — the update path has
  -- the same hole as the insert path. Summer 26 is dragged back over Spring 26.
  return next throws_ok(
    format(
      $sql$update public.outreach_cycles set starts_on = '2026-01-15', ends_on = '2026-02-15'
             where id = %L$sql$,
      v_summer
    ),
    '23P01',
    null,
    'moving a cycle onto another one is refused'
  );

  -- The refusal is a refusal, not a partial write: the row is untouched.
  return next is(
    (select starts_on from public.outreach_cycles where id = v_summer),
    '2026-04-01'::date,
    'the refused update left the cycle exactly where it was'
  );

  -- An end before the start stays the table's own CHECK's refusal. The trigger
  -- builds a range from those dates, and `daterange('2026-06-01', '2026-04-04')`
  -- raises 22000 before the constraint is ever reached — which would change the
  -- error the RLS suite (and any other writer) sees for a backwards row. So the
  -- code is pinned here as well as there: 23514, from the constraint.
  return next throws_ok(
    $sql$insert into public.outreach_cycles (name, starts_on, ends_on)
          values ('Backwards 26', '2026-06-01', '2026-04-04')$sql$,
    '23514',
    null,
    'a cycle ending before it starts is the constraint''s refusal, not the trigger''s'
  );

  -- A third cycle after the second ends is fine, so the trigger is not simply
  -- refusing every second insert.
  insert into public.outreach_cycles (name, starts_on, ends_on)
  values ('Autumn 26', '2026-07-01', '2026-09-30')
  returning id into v_autumn;
  return next ok(v_autumn is not null, 'a cycle after every existing one is allowed');

  -- Counted by name rather than over the whole table, so this cannot be broken
  -- by another suite's fixtures if the harness ever stops rolling back.
  return next is(
    (select count(*) from public.outreach_cycles
      where name in ('Spring 2026', 'Summer 26', 'Autumn 26')),
    3::bigint,
    'the suite leaves three cycles, none of them overlapping'
  );
end;
$$;

select * from tests.suite_outreach_cycles_overlap();

select * from finish();

rollback;
