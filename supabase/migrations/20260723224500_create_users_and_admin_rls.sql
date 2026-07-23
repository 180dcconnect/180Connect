-- F016 Admin Role / migration sequence 2.0 (create_users)

create type public.app_role as enum ('cam', 'admin');

create table public."USERS" (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  full_name text,
  role public.app_role not null default 'cam',
  is_active boolean not null default false,
  invited_by_user_id uuid references public."USERS"(id),
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public."USERS" enable row level security;

create or replace function public.current_app_role()
returns public.app_role
language sql
stable
security definer
set search_path = ''
as $$
  select role
  from public."USERS"
  where id = auth.uid() and is_active = true
$$;

revoke all on function public.current_app_role() from public;
grant execute on function public.current_app_role() to authenticated;

create policy "users_read_own_profile"
on public."USERS"
for select
to authenticated
using (id = auth.uid());

create policy "admins_read_all_users"
on public."USERS"
for select
to authenticated
using (public.current_app_role() = 'admin');

create policy "admins_update_users"
on public."USERS"
for update
to authenticated
using (public.current_app_role() = 'admin')
with check (public.current_app_role() = 'admin');

create or replace function public.sync_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public."USERS" (id, email, full_name, is_active)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    coalesce(new.raw_app_meta_data ->> 'account_status', '') = 'approved'
  )
  on conflict (id) do update
  set email = excluded.email,
      full_name = coalesce(public."USERS".full_name, excluded.full_name),
      updated_at = now();
  return new;
end;
$$;

create trigger sync_auth_user_after_change
after insert or update of email, raw_user_meta_data, raw_app_meta_data
on auth.users
for each row execute function public.sync_auth_user();

insert into public."USERS" (id, email, full_name, is_active)
select
  id,
  email,
  coalesce(raw_user_meta_data ->> 'full_name', raw_user_meta_data ->> 'name'),
  coalesce(raw_app_meta_data ->> 'account_status', '') = 'approved'
from auth.users
where email is not null
on conflict (id) do nothing;

comment on table public."USERS" is
  'Authoritative application identity, role, and active status for F016.';
comment on column public."USERS".role is
  'cam receives standard workflow permissions; admin inherits CAM permissions and receives privileged management permissions.';

