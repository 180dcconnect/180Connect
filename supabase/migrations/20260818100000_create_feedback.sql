-- Migration: create_feedback
-- Story: In-app feedback — internal users rate their experience on a 1–5 scale
--   with an optional comment. Every signed-in role can submit; only admins can
--   read the full list. The prompt re-appears periodically, controlled by
--   users.feedback_snoozed_until.
--
-- WHY NO AUDIT LOG ENTRY:
--   Submitting feedback is not an ownership, status, role, or approval-state
--   change (docs/audit-log-pattern.md §1), so it writes no audit_log row. The
--   feedback table is its own record.
--
-- Reversibility: paired rollback in ../rollback/20260818100000_create_feedback.down.sql

create table public.feedback (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.users (id),
  rating       smallint not null check (rating between 1 and 5),
  comment      text,
  page_context text,
  created_at   timestamptz not null default now()
);

comment on table public.feedback is
  'Internal user experience ratings. Append-only — no UPDATE or DELETE grant.';

-- 1. Revoke before granting (MIGRATIONS.md §RLS skeleton step 1)
revoke all on public.feedback from anon, authenticated;
grant select, insert on public.feedback to authenticated;

-- 2. RLS on
alter table public.feedback enable row level security;

-- 3. Policies to authenticated, built from helpers, gated on is_active
-- Any active user can insert their own feedback
create policy feedback_insert on public.feedback
  for insert to authenticated
  with check (app.is_active_user() and user_id = (select auth.uid()));

-- Admins can read all feedback (the admin feedback page)
create policy feedback_select_admin on public.feedback
  for select to authenticated
  using (app.is_active_user() and app.is_admin());

-- Users can read their own (to check if they've already submitted recently,
-- which suppresses the prompt)
create policy feedback_select_own on public.feedback
  for select to authenticated
  using (app.is_active_user() and user_id = (select auth.uid()));
