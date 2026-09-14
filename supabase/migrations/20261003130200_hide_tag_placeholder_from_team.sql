-- Schema change approval record (SOP §7):
--   Change        | Hide the F188 tag placeholder account from the team list on
--                 | databases where it is still active. Sets is_active = false and
--                 | deleted_at = now() on the single known-fake row
--                 | (00000000-0000-0000-0000-000000000001).
--   Reason        | 20261002094000 marks the placeholder deleted only when it is
--                 | inactive; staging's copy is active, so it still renders as a
--                 | team member. The row is a foreign-key target for reassigned
--                 | tags, never a person: role 'viewer', no login once inactive.
--   Compatibility | Single-row update on a fixed id. No-op everywhere the
--                 | placeholder is already deleted (fresh installs, and every
--                 | environment 20261002094000 already covered). No schema change,
--                 | so the Data Model tabs are untouched.
--   Data migration| This IS the data fix.
--   Security      | The guard matches id AND the placeholder's documented email, so a
--                 | real account can never be touched. No audit_log row: same
--                 | precedent as 20261002094000's own placeholder update — one
--                 | known-fake row, not an ownership/status change on a person.
--   Documentation | rls-permission-matrix.md §3.1 (deleted_at semantics).
--
-- Reversibility: ../rollback/20261003130200_hide_tag_placeholder_from_team.down.sql

update public.users
   set is_active = false,
       deleted_at = now()
 where id = '00000000-0000-0000-0000-000000000001'
   and email = 'deleted-user@180dc.org'
   and deleted_at is null;
