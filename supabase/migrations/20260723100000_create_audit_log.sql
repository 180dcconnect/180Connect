-- Migration: create_audit_log
-- Sequence: addition to the Data Model migration sequence (not one of the original 17).
--   Placed after create_rls_helpers; needs public.users (actor FK) and app.is_admin.
-- Stories: F224 (#219) — "log entry created"; F221 Audit Logs; unblocks F012 role RPC.
-- Spec: docs/rls-permission-matrix.md §3.8
--
-- Schema change approval record (SOP §7):
--   Change        | Add AUDIT_LOG table (append-only security/audit trail)
--   Reason        | PRD §4.2 requires role changes and deactivations to be audited;
--                 | F221 (Audit Logs) and F224's "log entry created" testing note.
--                 | Distinct from ERROR_LOG (F226), which records application errors.
--   Compatibility | New table. No impact on existing streams. Writers are
--                 | SECURITY DEFINER RPCs and service_role only.
--   Data migration| None.
--   Security      | RLS on; SELECT admin-only; NO insert/update/delete policy —
--                 | append-only by omission. Writes come from SECURITY DEFINER
--                 | functions (which bypass RLS) or service_role.
--   Documentation | Add to Data Model tab 08 (System Analytics) + Data Dictionary.
--                 | Approved by Bashir (Project Leader), 23 Jul 2026.
--
-- Reversibility: paired rollback in ../rollback/20260723100000_create_audit_log.down.sql

create table public.audit_log (
  id              uuid primary key default gen_random_uuid(),
  -- Who performed the action. SET NULL rather than CASCADE: an audit row must
  -- outlive the actor's account, or deleting a user would erase the evidence of
  -- what they did. Null means a system / service-role action with no end user.
  actor_user_id   uuid references public.users (id) on delete set null,
  -- What happened, as a stable machine token: 'role_changed', 'user_deactivated',
  -- 'ownership_assigned', 'outreach_status_overridden', 'permission_denied', ...
  action          text not null,
  -- What it happened to. target_id carries no FK — it may point at any table, and
  -- the row it names may itself be deleted while the audit entry must remain.
  target_table    text,
  target_id       uuid,
  -- Structured context: before/after values, the required reason string, the
  -- blocked statement, etc. Shape depends on `action`.
  detail          jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);

comment on table public.audit_log is
  'Append-only security/audit trail (F221/F224). Rows are written only by '
  'SECURITY DEFINER RPCs or service_role, and are never updated or deleted — there '
  'is deliberately no UPDATE or DELETE policy. Distinct from ERROR_LOG (F226).';
comment on column public.audit_log.actor_user_id is
  'The acting user; null for system/service actions. SET NULL on user delete so the '
  'trail survives.';
comment on column public.audit_log.detail is
  'Action-specific JSON: e.g. {"from":"cam","to":"admin"} for role_changed, or '
  '{"reason":"..."} where a reason is required.';

-- Read patterns: "everything about this record" and "everything this user did".
create index audit_log_target_idx on public.audit_log (target_table, target_id);
create index audit_log_actor_idx on public.audit_log (actor_user_id);
create index audit_log_created_at_idx on public.audit_log (created_at desc);

-- Privileges — revoke first (matrix §2.1). No writes granted to end users at all:
-- every insert comes through a SECURITY DEFINER RPC (which runs as owner and bypasses
-- RLS) or service_role. authenticated gets SELECT, gated to admins by policy.
revoke all on public.audit_log from anon, authenticated;
grant select on public.audit_log to authenticated;

alter table public.audit_log enable row level security;

-- Only admins read the audit log (PRD §4.3 "View team analytics: Admin"; matrix §3.8).
create policy audit_log_select_admin on public.audit_log
  for select to authenticated
  using (app.is_admin());

-- No INSERT / UPDATE / DELETE policy, by design:
--   * INSERT — writers are SECURITY DEFINER RPCs and service_role, both of which
--     bypass RLS. A client can never insert directly.
--   * UPDATE / DELETE — an audit trail an admin can edit is not an audit trail.
--     Their absence denies the operation to every role except service_role.
