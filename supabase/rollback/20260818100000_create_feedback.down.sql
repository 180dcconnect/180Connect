-- Rollback: 20260818100000_create_feedback
drop policy if exists feedback_select_own on public.feedback;
drop policy if exists feedback_select_admin on public.feedback;
drop policy if exists feedback_insert on public.feedback;
drop table if exists public.feedback;
