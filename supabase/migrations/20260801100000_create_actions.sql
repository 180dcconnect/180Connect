-- Migration: create_actions
-- Sequence step 19.0 (addition to the Data Model migration sequence, appended after
--   step 18.0 create_login_attempt rather than renumbered — steps 4-17 are still unrun).
-- Stories: F168 My Actions Tab, F169 Admin-Assigned Actions, F170 Action Due Dates,
--   F171 Mark Action Complete, F172 Overdue Action Warning — and F257 Reassign CAM When
--   Offboarded, which is what forces the table to exist now: every other thing a CAM
--   owns (notes, drafts, timeline, replies) hangs off ORGANISATIONS and is inherited by
--   the new owner for free. Actions are the one exception — they name a *user*, so
--   reassignment has to re-point them, and it cannot re-point rows that do not exist.
-- Spec: docs/rls-permission-matrix.md §3.11
--
-- SCOPE: this migration creates the table only. The CAM-facing tab is F168. The
--   reassignment RPC is a follow-up migration, the same split create_users /
--   create_user_role_rpc used for `role` — see "WHY assignee_user_id IS NOT GRANTED".
--
-- WHY A REMINDER IS A COLUMN AND NOT A TABLE:
--   Nothing in F168-F172 or F257 needs a reminder that exists independently of the work
--   it is reminding someone about, or more than one per action. `remind_at` is therefore
--   a nullable column. A reminders table would be a second thing for reassignment to
--   re-point and a second place for the two to disagree. If recurring or multiple
--   reminders are ever needed, that is the point to split it out — not before.
--
-- WHY assignee_user_id IS NOT GRANTED (the load-bearing decision here):
--   Reassignment is a reason-carrying write: F257 requires an audit_log row naming the
--   old CAM, the new CAM, and why. MIGRATIONS.md convention 4 says such writes are RPCs,
--   not policies, because a policy cannot force the reason to be supplied or the audit
--   row to be written. So `authenticated` gets UPDATE on the work columns only and on no
--   account gets it on assignee_user_id — admins included, since `authenticated` is one
--   shared Postgres role and column privileges cannot separate them (the same constraint
--   documented for ORGANISATIONS canonical columns in matrix §3.2). The difference is
--   that here the RPC is being built rather than deferred, so this is a closed door and
--   not a known gap: until the RPC lands, assignment is fixed at INSERT and nothing can
--   change it except service_role.
--
-- Schema change approval record (SOP §7):
--   Change        | Add ACTIONS table + enum action_status ('open','completed','cancelled')
--   Reason        | F257 must re-point per-user work on offboarding; ACTIONS is the only
--                 | entity that carries a user reference rather than an organisation one.
--                 | F168-F172 are the consumers.
--   Compatibility | New table. No existing stream reads or writes it. FK to ORGANISATIONS
--                 | (cascade) and USERS (set null) only.
--   Data migration| None.
--   Security      | RLS on. SELECT: every active user (shared client visibility, F019,
--                 | as for NOTES §3.3). INSERT/UPDATE/DELETE per §3.11. No UPDATE grant
--                 | on assignee_user_id or organisation_id.
--   Documentation | Data Model tabs 02, 04 and 11 (step 19.0) updated 1 Aug 2026;
--                 | exported to docs/data-model/. Matrix row: §3.11.
--                 | Approved by Bashir (Project Leader), 1 Aug 2026.
--
-- Reversibility: paired rollback in ../rollback/20260801100000_create_actions.down.sql

-- Adding an enum value later is a one-way door in Postgres (a committed value cannot be
-- dropped), so this set should not be extended without the Wednesday-call agreement
-- SOP §7 requires. Three values is deliberate: 'cancelled' is distinct from deletion
-- because an action dropped during a handover is context the new CAM needs to see.
-- Value set signed off by Bashir (Project Leader), 2 Aug 2026.
create type public.action_status as enum ('open', 'completed', 'cancelled');

create table public.actions (
  id                 uuid primary key default gen_random_uuid(),
  -- CASCADE: an action is meaningless without its client, and organisations are
  -- admin-only deletes. Contrast assignee/creator below, which must survive.
  organisation_id    uuid not null references public.organisations (id) on delete cascade,
  -- SET NULL, not CASCADE: deleting a user must never delete the work they were
  -- holding — that is precisely the loss F257 exists to prevent. A null assignee is
  -- the "dropped on the floor" state the offboarding screen surfaces and fixes.
  assignee_user_id   uuid references public.users (id) on delete set null,
  created_by_user_id uuid references public.users (id) on delete set null,
  title              text not null,
  description        text,
  due_date           date,
  -- When to remind the assignee. Nothing reads this yet; the reminder job is F173.
  remind_at          timestamptz,
  status             public.action_status not null default 'open',
  completed_at       timestamptz,
  is_seed            boolean not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  -- completed_at and status cannot disagree. Without this the F172 overdue query and
  -- the F168 tab can each be right about a different answer.
  constraint actions_completed_at_matches_status
    check ((status = 'completed') = (completed_at is not null)),
  constraint actions_title_not_blank
    check (length(trim(title)) > 0)
);

