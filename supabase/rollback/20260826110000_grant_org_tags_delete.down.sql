-- Reverses 20260816093009_grant_org_tags_delete.sql.
revoke delete on public.org_tags from authenticated;
drop policy if exists org_tags_delete_can_write on public.org_tags;
