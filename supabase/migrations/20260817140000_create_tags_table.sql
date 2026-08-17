-- Schema change approval record (SOP §7):
--   Change        | Add public.tags table (F188).
--   Reason        | CAMs need reusable, shared labels to organise clients
--                 | (organisations). This is the first of the Tags cluster
--                 | (F188-F194) — only the table and create-flow are in scope
--                 | here; the join table linking tags to organisations
--                 | (ORG_TAGS per the Data Model) is F191's (Assign Tag).
--   Compatibility | New table, no FKs from existing tables. Additive only.
--   Data migration| None.
--   Security      | RLS on; SELECT for any active user (tags are shared
--                 | platform-wide per the ticket's AC2); INSERT for any
--                 | active CAM or admin via app.can_write(), matching the
--                 | notes table's write-role pattern. No UPDATE/DELETE grant
--                 | here — those are F189 (Edit Tag) and F190 (Delete Tag).
create table public.tags (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,
  colour              text,
  created_by_user_id  uuid references public.users (id) on delete set null,
  created_at          timestamptz not null default now(),
  constraint tags_name_not_blank check (length(trim(name)) > 0)
);
comment on table public.tags is
  'Reusable, shared labels CAMs and admins apply to organisations (F188). '
  'Platform-wide, not personal to the creator. colour is nullable here — '
  'setting it is F194''s job, not F188''s.';

-- Case-insensitive uniqueness (AC1: "urgent" and "Urgent" must not both exist),
-- without needing the citext extension, which nothing else in this codebase uses.
create unique index tags_name_lower_key on public.tags (lower(name));

grant select on public.tags to authenticated;
grant insert on public.tags to authenticated;

create policy tags_select_active on public.tags
  for select to authenticated using (app.is_active_user());

create policy tags_insert_can_write on public.tags
  for insert to authenticated
  with check (app.is_active_user() and app.can_write() and created_by_user_id = auth.uid());