-- Rollback of 20260822090000_create_booklet_generations.sql
drop policy if exists booklet_generations_select on public.booklet_generations;
drop policy if exists booklet_generations_insert on public.booklet_generations;
revoke all on public.booklet_generations from anon, authenticated;
drop table if exists public.booklet_generations;
