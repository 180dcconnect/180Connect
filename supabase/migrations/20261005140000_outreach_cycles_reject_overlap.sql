-- Migration: outreach_cycles_reject_overlap
-- Story: Outreach cycles — the non-overlap rule becomes the database's.
--
-- WHAT WAS WRONG: createCycle/updateCycle read every cycle, check the candidate
--   in memory, then write — a check and a write in two statements, and two
--   admins saving at the same moment both read the state before either wrote.
--   Both pass, both insert, and two cycles now cover the same day. Analytics
--   filters events into each cycle independently, so every email in the overlap
--   is counted in both comparisons — the one thing a cycle comparison exists not
--   to do. The table's own header said the rule was "enforced in the app", and
--   the app's check is a plain read, which cannot be atomic by itself.
--
-- THE FIX: a BEFORE INSERT OR UPDATE trigger that takes a transaction advisory
--   lock and then checks the candidate against every other cycle in the same
--   transaction. Two concurrent writers now queue behind that lock; the second
--   one's SELECT runs after the first has committed, so it sees the row. Same
--   technique as the last-admin guard (20260804153000) and the Gmail reply
--   capture (20260912160000) — the repo's established answer to "check then
--   write, but atomically".
--
--   The advisory lock is taken in one fixed order by every writer, so there is
--   no lock-upgrade or two-key deadlock to hit; the alternative (locking the
--   table exclusively from inside the trigger) would deadlock the moment two
--   inserts each held their own ROW EXCLUSIVE lock and both asked to upgrade.
--
-- WHY A TRIGGER AND NOT A CONSTRAINT: no extension is needed, which matters
--   here — `exclude using gist (daterange(...) with &&)` requires btree_gist,
--   and a migration that fails to install an extension fails on staging for the
--   whole team. This also keeps the write path unchanged: the app's own
--   plain-English pre-check still runs first (an admin sees the clash before
--   pressing save), and this is the backstop for the case the pre-check cannot
--   see.
--
--   The message is written as a sentence, not a code: the app maps errcode
--   23P01 to its own wording (`settings/cycles/actions.ts`), but anything that
--   reads the raw error — a psql session, a log — should still be able to tell
--   what happened.
--
--   ONE ERROR CODE IS DELIBERATELY LEFT ALONE. A cycle whose end falls before
--   its start is the table's own CHECK's to refuse (23514, asserted by
--   `rls_policies.test.sql`), and `daterange(new.starts_on, new.ends_on)` would
--   raise 22000 first — "range lower bound must be less than or equal to range
--   upper bound" — turning a clear refusal into a confusing one for every
--   writer, app or not. A backwards row is handed back untouched for the
--   constraint to reject, so this trigger only ever speaks for overlaps.
--
-- Schema change approval record (SOP §7):
--   Change        | Add app.outreach_cycles_reject_overlap() + one BEFORE
--                 | INSERT OR UPDATE trigger on public.outreach_cycles.
--   Reason        | Non-overlap was app-enforced only; concurrent saves could
--                 | store overlapping ranges and double-count every event in the
--                 | overlap.
--   Compatibility | No column, policy or grant changes. Every existing row is
--                 | untouched: the trigger runs on writes, and the app has never
--                 | been able to create an overlap. Two admins saving at the same
--                 | moment now get a refusal instead of a silent overlap.
--   Data migration| None.
--   Security      | SECURITY DEFINER so the check sees every cycle regardless of
--                 | the writer's own RLS visibility; EXECUTE revoked from public,
--                 | anon and authenticated (a trigger needs no grant, and this
--                 | function should not be callable directly).
--   Documentation | docs/data-model/04-entities.md (OUTREACH_CYCLES) is generated
--                 | from the Data Model spreadsheet, which cannot be edited from
--                 | this repo — same standing as the table's own migration
--                 | (20261004200000). The rule itself is captured in the app's
--                 | `findCycleOverlap` doc comment.
--
-- Reversibility: paired rollback in
--   ../rollback/20261005140000_outreach_cycles_reject_overlap.down.sql

-- ---------------------------------------------------------------------------
-- The check
-- ---------------------------------------------------------------------------

create or replace function app.outreach_cycles_reject_overlap()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clash_name  text;
  v_clash_start date;
  v_clash_end   date;
begin
  -- Dates that run backwards are not this trigger's business: the table's CHECK
  -- refuses them, and constructing a range from them here would raise 22000
  -- instead, changing the error every existing caller sees. Hand the row back
  -- and let the constraint do it.
  if new.starts_on > new.ends_on then
    return new;
  end if;

  -- One writer at a time through the check below. `pg_advisory_xact_lock` is
  -- scoped to this transaction and released at its end, and the SELECT after it
  -- runs under READ COMMITTED, so it sees whatever the previous holder of the
  -- lock committed.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('180connect.outreach_cycles.non_overlap')
  );

  -- A cycle never clashes with itself: saving a cycle's own dates back, or
  -- renaming it, must not be refused. `new.id` is null on INSERT, so
  -- `c.id is distinct from new.id` is true for every existing row there.
  select c.name, c.starts_on, c.ends_on
    into v_clash_name, v_clash_start, v_clash_end
    from public.outreach_cycles c
   where c.id is distinct from new.id
     and pg_catalog.daterange(c.starts_on, c.ends_on, '[]')
      && pg_catalog.daterange(new.starts_on, new.ends_on, '[]')
   limit 1;

  if v_clash_name is not null then
    -- 23P01 is exclusion_violation — the closest standard code, and the one the
    -- app matches on.
    raise exception
      'overlaps "%" (%s to %s): every email has to fall in exactly one cycle',
      v_clash_name, v_clash_start, v_clash_end
      using errcode = '23P01';
  end if;

  return new;
end;
$$;

comment on function app.outreach_cycles_reject_overlap() is
  'Refuses an OUTREACH_CYCLES row whose date range overlaps an existing cycle, '
  'under a transaction advisory lock so two admins saving at the same moment '
  'cannot both pass the app-level check. Raises errcode 23P01. '
  '20261005140000.';

-- A trigger does not need EXECUTE, and nothing else should be able to call this
-- directly: it would raise on a row that is not being written.
revoke execute on function app.outreach_cycles_reject_overlap()
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The trigger
-- ---------------------------------------------------------------------------

drop trigger if exists outreach_cycles_reject_overlap on public.outreach_cycles;

create trigger outreach_cycles_reject_overlap
  before insert or update on public.outreach_cycles
  for each row
  execute function app.outreach_cycles_reject_overlap();
