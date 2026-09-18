-- Migration: widen_audit_log_for_client_timeline
-- Story: F075 — View Communication Timeline / F076 — Timeline Event Types
-- Purpose: let any active authenticated user (not just admin) read the two
--   audit_log action types the client timeline needs — status_changed
--   (set_outreach_status, 20260807100000) and ownership_reassigned
--   (reassign_ownership, 20260804170000) — so F075's AC1/AC4 can render them
--   and AC3's realtime subscription can actually receive them (RLS gates
--   postgres_changes delivery exactly like a SELECT, so the admin-only
--   policy alone would silently drop these events for a CAM/viewer).
--
-- This is a narrow ADDITIONAL policy, not a replacement: audit_log_select_admin
-- (20260723100000_create_audit_log.sql) is untouched, so admin still reads
-- every action type. Every other action (role_changed, user_suspended,
-- invite_*, etc.) stays admin-only — this policy's `using` clause only ever
-- matches the two action tokens named above, scoped to target_table =
-- 'organisations', which is what both RPCs write. Policies for the same
-- command are OR'd together, so this only ever adds visibility, never removes
-- the admin policy's.
--
-- Schema change approval record (SOP §7)
-- | Field          | Entry
-- | Story / PR     | F075 View Communication Timeline
-- | Affected tables| audit_log (new SELECT policy, no column/row change),
-- |                | notes, outreach_messages, reply_events, audit_log (added
-- |                | to supabase_realtime publication)
-- | Migration      | this file
-- | Compatibility  | Additive only — no existing policy or query is changed
-- | Data migration | None
-- | Security       | RLS: see reasoning above. Publication: postgres_changes
-- |                | delivery is still filtered per-subscriber by the SELECT
-- |                | policies already in force on each table, so widening the
-- |                | publication does not itself widen who can read what.
-- | Documentation  | docs/rls-permission-matrix.md updated in the same PR

create policy audit_log_select_client_timeline on public.audit_log
  for select to authenticated
  using (
    app.is_active_user()
    and target_table = 'organisations'
    and action in ('status_changed', 'ownership_reassigned')
  );

-- AC3: live updates without navigating away. RLS above (and the existing
-- policies on the other three tables) still governs what each subscriber
-- actually receives — adding a table to this publication only makes it
-- eligible to be broadcast, it does not bypass row security.
alter publication supabase_realtime add table public.notes;
alter publication supabase_realtime add table public.outreach_messages;
alter publication supabase_realtime add table public.reply_events;
alter publication supabase_realtime add table public.audit_log;
