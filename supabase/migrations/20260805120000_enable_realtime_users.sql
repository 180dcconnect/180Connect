-- F011: View Team Members needs the admin team-list page to reflect role,
-- status, and new-invite changes immediately, without a manual refresh.
-- Supabase only broadcasts row changes for tables added to the
-- `supabase_realtime` publication, so `users` needs to be added explicitly.
-- RLS still applies to what each subscriber receives: the existing
-- `users_select_active` policy (20260722103000_create_users.sql) already
-- allows any active authenticated user to read every row, so this does not
-- widen access beyond what a normal SELECT already permits.
alter publication supabase_realtime add table public.users;
