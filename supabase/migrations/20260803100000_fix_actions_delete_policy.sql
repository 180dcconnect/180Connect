-- Migration: fix_actions_delete_policy
-- Sequence: fix-forward on step 19.0 (create_actions). That migration is already applied
--   to staging, so it is not edited (MIGRATIONS.md: never edit an applied migration).
-- Story: F257 Reassign CAM When Offboarded — closes a hole in its own guarantee.
-- Spec: docs/rls-permission-matrix.md §3.11
--
-- THE BUG:
--   actions_delete_own_open tested `created_by_user_id = auth.uid()` alone. Authorship
--   is permanent and reassignment does not touch it, so raising an action granted a
--   standing right to delete it — surviving the handover that moved the work to someone
--   else. A CAM who moved teams (still active, so app.is_active_user() does not stop
--   them) could delete open work now assigned to the CAM who took over, on a client they
--   no longer own. A DELETE blocked by USING removes zero rows and raises nothing, so it
--   would have failed silently and looked like the work had never existed.
--
--   That is the exact loss F257 exists to prevent, reachable through F257's own table.
--   Verified against the local stack before and after this migration.
--
-- THE FIX:
--   Require the deleter to still hold the work as well as have raised it. The intended
--   case is unchanged — a CAM removing something they raised for themselves and have not
--   started — because there the two are the same person. Once an action is assigned to
--   anyone else it is their queue, and only an admin may remove it.
--
--   UPDATE needed no change: actions_update_assignee already keys on assignee_user_id,
--   so editing correctly stopped at the handover. DELETE was the only verb keyed on
--   authorship.
--
-- Schema change approval record (SOP §7):
--   Change        | Replace policy actions_delete_own_open with an assignee check added
--   Reason        | Authorship-only DELETE let a former owner destroy reassigned work.
--   Compatibility | Narrows an existing permission. No table, column or data change.
--                 | Nothing in the app calls DELETE on actions yet, so no caller breaks.
--   Data migration| None.
--   Security      | Strictly more restrictive. Admin DELETE is untouched.
--   Documentation | Matrix §3.11 updated. No Data Model change — no schema object added.
--                 | Approved by Bashir (Project Leader), 3 Aug 2026.
--
-- Reversibility: paired rollback in ../rollback/20260803100000_fix_actions_delete_policy.down.sql
--   (restores the original policy — see the warning in that file).

drop policy if exists actions_delete_own_open on public.actions;

create policy actions_delete_own_open on public.actions
  for delete to authenticated
  using (app.is_active_user()
         and app.is_cam()
         -- Raised it AND still holds it. Either alone is not enough: authorship without
         -- assignment is the hole this closes, and assignment without authorship would
         -- let an incoming CAM delete the handover context they were given.
         and coalesce(created_by_user_id = auth.uid(), false)
         and coalesce(assignee_user_id = auth.uid(), false)
         and status = 'open');
