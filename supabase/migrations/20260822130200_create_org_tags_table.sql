-- Schema change approval record (SOP §7):
--   Change        | Add public.org_tags table (F191).
--   Reason        | Join table linking tags (F188) to organisations, so a
--                 | CAM can assign a shared tag to a client. Matches the
--                 | Data Model's ORG_TAGS entity exactly (04-entities.md).
--   Compatibility | New table, no FKs from existing tables. Additive only.
--   Data migration| None.
--   Security      | RLS on; SELECT for any active user (a client's tags are
--                 | visible platform-wide, matching tags themselves being
--                 | shared per F188's AC2); INSERT for any active CAM or
--                 | admin via app.can_write(), same write-role pattern as
--                 | notes and tags. No UPDATE — an assignment either exists
--                 | or doesn't, nothing to edit in place. DELETE is F192's
--                 | job (Remove Tag from Client), not granted here.
create table public.org_tags (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete cascade,
  tag_id            uuid not null references public.tags (id) on delete cascade,
  added_by_user_id  uuid references public.users (id) on delete set null,
  created_at        timestamptz not null default now(),
  constraint org_tags_unique_assignment unique (organisation_id, tag_id)
);
comment on table public.org_tags is
  'Join table linking tags (public.tags) to organisations (F191). Assigning '
  'an already-assigned tag is a no-op per org_tags_unique_assignment, not a '
  'duplicate row.';

create index org_tags_organisation_id_idx on public.org_tags (organisation_id);
create index org_tags_tag_id_idx on public.org_tags (tag_id);

grant select on public.org_tags to authenticated;
grant insert on public.org_tags to authenticated;

create policy org_tags_select_active on public.org_tags
  for select to authenticated using (app.is_active_user());

create policy org_tags_insert_can_write on public.org_tags
  for insert to authenticated
  with check (app.is_active_user() and app.can_write() and added_by_user_id = auth.uid());
