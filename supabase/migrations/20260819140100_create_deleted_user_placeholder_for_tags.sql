-- Schema change approval record (SOP §7):
--   Change        | Make public.tags.created_by_user_id NOT NULL, matching
--                 | the Data Model exactly (fixes the deviation flagged in
--                 | code review on F188's PR). Adds a fixed placeholder user
--                 | that a deleted account's tags are reassigned to, so the
--                 | column can be truly required without either blocking
--                 | user deletion or deleting a departed CAM's tags along
--                 | with their account.
--   Reason        | Reviewer flagged that created_by_user_id was nullable,
--                 | contradicting the Data Model's Nullable = No. Rather
--                 | than leave the deviation, or delete tags when their
--                 | creator's account is deleted (which would remove labels
--                 | other CAMs are actively using), reassignment to a fixed
--                 | placeholder satisfies NOT NULL while keeping tags intact.
--   Compatibility | Additive to auth.users/public.users (one new row each).
--                 | Alters public.tags.created_by_user_id from nullable to
--                 | NOT NULL — safe on a fresh/empty table; would need a
--                 | backfill step first on a table with existing null rows.
--   Data migration| None needed today (tags table has no rows with a null
--                 | created_by_user_id yet). If this ever runs against a
--                 | database with real data, backfill nulls to the
--                 | placeholder id before the NOT NULL constraint is added.
--   Security      | The placeholder account has role 'viewer' (least
--                 | privilege) and is_active = false, so it can never log in
--                 | or be treated as a real actor by any permission check —
--                 | it exists purely to satisfy the foreign key.

-- A fixed, well-known id so the placeholder can be referenced by the
-- trigger below without a lookup.
insert into auth.users (id, aud, role, email, email_confirmed_at, created_at, updated_at)
values (
  '00000000-0000-0000-0000-000000000001',
  'authenticated',
  'authenticated',
  'deleted-user@180dc.org',
  now(),
  now(),
  now()
)
on conflict (id) do nothing;

insert into public.users (id, email, full_name, role, is_active)
values (
  '00000000-0000-0000-0000-000000000001',
  'deleted-user@180dc.org',
  'Deleted user',
  'viewer',
  false
)
on conflict (id) do nothing;

-- Reassign a departed user's tags to the placeholder before their row is
-- actually removed, so the NOT NULL constraint below never blocks a
-- deletion and no tag is ever orphaned.
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
comment on function app.reassign_tags_on_user_delete() is
  'Before a users row is deleted, moves any tags they created to the fixed '
  'placeholder account (F188 follow-up), so created_by_user_id can stay '
  'NOT NULL without deleting tags other CAMs still rely on.';

create trigger reassign_tags_before_user_delete
  before delete on public.users
  for each row
  execute function app.reassign_tags_on_user_delete();

-- Now safe to require a value — the trigger above guarantees a departed
-- user's tags are moved to the placeholder before their row can be deleted.
alter table public.tags
  alter column created_by_user_id set not null;

-- The original FK (from create_tags_table.sql) has ON DELETE SET NULL,
-- which fires on the same delete event as the trigger above and wins last
-- — undoing the reassignment and setting the column back to null, which
-- the new NOT NULL constraint then rejects entirely. Replaced with a plain
-- FK (default ON DELETE NO ACTION): safe, because by the time Postgres
-- checks this constraint, the trigger above has already moved the tag to
-- the placeholder, so no tag ever actually references the row being
-- deleted.
alter table public.tags drop constraint tags_created_by_user_id_fkey;
alter table public.tags
  add constraint tags_created_by_user_id_fkey
  foreign key (created_by_user_id) references public.users (id);
