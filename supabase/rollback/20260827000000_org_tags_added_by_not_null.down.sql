-- Reverse of 20260827000000_org_tags_added_by_not_null.sql: restore the
-- nullable column, the ON DELETE SET NULL foreign key, and the trigger
-- body that only reassigned tags.created_by_user_id. Backfilled rows stay
-- pointed at the placeholder — a rollback cannot know which real user (if
-- any) each assignment originally belonged to.

alter table public.org_tags drop constraint org_tags_added_by_user_id_fkey;
alter table public.org_tags
  add constraint org_tags_added_by_user_id_fkey
  foreign key (added_by_user_id) references public.users (id)
  on delete set null;

alter table public.org_tags
  alter column added_by_user_id drop not null;

create or replace function app.reassign_tags_on_user_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.id <> '00000000-0000-0000-0000-000000000001' then
    update public.tags
      set created_by_user_id = '00000000-0000-0000-0000-000000000001'
      where created_by_user_id = old.id;
  end if;
  return old;
end;
$$;
