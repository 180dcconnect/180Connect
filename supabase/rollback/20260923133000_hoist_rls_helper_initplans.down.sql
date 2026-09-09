-- Rollback for: 20260923133000_hoist_rls_helper_initplans.sql
-- Apply manually against the target DB to reverse the paired migration.
--
-- Restores the bare (unwrapped) helper calls in all fifteen policies. This is a
-- pure performance reversal: the policies admit exactly the same rows either
-- way, so rolling back cannot restore access to anyone who lost it — nobody
-- loses any. It reinstates the per-row evaluation and, with it, the ~7x cost
-- on every read of these tables.
--
-- Reach for this only if the forward migration is implicated in something the
-- pgTAP suite did not catch; there is no data to unwind.

-- ── organisations ────────────────────────────────────────────────────────────

drop policy organisations_select_active on public.organisations;
create policy organisations_select_active on public.organisations
  for select to authenticated
  using (app.is_active_user());

drop policy organisations_insert_admin on public.organisations;
create policy organisations_insert_admin on public.organisations
  for insert to authenticated
  with check (app.is_admin());

drop policy organisations_update_owner_or_admin on public.organisations;
create policy organisations_update_owner_or_admin on public.organisations
  for update to authenticated
  using (app.is_admin() or (app.is_cam() and owner_id = (select auth.uid())))
  with check (
    app.is_admin() or (app.is_cam() and coalesce(owner_id = (select auth.uid()), false))
  );

drop policy organisations_delete_admin on public.organisations;
create policy organisations_delete_admin on public.organisations
  for delete to authenticated
  using (app.is_admin());

-- ── users ────────────────────────────────────────────────────────────────────

drop policy users_select_active on public.users;
create policy users_select_active on public.users
  for select to authenticated
  using (app.is_active_user());

drop policy users_update_self_or_admin on public.users;
create policy users_update_self_or_admin on public.users
  for update to authenticated
  using (app.is_active_user() and (id = (select auth.uid()) or app.is_admin()))
  with check (app.is_active_user() and (id = (select auth.uid()) or app.is_admin()));

-- ── financial_periods ────────────────────────────────────────────────────────

drop policy financial_periods_select_active on public.financial_periods;
create policy financial_periods_select_active on public.financial_periods
  for select to authenticated
  using (app.is_active_user());

drop policy financial_periods_write_admin on public.financial_periods;
create policy financial_periods_write_admin on public.financial_periods
  for all to authenticated
  using (app.is_active_user() and app.is_admin())
  with check (app.is_active_user() and app.is_admin());

-- ── grants ───────────────────────────────────────────────────────────────────

drop policy grants_select_active on public.grants;
create policy grants_select_active on public.grants
  for select to authenticated
  using (app.is_active_user());

drop policy grants_write_admin on public.grants;
create policy grants_write_admin on public.grants
  for all to authenticated
  using (app.is_active_user() and app.is_admin())
  with check (app.is_active_user() and app.is_admin());

-- ── latest_scores ────────────────────────────────────────────────────────────

drop policy latest_scores_select_active on public.latest_scores;
create policy latest_scores_select_active on public.latest_scores
  for select to authenticated
  using (app.is_active_user());

-- ── org_tags ─────────────────────────────────────────────────────────────────

drop policy org_tags_select_active on public.org_tags;
create policy org_tags_select_active on public.org_tags
  for select to authenticated
  using (app.is_active_user());

drop policy org_tags_insert_can_write on public.org_tags;
create policy org_tags_insert_can_write on public.org_tags
  for insert to authenticated
  with check (app.is_active_user() and app.can_write() and added_by_user_id = auth.uid());

drop policy org_tags_delete_can_write on public.org_tags;
create policy org_tags_delete_can_write on public.org_tags
  for delete to authenticated
  using (app.is_active_user() and app.can_write());

-- ── suppressions ─────────────────────────────────────────────────────────────

drop policy suppressions_select_active on public.suppressions;
create policy suppressions_select_active on public.suppressions
  for select to authenticated
  using (app.is_active_user());
