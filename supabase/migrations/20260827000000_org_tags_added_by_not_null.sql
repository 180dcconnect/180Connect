-- Schema change approval record (SOP §7):
--   Change        | Make public.org_tags.added_by_user_id NOT NULL, matching
--                 | the Data Model exactly (04-entities.md: Nullable = No),
--                 | and route a deleted user's tag assignments to the same
--                 | fixed placeholder account F188's follow-up created for
--                 | public.tags.created_by_user_id.
--   Reason        | Reviewer flagged on F192 that the inherited F191
--                 | migration made the column nullable with ON DELETE SET
--                 | NULL, contradicting the Data Model. The established
--                 | pattern (20260821120100_create_deleted_user_placeholder_
--                 | for_tags.sql) is reassignment to the placeholder user,
--                 | which keeps NOT NULL satisfiable without blocking user
--                 | deletion or destroying assignments other CAMs rely on.
--   Compatibility | Alters org_tags.added_by_user_id from nullable to NOT
--                 | NULL and swaps its FK from ON DELETE SET NULL to the
--                 | default NO ACTION, matching tags.created_by_user_id.
--                 | The delete-reassignment trigger below guarantees no row
--                 | still references the departing user when the FK fires.
--   Data migration| Backfills any existing null added_by_user_id rows to
--                 | the fixed placeholder id before the constraint lands.
--                 | New rows can never be null: org_tags' INSERT policy
--                 | already requires added_by_user_id = auth.uid().
--   Security      | Reuses the existing inactive 'viewer' placeholder
--                 | account (cannot log in, fails every app.* permission
--                 | check) — no new privileged principal is introduced.

-- Any legacy rows written before this policy existed get the placeholder.
update public.org_tags
  set added_by_user_id = '00000000-0000-0000-0000-000000000001'
  where added_by_user_id is null;

-- Extend the existing before-delete reassignment to also move tag
-- assignments, so the FK swap below never fires against a live reference.
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
    update public.org_tags
      set added_by_user_id = '00000000-0000-0000-0000-000000000001'
      where added_by_user_id = old.id;
  end if;
  return old;
end;
$$;
comment on function app.reassign_tags_on_user_delete() is
  'Before a users row is deleted, moves any tags they created and any tag '
  'assignments they made to the fixed placeholder account (F188/F192 '
  'follow-ups), so both created_by_user_id and added_by_user_id can stay '
  'NOT NULL without deleting data other CAMs still rely on.';

alter table public.org_tags
  alter column added_by_user_id set not null;

-- As with tags.created_by_user_id: ON DELETE SET NULL fires after the
-- trigger above and would undo the reassignment, then collide with NOT
-- NULL. A plain FK is safe because by constraint-check time the trigger has
-- already moved every assignment to the placeholder.
alter table public.org_tags drop constraint org_tags_added_by_user_id_fkey;
alter table public.org_tags
  add constraint org_tags_added_by_user_id_fkey
  foreign key (added_by_user_id) references public.users (id);
