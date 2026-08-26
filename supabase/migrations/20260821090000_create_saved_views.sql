-- Migration: create_saved_views
-- Sequence step 22.6 (appended to the Data Model migration sequence after step 22.5,
--   not renumbered, same convention as steps 21.0/21.1).
-- Story: F066 Saved Filter Views (#68)
-- Spec: docs/rls-permission-matrix.md §3.17
--
-- WHAT A SAVED VIEW IS: the /clients list's whole filter combination under a name the
--   CAM chose. Every filter on that page is already a URL search param (q, city,
--   country, status, type, owner — src/app/clients/page.tsx; the multi-selects
--   stored as value arrays), so a view is a stored set of
--   those params and re-applying one is a link, not a re-query. AC2 ("re-applies
--   exactly the same combination") therefore holds by construction: nothing
--   interprets the filters on the way back out.
--
-- WHY jsonb AND NOT ONE COLUMN PER FILTER:
--   The filter set is still growing — F055 sector (#57) has no filter yet because
--   ORGANISATIONS has no sector column, and F058 priority (#60) and F193 tag (#189)
--   are unbuilt. A column per filter means a migration per new filter, each one
--   changing a table whose rows are personal shortcuts. jsonb keyed by the page's own
--   param names absorbs those for free, and the values are never interpreted here:
--   they are written to a query string and handed back to the same filter functions
--   that produced them.
--   The trade accepted: Postgres cannot constrain which keys appear. The write path
--   (src/app/clients/saved-view-filters.ts) whitelists the keys and caps their length
--   before insert, and the read path re-whitelists on the way out, so a row that
--   somehow holds an unknown key renders as a view that ignores it rather than as a
--   filter nobody can see. A check constraint is still added below for the two things
--   SQL can usefully enforce: it is an object, and it is not enormous.
--
-- WHY NO AUDIT_LOG ROW:
--   docs/audit-log-pattern.md §1 scopes the requirement to writes that change
--   ownership, status, role, or approval state. A saved view is none of those — it is
--   the user's own view state, visible to nobody else, granting nothing. Same call
--   already made for USER_ONBOARDING_STEPS (20260805100000) and OUTREACH_PREFERENCES
--   (20260805110000). Ordinary RLS-governed write, not a SECURITY DEFINER RPC.
--
-- WHY DELETE IS GRANTED HERE AND NOT ON OUTREACH_PREFERENCES:
--   AC3 asks for deletion by name ("delete ones they no longer need"), and a view is a
--   list of many rows rather than a single settings row — "no longer need this one" has
--   no UPDATE-to-empty equivalent. Own rows only; an admin gets neither read nor delete.
--
-- Schema change approval record (SOP §7):
--   Change        | Add SAVED_VIEWS table
--   Reason        | F066 (#68) — a CAM saves a filter combination and returns to it.
--   Compatibility | New table. Nothing existing reads or writes it. The /clients page
--                 | gains a read of the caller's own rows; every other consumer of
--                 | ORGANISATIONS is untouched.
--   Data migration| None.
--   Security      | RLS on, own-row SELECT/INSERT/UPDATE/DELETE for active users, no
--                 | admin read. Policies in this migration.
--   Documentation | Data Model tab 04 + tab 02 Data Dictionary + tab 11 updated (Y).
--
-- Reversibility: paired rollback in ../rollback/20260821090000_create_saved_views.down.sql

create table public.saved_views (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  name text not null,
  filters jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- A name is how the CAM picks the view out of their own list, so it has to be
  -- present and has to be theirs alone. Length cap mirrors the form's maxlength;
  -- the trim() is what stops "   " counting as a name.
  constraint saved_views_name_not_blank check (length(trim(name)) between 1 and 60),
  -- Two views called the same thing are indistinguishable in the list. Case-sensitive
  -- on purpose: matching Postgres's default collation keeps this constraint and the
  -- server action's conflict handling talking about the same thing.
  constraint saved_views_name_unique_per_user unique (user_id, name),
  -- jsonb can hold a scalar or an array; a filter set is neither. The size cap is a
  -- backstop against a hostile client growing one row without bound — the write path
  -- already whitelists keys, this is what remains true if that path is ever bypassed.
  constraint saved_views_filters_is_object
    check (jsonb_typeof(filters) = 'object' and pg_column_size(filters) <= 4096)
);

comment on table public.saved_views is
  'F066: a CAM''s named /clients filter combinations. Private to their owner — a '
  'personal shortcut, not a team record. Selecting one re-applies the stored params.';
comment on column public.saved_views.filters is
  'The /clients search params this view re-applies, keyed by the page''s own param '
  'names (q, city, country, status, type, owner — arrays for the multi-selects). '
  'Values are never interpreted in SQL: they '
  'are written back into a query string and read by the same filter functions that '
  'produced them. jsonb so a new filter needs no migration.';

-- Revoke before granting: Supabase default-grants all privileges on new public tables
-- to anon and authenticated, so a policy alone would leave every column writable
-- (MIGRATIONS.md, RLS recipe step 1). anon gets nothing.
revoke all on public.saved_views from anon, authenticated;
grant select, insert, update, delete on public.saved_views to authenticated;

alter table public.saved_views enable row level security;

-- Own rows only, and only while the account is active — app.is_active_user() is ANDed
-- into every policy so deactivation bites immediately, per the RLS recipe. No admin
-- read: nothing in #68 needs one, and F187 (admin views a CAM's settings, P3) can add
-- it with a stated reason when it is actually built — same call already made for
-- USER_ONBOARDING_STEPS (§3.12) and OUTREACH_PREFERENCES (§3.13).
create policy saved_views_select_own on public.saved_views
  for select to authenticated
  using (app.is_active_user() and user_id = (select auth.uid()));

-- No app.can_write(): that helper gates client-data writes and excludes viewers
-- (F258). A saved view changes no client data — it is the caller's own bookmark over
-- a list they can already read, so any active role may keep one.
create policy saved_views_insert_own on public.saved_views
  for insert to authenticated
  with check (app.is_active_user() and user_id = (select auth.uid()));

-- UPDATE carries no F066 write path (saving is insert, AC has no rename). It is
-- granted so a later rename/overwrite story needs no migration, and it is confined to
-- the caller's own rows in both directions — the with-check stops a row being moved
-- to another user_id.
create policy saved_views_update_own on public.saved_views
  for update to authenticated
  using (app.is_active_user() and user_id = (select auth.uid()))
  with check (app.is_active_user() and user_id = (select auth.uid()));

create policy saved_views_delete_own on public.saved_views
  for delete to authenticated
  using (app.is_active_user() and user_id = (select auth.uid()));

-- The list is always read as "my views, newest first" (src/app/clients/page.tsx), and
-- the RLS predicate itself filters on user_id, so both go through this index.
create index saved_views_user_id_created_at_idx
  on public.saved_views (user_id, created_at desc);

create trigger saved_views_set_updated_at
  before update on public.saved_views
  for each row execute function public.set_updated_at();