comment on table public.actions is
  'Per-client work assigned to a CAM (F168-F172). The only entity that names a user '
  'rather than an organisation, which is why F257 offboarding has to re-point it.';
comment on column public.actions.assignee_user_id is
  'CAM responsible. Not writable by any end-user role — changed only by the F257 '
  'reassignment RPC, which records the change in audit_log. Null means unassigned.';
comment on column public.actions.remind_at is
  'When to remind the assignee. One optional reminder per action, deliberately a column '
  'and not a table — see the migration header.';
comment on column public.actions.is_seed is
  'True for rows created by scripts/seed.mts (F233). Real records are always false.';

-- Sequence step 16 (create_indexes) is the general pass. These three back behaviour
-- introduced here: the F168 "my actions" query, the F257 per-organisation handover
-- count, and the F172 overdue sweep (partial — closed actions are never overdue).
create index actions_assignee_status_idx on public.actions (assignee_user_id, status);
create index actions_organisation_idx on public.actions (organisation_id);
create index actions_due_date_open_idx on public.actions (due_date) where status = 'open';
create index actions_is_seed_idx on public.actions (is_seed) where is_seed;

create trigger actions_set_updated_at
  before update on public.actions
  for each row execute function public.set_updated_at();

-- Column privileges — REVOKE before GRANT (matrix §2.1): Supabase default-grants all
-- privileges on new public tables to anon and authenticated, so the policies below
-- would otherwise sit on top of full column access. anon gets nothing.
revoke all on public.actions from anon, authenticated;
grant select, insert, delete on public.actions to authenticated;
-- The work columns, and only those. assignee_user_id is omitted for the reason in the
-- header; organisation_id is omitted because moving an action between clients is not a
-- feature anyone asked for, and silently re-parenting one would break the handover
-- trail. is_seed is omitted so a user cannot disguise real data as seed data (or the
-- reverse, and have the seed script delete it).
grant update (title, description, due_date, remind_at, status, completed_at)
  on public.actions to authenticated;

-- RLS enabled with its policies in the creating migration (SOP §7).
alter table public.actions enable row level security;

-- Shared read, as for NOTES (matrix §3.3) and OUTREACH_MESSAGES (§3.4). F019 makes
-- client context visible to the whole team, and F257's "the new CAM can understand
-- where the previous CAM left off" depends on it: the incoming CAM must be able to read
-- the outgoing CAM's open actions *before* the handover, not only after.
create policy actions_select_active on public.actions
  for select to authenticated
  using (app.is_active_user());

-- Admins assign work to anyone (F169).
create policy actions_insert_admin on public.actions
  for insert to authenticated
  with check (app.is_active_user() and app.is_admin());

-- A CAM creates work for themselves, on a client they own or one nobody owns. Assigning
-- work to another CAM is F169 and stays admin-only, which is what the assignee predicate
-- enforces. Viewers are excluded by app.is_cam() (matrix §4.3: viewers create nothing).
create policy actions_insert_cam on public.actions
  for insert to authenticated
  with check (
    app.is_active_user()
    and app.is_cam()
    and created_by_user_id = auth.uid()
    and assignee_user_id = auth.uid()
    and (app.owns_organisation(organisation_id)
         or app.organisation_is_unowned(organisation_id))
  );

create policy actions_update_admin on public.actions
  for update to authenticated
  using (app.is_active_user() and app.is_admin())
  with check (app.is_active_user() and app.is_admin());

-- The assignee works their own queue: retitle, reschedule, complete (F171), cancel.
-- They cannot hand it to someone else — assignee_user_id carries no UPDATE grant — so
-- the WITH CHECK cannot be used to escape ownership of the row.
--
-- coalesce(..., false) is load-bearing exactly as in organisations_update_owner_or_admin:
-- assignee_user_id is nullable, `null = auth.uid()` is NULL, and a WITH CHECK passes on
-- anything that is not FALSE. Without it, every CAM could edit every unassigned action.
create policy actions_update_assignee on public.actions
  for update to authenticated
  using (app.is_active_user()
         and app.is_cam()
         and coalesce(assignee_user_id = auth.uid(), false))
  with check (app.is_active_user()
              and app.is_cam()
              and coalesce(assignee_user_id = auth.uid(), false));

create policy actions_delete_admin on public.actions
  for delete to authenticated
  using (app.is_active_user() and app.is_admin());

-- A CAM may remove an action they raised themselves and have not started acting on.
-- Once it is completed or cancelled it is handover history and only an admin may
-- remove it — F257 requires the incoming CAM to see what was dropped and why.
create policy actions_delete_own_open on public.actions
  for delete to authenticated
  using (app.is_active_user()
         and app.is_cam()
         and coalesce(created_by_user_id = auth.uid(), false)
         and status = 'open');
