-- Migration: create_user_onboarding
-- Sequence step 20.0 (addition to the Data Model migration sequence, appended after
--   step 19.0 create_actions rather than renumbered — steps 4-17 are still unrun).
-- Story: F255 New CAM First-Run Guide (#18)
-- Spec: docs/rls-permission-matrix.md §3.12
--
-- SCOPE: state only. This migration makes the guide's progress storable; the guide
--   itself, its copy, and the two steps it links to (F195 outreach preferences, F057
--   my-clients filter) are separate work. Landing the state first is deliberate: the
--   spreadsheet-first schema route (SOP §7) has a turnaround the UI work does not, and
--   nothing about these columns depends on which steps the guide ends up showing.
--
-- WHY TWO NULLABLE TIMESTAMPS AND NOT A STATUS ENUM:
--   The guide has to answer one question on every login — "show it or not" — and the
--   acceptance criteria give two independent reasons not to (AC5 dismissed, AC5 fully
--   completed) plus one precondition (AC6 a genuinely new CAM). With these columns that
--   is a single predicate and no new concept:
--
--     role = 'cam'
--       and invite_accepted_at is not null   -- activated, not merely invited (F008)
--       and onboarding_completed_at is null
--       and onboarding_dismissed_at is null
--
--   An enum would collapse "finished it" and "closed it early" into one value and lose
--   the distinction the moment anyone asks how many CAMs actually completed onboarding.
--   Keeping both timestamps also means neither write has to read the other first.
--
--   Nothing forbids both being set. A CAM who dismisses at the same moment the last step
--   completes is a race with no wrong answer — either column hides the guide, and a check
--   constraint here would turn a harmless double-click into a failed write.
--
--   invite_accepted_at is reused rather than re-derived: it already records the first
--   confirmed login of an invited account (20260804*, F008), which is exactly AC1's
--   "first login after account activation". A second "has onboarded before" flag would be
--   a second thing to keep true.
--
-- WHY STEPS ARE A TABLE AND NOT MORE COLUMNS ON USERS:
--   The step list is not settled. Today's blockers call (5 Aug 2026) dropped the third
--   step — "generate your first email draft" — until F100 exists, and it returns after
--   that. As columns, every change to the checklist is another migration on the busiest
--   table in the schema; as rows, a new step is an INSERT and a removed step is data.
--   The trade is a join to render the guide, which is one indexed read per login.
--
-- WHY NO AUDIT_LOG ROW:
--   docs/audit-log-pattern.md §1 scopes the requirement to writes that change ownership,
--   status, role, or approval state. Onboarding progress is none of those: it is a user's
--   own view state, it grants nothing, and no other user's access depends on it. So these
--   are ordinary RLS-governed writes and not SECURITY DEFINER RPCs — the first
--   state-changing writes in this schema that are genuinely allowed to be. If the guide
--   ever gates a permission, that write becomes an RPC and this note is wrong.
--
-- WHY THE COLUMN GRANT BELOW IS LOAD-BEARING:
--   20260722103000_create_users.sql revokes ALL on public.users from authenticated and
--   grants back `update (full_name)` only, because Supabase default-grants every column
--   and a row policy alone cannot claw that back (matrix §2.1). The existing
--   users_update_self_or_admin policy already confines an update to the caller's own row,
--   so the only thing standing between a CAM and dismissing their own guide is the column
--   privilege. Without the grant the write fails with 42501 and no policy change helps.
--
-- Schema change approval record (SOP §7):
--   Change        | Add USERS.onboarding_completed_at, USERS.onboarding_dismissed_at;
--                 | add USER_ONBOARDING_STEPS table
--   Reason        | F255 needs to know whether to show the first-run guide, and which of
--                 | its steps a CAM has already done, across sessions.
--   Compatibility | Both columns nullable with no default, so every existing row reads as
--                 | "guide not yet finished or dismissed". No backfill. Existing CAMs are
--                 | kept out by the role/invite_accepted_at half of the predicate, not by
--                 | these columns — see AC6 and the note in the rollback file.
--                 | New table, nothing reads it yet. No stream, job or dashboard affected.
--   Data migration| None.
--   Security      | New columns granted to authenticated for UPDATE only, confined to the
--                 | caller's own row by the existing users_update_self_or_admin policy.
--                 | New table: RLS on, own-row SELECT and INSERT for active users, no
--                 | UPDATE or DELETE grant to anyone (progress is append-only).
--   Documentation | Data Model tab 04 + tab 02 updated and exported (Y).
--                 | docs/rls-permission-matrix.md §3.12 added (Y).
--                 | Data Model tab 11 still needs row 20.0 (see TODO below).
--
-- TODO (spreadsheet, not code): add step 20.0 create_user_onboarding to Data Model tab
--   "11 Supabase Migration Sequence", and add the id / created_at rows to the
--   USER_ONBOARDING_STEPS tab — the tab lists the three domain fields only, while
--   MIGRATIONS.md requires every table to carry both. Implemented here per the
--   convention; the spreadsheet is the thing that is behind, not this file.
--
-- Reversibility: paired rollback in ../rollback/20260805100000_create_user_onboarding.down.sql

-- ---------------------------------------------------------------------------
-- 1. Guide-level state on USERS
-- ---------------------------------------------------------------------------

alter table public.users
  add column onboarding_completed_at timestamptz,
  add column onboarding_dismissed_at timestamptz;

comment on column public.users.onboarding_completed_at is
  'F255: when the CAM finished every step of the first-run guide. Null until then. '
  'Non-null stops the guide reappearing on later logins (AC5).';
comment on column public.users.onboarding_dismissed_at is
  'F255: when the CAM manually dismissed the first-run guide with steps still '
  'outstanding. Null unless dismissed. Non-null stops the guide reappearing (AC5).';

-- The only reason a CAM can write these at all. See "WHY THE COLUMN GRANT IS
-- LOAD-BEARING" above. full_name keeps its existing grant; this adds to it.
grant update (onboarding_completed_at, onboarding_dismissed_at)
  on public.users to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Per-step progress
-- ---------------------------------------------------------------------------

create table public.user_onboarding_steps (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  -- Checked rather than an enum: the step list changes with the product (step 3
  -- returns with F100), and adding a value to a check constraint is a one-line
  -- migration where adding one to an enum in use is not reversible in the same way.
  step_key text not null
    check (step_key in ('outreach_preferences', 'review_clients')),
  completed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  -- Marking a done step done again is a no-op, not a second row. This is also what
  -- an upsert from the server action targets.
  unique (user_id, step_key)
);

comment on table public.user_onboarding_steps is
  'F255: which first-run guide steps a user has completed. One row per completed step; '
  'absence of a row means not done. Append-only — see the grants below.';
comment on column public.user_onboarding_steps.step_key is
  'Which checklist step. outreach_preferences -> F195 settings screen; review_clients -> '
  'F057 owner-filtered client list. A third key is added when F100 makes the email-draft '
  'step buildable.';

-- Revoke before granting: Supabase default-grants all privileges on new public tables
-- to anon and authenticated, so a policy alone would leave every column writable
-- (MIGRATIONS.md, RLS recipe step 1). anon gets nothing.
revoke all on public.user_onboarding_steps from anon, authenticated;
-- No UPDATE and no DELETE, deliberately: a completed step is a fact about the past. The
-- guide is hidden by the USERS columns, never by deleting progress. This also means a
-- user cannot rewrite their own history to make the guide reappear.
grant select, insert on public.user_onboarding_steps to authenticated;

alter table public.user_onboarding_steps enable row level security;

-- Own rows only, and only while the account is active — app.is_active_user() is ANDed
-- into both policies so deactivation bites immediately, per the RLS recipe. Admins are
-- deliberately not given a read here: nothing in F255 needs it, and F187 (admin views a
-- CAM's settings, P3) can add it with a reason when it is actually built.
create policy user_onboarding_steps_select_own on public.user_onboarding_steps
  for select to authenticated
  using (app.is_active_user() and user_id = (select auth.uid()));

-- No app.can_write() here: that helper gates *client data* writes and excludes viewers
-- (F258). This table holds a user's own view state, grants nothing, and is harmless for
-- any active role to write about themselves. The WITH CHECK is what stops a user
-- recording progress on someone else's behalf.
create policy user_onboarding_steps_insert_own on public.user_onboarding_steps
  for insert to authenticated
  with check (app.is_active_user() and user_id = (select auth.uid()));
