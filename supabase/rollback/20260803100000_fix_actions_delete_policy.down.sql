-- Rollback for 20260803100000_fix_actions_delete_policy.sql
--
-- WARNING: this restores a policy with a known authorisation hole. The original
-- actions_delete_own_open keyed DELETE on authorship alone, which let a CAM delete open
-- work that had been reassigned away from them — silently, since a DELETE blocked by
-- USING removes zero rows and raises nothing. Roll this back only to unblock a failed
-- deploy, and re-apply the fix immediately afterwards.
--
-- Prefer dropping the policy outright (leaving DELETE to admins only) over restoring it
-- if the choice is available: no policy means no CAM deletes, which is safe.

drop policy if exists actions_delete_own_open on public.actions;

create policy actions_delete_own_open on public.actions
  for delete to authenticated
  using (app.is_active_user()
         and app.is_cam()
         and coalesce(created_by_user_id = auth.uid(), false)
         and status = 'open');
