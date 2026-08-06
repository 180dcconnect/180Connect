-- Migration: fix_outreach_admin_suppression_bypass
-- Sequence: fix-forward on step 11 (20260804190000_create_outreach.sql). That
--   migration is already applied to staging, so it is not edited (MIGRATIONS.md:
--   never edit an applied migration).
-- Story: F050 Do-Not-Contact Protection (#52)
-- Spec: docs/rls-permission-matrix.md §3.4
--
-- THE BUG:
--   outreach_messages_insert_admin never called app.can_contact_organisation(). It
--   only checked app.is_active_user() and app.is_admin(). RLS policies for the same
--   command are OR'd together, so an admin's INSERT was allowed by this policy alone
--   regardless of what outreach_messages_insert_cam required — including regardless
--   of suppression.
--
--   This directly contradicted the guarantee 20260806100000_create_suppressions.sql
--   documented for itself: "app.can_contact_organisation() ... is extended here to
--   require NOT app.organisation_is_suppressed(), so a suppressed organisation
--   cannot be emailed by anyone, admin included". That migration only extended the
--   function; it never checked that every INSERT policy actually calls the function.
--   outreach_messages_insert_admin didn't, so the "admin included" half of F251's own
--   AC8 was never true. Caught auditing F050 (#52), not reported against F251.
--
-- THE FIX:
--   Add app.can_contact_organisation(organisation_id) to the admin INSERT policy, same
--   predicate the CAM policy already uses. can_contact_organisation() already returns
--   true for any admin/any-org when not suppressed (see its definition), so this adds
--   exactly one new condition — the suppression check — and narrows nothing else an
--   admin could previously do.
--
-- Schema change approval record (SOP §7):
--   Change        | Replace policy outreach_messages_insert_admin: add
--                 | app.can_contact_organisation(organisation_id) to its WITH CHECK.
--   Reason        | Admin INSERT bypassed suppression entirely; closes F050's core
--                 | guarantee ("send action is blocked ... admin included").
--   Compatibility | Narrows an existing permission (admin can no longer insert for a
--                 | suppressed org). Nothing in the app calls this insert path today
--                 | (no send UI exists yet — F094/F100), so no caller breaks.
--   Data migration| None.
--   Security      | Strictly more restrictive. CAM policy untouched.
--   Documentation | Matrix §3.4 updated in this PR.
--   Approved by   | Bashir (Project Leader), 6 Aug 2026.
--
-- Reversibility: paired rollback in
--   ../rollback/20260806120000_fix_outreach_admin_suppression_bypass.down.sql
--   (restores the original policy — see the warning in that file).

drop policy if exists outreach_messages_insert_admin on public.outreach_messages;

create policy outreach_messages_insert_admin on public.outreach_messages
  for insert to authenticated
  with check (
    app.is_active_user()
    and app.is_admin()
    and app.can_contact_organisation(organisation_id)
  );
