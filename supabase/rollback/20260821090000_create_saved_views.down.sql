-- Rollback for 20260821090000_create_saved_views.sql
--
-- Drops the F066 saved filter views table. What this discards: every CAM's named
-- filter combinations. On a re-apply each CAM starts with no saved views — an
-- annoyance, not a correctness issue: a view holds no client data, nothing else in
-- the schema references this table, and the filters themselves are still reachable
-- from the /clients filter bar.
--
-- Trigger, index and policies are dropped explicitly ahead of the table so a partial
-- failure cannot leave any of them naming a table on its way out.

drop trigger if exists saved_views_set_updated_at on public.saved_views;

drop index if exists public.saved_views_user_id_created_at_idx;

drop policy if exists saved_views_delete_own on public.saved_views;
drop policy if exists saved_views_update_own on public.saved_views;
drop policy if exists saved_views_insert_own on public.saved_views;
drop policy if exists saved_views_select_own on public.saved_views;

drop table if exists public.saved_views;
