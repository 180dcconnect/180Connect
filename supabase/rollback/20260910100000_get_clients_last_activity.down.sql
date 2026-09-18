-- Rollback of 20260910100000_get_clients_last_activity (F160 #155).
drop function if exists public.get_clients_last_activity(uuid[]);
