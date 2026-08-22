-- Migration: create_booklet_generations
-- Story: F082 AC5 / F112 — the exact prompt sent to Gemini and the output it
--   returned are stored for every client booklet generation (audit requirement).
--   One append-only row per generation attempt that produced output.
--
-- WHY A SEPARATE TABLE (not AI_GENERATIONS):
--   AI_GENERATIONS hangs off outreach_messages (outreach_message_id NOT NULL,
--   20260804190000) — a booklet generation has no outreach message, so it
--   structurally cannot be recorded there. This table mirrors its shape and
--   rules without touching the email stack (#436) or client_booklets (#382,
--   which stores only the current saved booklet, not per-attempt history).
--
-- WHY NO AUDIT LOG ENTRY:
--   Generating a booklet is not an ownership, status, role, or approval-state
--   change (docs/audit-log-pattern.md §1). This table IS the audit record —
--   same reasoning as feedback (20260818100000).
--
-- APPEND-ONLY:
--   No UPDATE or DELETE grant to any role, so no policies for them either —
--   immutable by omission, the same mechanism AUDIT_LOG uses (matrix §2 row
--   "Audit entries are immutable").
--
-- Reversibility: paired rollback in ../rollback/20260822090000_create_booklet_generations.down.sql

create table public.booklet_generations (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  generated_by    uuid not null references public.users (id),
  prompt_system   text not null,
  prompt_user     text not null,
  output          text not null,
  model           text not null,
  created_at      timestamptz not null default now()
);

comment on table public.booklet_generations is
  'Audit record of every client booklet generation: the exact system and user '
  'prompt sent to the LLM and the output it returned (F082 AC5 / F112). '
  'Append-only — no UPDATE or DELETE grant exists for any role.';

create index booklet_generations_organisation_idx
  on public.booklet_generations (organisation_id, created_at desc);

-- 1. Revoke before granting (MIGRATIONS.md §RLS skeleton step 1)
revoke all on public.booklet_generations from anon, authenticated;
grant select, insert on public.booklet_generations to authenticated;

-- 2. RLS on
alter table public.booklet_generations enable row level security;

-- 3. Policies to authenticated, built from helpers, gated on is_active.
-- The write path is the booklet route's own client:contact gate expressed as
-- data: app.can_contact_organisation() is the identical predicate, so nobody
-- can insert an audit row for an organisation they could not have generated a
-- booklet for, and generated_by is pinned to the caller.
create policy booklet_generations_insert on public.booklet_generations
  for insert to authenticated
  with check (
    app.is_active_user()
    and app.can_contact_organisation(organisation_id)
    and generated_by = (select auth.uid())
  );

-- Read scope matches who may generate/view booklets (client:contact): admins
-- all rows, CAMs their own clients' plus unowned ones. A viewer fails
-- can_contact_organisation and sees nothing.
create policy booklet_generations_select on public.booklet_generations
  for select to authenticated
  using (
    app.is_active_user()
    and app.can_contact_organisation(organisation_id)
  );
