-- Reverses 20260821120500_grant_tags_delete_admin_only.sql.
revoke delete on public.tags from authenticated;
drop policy if exists tags_delete_admin_only on public.tags;
