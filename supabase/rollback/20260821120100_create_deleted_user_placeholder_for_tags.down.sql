-- Reverses 20260821120100_create_deleted_user_placeholder_for_tags.sql.
--
-- Fixed per code review: the original version could fail outright (the
-- foreign key blocks deleting a still-referenced user), and never restored
-- the FK's original ON DELETE SET NULL behaviour, silently leaving the
-- schema in a different state than before the migration ran.

-- Any tag still pointing at the placeholder must be freed before the
-- placeholder row can be deleted — otherwise the foreign key correctly
-- refuses the delete below.
alter table public.tags
  alter column created_by_user_id drop not null;
update public.tags
  set created_by_user_id = null
  where created_by_user_id = '00000000-0000-0000-0000-000000000001';

drop trigger if exists reassign_tags_before_user_delete on public.users;
drop function if exists app.reassign_tags_on_user_delete();

-- Restore the exact original FK behaviour (from create_tags_table.sql),
-- not just "some" FK — a plain FK with no action would leave rolling this
-- migration back in a different state than never having run it.
alter table public.tags drop constraint tags_created_by_user_id_fkey;
alter table public.tags
  add constraint tags_created_by_user_id_fkey
  foreign key (created_by_user_id) references public.users (id) on delete set null;

delete from public.users where id = '00000000-0000-0000-0000-000000000001';
delete from auth.users where id = '00000000-0000-0000-0000-000000000001';
