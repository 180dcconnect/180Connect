-- Rollback for 20261003130200_hide_tag_placeholder_from_team.sql
--
-- Restores the placeholder to its pre-fix state (active, visible). Run only to
-- back out the fix; the row is a known-fake account either way, so this
-- resurrects the team-list oddity by design.

update public.users
   set is_active = true,
       deleted_at = null
 where id = '00000000-0000-0000-0000-000000000001'
   and email = 'deleted-user@180dc.org';
