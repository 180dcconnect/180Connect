-- Rollback: add_user_invite_tracking

drop trigger if exists on_auth_user_confirmed on auth.users;
drop function if exists app.handle_auth_user_confirmed();

-- Restore handle_new_auth_user to its pre-invite-tracking form (create_users, F233).
create or replace function app.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.users (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

alter table public.users
  drop column if exists invited_at,
  drop column if exists invite_accepted_at;
