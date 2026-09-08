-- Migration: hoist_rls_helper_initplans
-- Sequence: no schema change — rewrites the policy expressions on the seven
--   tables the client list reads. No table, column, grant or permission changes.
-- Story: performance — intermittent slow page loads.
--
-- WHAT THIS DOES
--
-- Wraps every zero-argument `app.*` helper call inside an RLS policy in
-- `(select ...)`. Nothing else changes: the same helpers, in the same order,
-- joined by the same operators, granted to the same role. A policy that
-- admitted a row before admits exactly the same row after.
--
-- WHY — MEASURED, NOT GUESSED
--
-- `app.is_active_user()` is `LANGUAGE sql STABLE SECURITY DEFINER`. Postgres
-- cannot inline a SECURITY DEFINER function, so inside a policy's security
-- qualifier it stays an opaque function call and is invoked **once per row**.
-- Each call probes `users_pkey`. On `organisations` that is one extra index
-- lookup for every organisation, on every read, for every user.
--
-- Measured on staging (2,738 organisations), `select id, legal_name from
-- organisations order by legal_name limit 1000` as an authenticated admin:
--
--                                    execution    shared buffers
--   before (bare helper call)          111 ms          5,782
--   after  ((select ...) wrapper)        16 ms            293
--
-- The plan changes from `Filter: app.is_active_user()` on the sequential scan
-- to `Filter: (InitPlan 1).col1` — evaluated once for the whole statement
-- instead of once per row. That is a two-column query with no joins; the same
-- per-row tax was being paid on every child table the client list embeds.
--
-- WHY THE LINTER DID NOT CATCH THIS
--
-- Supabase's `auth_rls_initplan` advisor pattern-matches `auth.<fn>()` calls
-- only. It does not know about this project's `app.*` wrappers, so it reports
-- none of these policies. Its eleven current warnings are all on INSERT/UPDATE/
-- DELETE policies on small tables — the cheap ones. Do not read a clean
-- advisor report as evidence that this class of problem is absent.
--
-- WHAT IS DELIBERATELY NOT WRAPPED
--
-- Helpers that take an argument — `app.owns_organisation(id)`,
-- `app.organisation_is_unowned(id)`, `app.can_contact_organisation(id)` — are
-- genuinely row-correlated. `(select f(row.col))` is still a correlated
-- subplan evaluated per row, so wrapping buys nothing and hides the intent.
-- Column comparisons such as `added_by_user_id = auth.uid()` stay per-row for
-- the same reason; only the `auth.uid()` half is hoisted.
--
-- SCOPE
--
-- The seven tables `/clients` reads. A follow-up migration covers the
-- remaining policies, which share the defect but not the traffic.
--
-- Policies are dropped and recreated. The Supabase CLI applies each migration
-- file in a single transaction, so there is no window in which a table is
-- readable without its policy, and `scripts/verify-rls-coverage.sql` never
-- observes an intermediate state.

-- ── organisations ────────────────────────────────────────────────────────────

drop policy organisations_select_active on public.organisations;
create policy organisations_select_active on public.organisations
  for select to authenticated
  using ((select app.is_active_user()));

drop policy organisations_insert_admin on public.organisations;
create policy organisations_insert_admin on public.organisations
  for insert to authenticated
  with check ((select app.is_admin()));

drop policy organisations_update_owner_or_admin on public.organisations;
create policy organisations_update_owner_or_admin on public.organisations
  for update to authenticated
  using (
    (select app.is_admin())
    or ((select app.is_cam()) and owner_id = (select auth.uid()))
  )
  with check (
    (select app.is_admin())
    or ((select app.is_cam()) and coalesce(owner_id = (select auth.uid()), false))
  );

drop policy organisations_delete_admin on public.organisations;
create policy organisations_delete_admin on public.organisations
  for delete to authenticated
  using ((select app.is_admin()));

-- ── users ────────────────────────────────────────────────────────────────────

drop policy users_select_active on public.users;
create policy users_select_active on public.users
  for select to authenticated
  using ((select app.is_active_user()));

drop policy users_update_self_or_admin on public.users;
create policy users_update_self_or_admin on public.users
  for update to authenticated
  using (
    (select app.is_active_user())
    and (id = (select auth.uid()) or (select app.is_admin()))
  )
  with check (
    (select app.is_active_user())
    and (id = (select auth.uid()) or (select app.is_admin()))
  );

-- ── financial_periods ────────────────────────────────────────────────────────

drop policy financial_periods_select_active on public.financial_periods;
create policy financial_periods_select_active on public.financial_periods
  for select to authenticated
  using ((select app.is_active_user()));

drop policy financial_periods_write_admin on public.financial_periods;
create policy financial_periods_write_admin on public.financial_periods
  for all to authenticated
  using ((select app.is_active_user()) and (select app.is_admin()))
  with check ((select app.is_active_user()) and (select app.is_admin()));

-- ── grants ───────────────────────────────────────────────────────────────────

drop policy grants_select_active on public.grants;
create policy grants_select_active on public.grants
  for select to authenticated
  using ((select app.is_active_user()));

drop policy grants_write_admin on public.grants;
create policy grants_write_admin on public.grants
  for all to authenticated
  using ((select app.is_active_user()) and (select app.is_admin()))
  with check ((select app.is_active_user()) and (select app.is_admin()));

-- ── latest_scores ────────────────────────────────────────────────────────────

drop policy latest_scores_select_active on public.latest_scores;
create policy latest_scores_select_active on public.latest_scores
  for select to authenticated
  using ((select app.is_active_user()));

-- ── org_tags ─────────────────────────────────────────────────────────────────

drop policy org_tags_select_active on public.org_tags;
create policy org_tags_select_active on public.org_tags
  for select to authenticated
  using ((select app.is_active_user()));

drop policy org_tags_insert_can_write on public.org_tags;
create policy org_tags_insert_can_write on public.org_tags
  for insert to authenticated
  with check (
    (select app.is_active_user())
    and (select app.can_write())
    and added_by_user_id = (select auth.uid())
  );

drop policy org_tags_delete_can_write on public.org_tags;
create policy org_tags_delete_can_write on public.org_tags
  for delete to authenticated
  using ((select app.is_active_user()) and (select app.can_write()));

-- ── suppressions ─────────────────────────────────────────────────────────────

drop policy suppressions_select_active on public.suppressions;
create policy suppressions_select_active on public.suppressions
  for select to authenticated
  using ((select app.is_active_user()));
