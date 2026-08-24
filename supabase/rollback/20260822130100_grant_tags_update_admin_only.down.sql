-- Reverses 20260820112614_grant_tags_update_admin_only.sql.
revoke update on public.tags from authenticated;
drop policy if exists tags_update_admin_only on public.tags;
