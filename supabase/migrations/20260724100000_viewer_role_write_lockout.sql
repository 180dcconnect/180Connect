-- Migration: viewer_role_write_lockout
-- Story: F258 (#268) — Viewer Role
-- Purpose: make the `viewer` role actually read-only at the database layer, and add
--   the app.is_viewer() predicate the app and future policies check against.
-- Spec: docs/rls-permission-matrix.md §1 (viewer = read-only) and §3.2 (ORGANISATIONS
--   UPDATE is "admin any row; CAM may claim an unowned row" — viewer is not listed).
--
-- THE BUG THIS CLOSES. create_organisations (F233) wrote the UPDATE policy as
--
--     using       (app.is_active_user() and (owner_id is null
--                                            or owner_id = auth.uid()
--                                            or app.is_admin()))
--     with check  (app.is_active_user() and (coalesce(owner_id = auth.uid(), false)
--                                            or app.is_admin()))
--
-- Both halves test *ownership* and *admin*, and never the role. `viewer` was not
-- considered because at the time no story owned it (matrix §6, open question 4).
-- The consequence: an active viewer, on any organisation with `owner_id is null`,
-- passes USING (the null branch), and passes WITH CHECK by setting owner_id to
-- themselves — so a read-only user could claim an unowned organisation and edit its
-- canonical fields in the same statement. The seed ships 50 organisations with no
-- owner, so on any seeded environment this was reachable on every row.
--
-- The fix is to state the role explicitly rather than infer it from ownership:
-- admin does anything; a CAM gets the ownership-scoped path; everyone else — which
-- today means viewer — gets nothing.
--
-- Reversibility: paired rollback in
--   ../rollback/20260724100000_viewer_role_write_lockout.down.sql

-- ---------------------------------------------------------------------------
-- Predicate
-- ---------------------------------------------------------------------------
-- Completes the role set: app.is_admin() and app.is_active_user() come from
-- create_users (F233), app.is_cam() and app.can_write() from create_rls_helpers
-- (F224). is_viewer() is not needed by the policy below — "not admin and not CAM"
-- already denies viewers — but a policy that grants a viewer something specific
-- needs to name the role positively, and so does the app layer. Defining it here
-- means the next such policy does not invent its own role lookup.
--
-- Same shape as its siblings and for the same reasons: SECURITY DEFINER so a
-- lookup on public.users from inside a policy on public.users does not recurse
-- under RLS; STABLE so the planner does one lookup per statement rather than one
-- per row; `set search_path = ''` so a caller-controlled shadowing object cannot
-- hijack it (Supabase linter 0011). It takes no arguments, so it cannot be turned
-- into a general-purpose read of someone else's row.
create or replace function app.is_viewer()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.users
     where id = (select auth.uid()) and role = 'viewer' and is_active
  );
$$;

comment on function app.is_viewer() is
  'Active viewer. Read-only per PRD §4.3: no writes anywhere, and no access to the '
  'admin-only tables. Present so a policy granting viewers something can say so '
  'positively; write denial comes from not satisfying app.can_write().';

-- `anon` is excluded deliberately, as with every other app.* predicate: public
-- self-sign-up is prohibited (PRD §4.2) and anon must reach nothing. Revoke first —
-- EXECUTE defaults to public on create.
revoke execute on function app.is_viewer() from public;
grant execute on function app.is_viewer() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- ORGANISATIONS UPDATE — role-first, then ownership
-- ---------------------------------------------------------------------------
-- ALTER rather than DROP + CREATE: the policy keeps its name and its identity, and
-- there is no instant — even inside this transaction — where the table has RLS on
-- and no UPDATE policy.
--
-- app.is_active_user() is gone from both halves and is not an omission:
-- app.is_admin() and app.is_cam() each already require `is_active`, so a
-- deactivated user satisfies neither branch. Keeping the call would be a third
-- redundant lookup per statement. Deactivation still bites exactly as PRD §4.2
-- requires — the SELECT policy on this table is unchanged and still gates on
-- app.is_active_user() directly.
--
-- `auth.uid()` is wrapped in `(select ...)` — the one other change. Postgres then
-- evaluates it once as an InitPlan instead of once per candidate row (Supabase
-- linter 0003, auth_rls_initplan); it is how every app.* helper already calls it.
--
-- The CAM half is otherwise a straight copy of what F233 shipped, including the
-- load-bearing coalesce: on an unowned row `owner_id = auth.uid()` is NULL, not
-- false, and a WITH CHECK passes on anything that is not FALSE — so without it a
-- CAM could edit a canonical field on an unowned organisation and leave it unowned.
--
-- KNOWN GAP, unchanged by this migration and still tracked to F224: a CAM who owns
-- an organisation can edit its canonical columns (legal_name, etc.), which matrix
-- §3.2 reserves for admins. Column privileges cannot express it — `authenticated`
-- is one shared Postgres role — so it needs the canonical-edit RPC or a column-guard
-- trigger. Out of scope here: this migration is about the viewer, and narrowing who
-- may reach the row at all does not narrow which columns they may then write.
alter policy organisations_update_owner_or_admin on public.organisations
  using (
    app.is_admin()
    or (app.is_cam() and (owner_id is null or owner_id = (select auth.uid())))
  )
  with check (
    app.is_admin()
    or (app.is_cam() and coalesce(owner_id = (select auth.uid()), false))
  );
