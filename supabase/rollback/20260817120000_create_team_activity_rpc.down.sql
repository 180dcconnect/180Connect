-- Rollback for 20260817120000_create_team_activity_rpc.sql

drop function if exists public.get_recent_team_activity(int);
