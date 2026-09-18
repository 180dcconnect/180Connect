-- Migration: discard_outreach_draft_rpc
-- Sequence: addition (needs public.outreach_messages, public.audit_log,
--   app.is_admin, app.is_active_user). Not a numbered step — RPC migrations are
--   not rows in Data Model tab 11, following set_outreach_status /
--   claim_outreach_send / discard_manual_entry_draft.
-- Story: F120 — Discard Email Draft (#117), PR #493 review follow-up.
--
-- WHY THIS EXISTS: docs/audit-log-pattern.md §1 requires any write that changes
-- status (and a fortiori destroys a row) to record an audit_log entry in the same
-- transaction. A plain DELETE leaves nothing behind — afterwards nobody can
-- answer what happened to that draft or who removed it — and it also takes the
-- draft's ai_generations rows with it via ON DELETE CASCADE. F042 already set the
-- precedent for discards: discard_manual_entry_draft deletes AND writes
-- manual_entry_draft_discarded to AUDIT_LOG in one transaction. This function
-- gives the outreach flow the same treatment.
--
-- WHAT THIS CHANGES:
--   Adds public.discard_outreach_draft(uuid): SECURITY DEFINER. Re-checks the
--   caller inside the body (active user; admin, or the CAM who generated the
--   draft), refuses anything not still in 'draft', writes an
--   outreach_email_draft_discarded row to AUDIT_LOG carrying enough of the draft
--   (organisation, subject, reviewed recipient) to remain answerable after the
--   row is gone, then deletes it. All in one transaction.
--
-- Schema change approval record (SOP §7):
--   Change        | Add function public.discard_outreach_draft(uuid) returns void.
--               | No table/column changes — the DELETE itself uses the
--               | outreach_messages_delete_* policies approved at table creation
--               | (20260804190000_create_outreach.sql); those stay enabled as
--               | defense-in-depth for direct SQL, while the app path goes
--               | through this RPC so every discard is audited.
--   Compatibility | New function, no existing callers affected. The server action
--               | switches from a direct delete to this RPC in the same PR.
--   Security      | SECURITY DEFINER with search_path pinned; re-checks active
--               | user + admin/ownership inside the body (RLS does not apply to
--               | definer functions). EXECUTE revoked from public/anon, granted
--               to authenticated — mirroring mark_outreach_sent.
--   Documentation | No Data Model change (no table/column change); audit action
--               documented here and exercised in supabase/tests/.
--   Approved by   | Bashir (Project Leader), 26 Aug 2026 (PR #493 review).
--
-- Reversibility: paired rollback in ../rollback/20260902130000_discard_outreach_draft_rpc.down.sql

create function public.discard_outreach_draft(p_message_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_draft public.outreach_messages%rowtype;
begin
  if not app.is_active_user() then
    raise exception 'your account is not active'
      using errcode = '42501';
  end if;

  select * into v_draft
    from public.outreach_messages
   where id = p_message_id
   for update;

  -- Same authorisation rule as the outreach_messages_delete_* policies (matrix
  -- §3.4): admins may discard any unsent draft, a CAM only one they generated
  -- themselves. A missing id, or a raced send that flipped the status between
  -- the app's load check and here, refuses rather than silently matching zero
  -- rows — the caller sees an error, never fake success.
  if v_draft.id is null
     or v_draft.send_status <> 'draft'
     or (not app.is_admin() and v_draft.sent_by_user_id is distinct from v_actor) then
    raise exception 'this draft is not available to discard'
      using errcode = '42501';
  end if;

  -- Audit first, delete second, same transaction: if the delete fails the audit
  -- row rolls back too, so the log can never claim a discard that did not
  -- happen. The detail keeps the facts worth keeping once the row (and its
  -- ai_generations cascade) is gone.
  insert into public.audit_log (actor_user_id, action, target_table, target_id, detail)
  values (
    v_actor, 'outreach_email_draft_discarded', 'outreach_messages', p_message_id,
    jsonb_build_object(
      'organisation_id', v_draft.organisation_id,
      'subject', v_draft.subject,
      'sent_to_email', v_draft.sent_to_email
    )
  );

  delete from public.outreach_messages where id = p_message_id;
end;
$$;

comment on function public.discard_outreach_draft(uuid) is
  'F120: deletes an unsent outreach draft and records outreach_email_draft_discarded '
  'in AUDIT_LOG in the same transaction (docs/audit-log-pattern.md). Admins may '
  'discard any draft; a CAM only drafts they generated. Refuses anything not still '
  'in send_status=''draft''.';

revoke execute on function public.discard_outreach_draft(uuid) from public;
revoke execute on function public.discard_outreach_draft(uuid) from anon;
grant execute on function public.discard_outreach_draft(uuid) to authenticated;
