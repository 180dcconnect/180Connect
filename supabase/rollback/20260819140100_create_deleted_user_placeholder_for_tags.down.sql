-- Reverses 20260818035030_create_deleted_user_placeholder_for_tags.sql.
alter table public.tags
  alter column created_by_user_id drop not null;
drop trigger if exists reassign_tags_before_user_delete on public.users;
drop function if exists app.reassign_tags_on_user_delete();
delete from public.users where id = '00000000-0000-0000-0000-000000000001';
delete from auth.users where id = '00000000-0000-0000-0000-000000000001';
