-- Rollback for: 20260724100000_viewer_role_write_lockout.sql
-- Story: F258 (#268) — Viewer Role
-- Apply manually against the target DB to reverse the paired migration.
--
-- WARNING — this restores a known privilege-escalation hole. The policy text below
-- is what create_organisations (F233) shipped, under which an active `viewer` can
-- claim any unowned organisation and edit its canonical fields. Roll back only to
-- unblock a failed deploy, and only on an environment with no viewer accounts; then
-- fix forward. Reversing this is not a neutral act.

alter policy organisations_update_owner_or_admin on public.organisations
  using (app.is_active_user()
         and (owner_id is null or owner_id = auth.uid() or app.is_admin()))
  with check (app.is_active_user()
              and (coalesce(owner_id = auth.uid(), false) or app.is_admin()));

-- Dropped last: no policy references it once the ALTER above has run. If a later
-- migration has since built a policy on app.is_viewer(), this DROP fails rather
-- than silently taking that policy with it — roll that migration back first.
drop function if exists app.is_viewer();
