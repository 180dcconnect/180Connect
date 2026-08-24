-- Migration: create_decide_edit_suggestion_rpc
-- Story: F078 Approve Client Edit (#80) + F079 Reject Client Edit (#81)
-- Spec: docs/rls-permission-matrix.md §3.2 (the decide half of F077's flow)
--
-- ONE RPC, TWO DECISIONS: approve and reject are the two branches of a single admin
--   decision, so they ship as one function — p_approve chooses the branch — exactly
--   like decide_ownership_request(p_request_id, p_approve, p_note) and
--   decide_suppression_request before it. Splitting them would mean an RPC shipped
--   half-built or two migrations fighting over one function body.
--
-- APPROVE APPLIES THE VALUE; REJECT TOUCHES NOTHING: approval is what makes a
--   suggestion real (F078 AC2) — the proposed value is written back onto
--   organisations through the same explicit case-per-column UPDATE pattern
--   resolve_field_discrepancy uses (20260815090000): no dynamic SQL built from a
--   field name, scoped to the six allowlisted columns. Rejection changes nothing on
--   the client (F079 AC1); it only settles the row and records the optional reason.
--
-- STALE-SNAPSHOT GUARD: between submission and decision an admin can still edit
--   these columns directly through the §3.2 policy, so the live value may have
--   drifted from current_value. Approval compares the two and REFUSES on drift
--   ('55000') rather than silently overwriting whatever is now on record with a
--   proposal made against different data — the same never-clobber philosophy as
--   field discrepancies. The admin re-reads the client and re-decides; if they still
--   want the change, rejecting and asking for a fresh suggestion is the honest path.
--   A drifted REJECT is fine — nothing was going to be written.
--
-- AUDIT: both branches write one audit_log row in the same transaction
--   (docs/audit-log-pattern.md checklist): 'edit_suggestion_approved' /
--   'edit_suggestion_rejected', detail carrying field/from/to/reason so "what did a
--   human actually decide" stays answerable from the trail alone. This is the write
--   F077's submission deliberately did not make.
--
-- WHO DECIDES: active admins only (app.is_admin()), self-checked in the body — a CAM
--   cannot wave their own suggestion through, and the deciding admin may be anyone
--   with the role, including one who never saw the queue page.
--
-- NO SCHEMA CHANGE: EDIT_SUGGESTIONS already carries decided_by/decided_at/
--   rejection_reason and a decision-consistent CHECK that anticipates exactly these
--   states. Tab 11 gains a step-24.2 row for this RPC-only migration; tabs 02/04 are
--   already correct (they were written forward-looking when F077 landed).
--
-- Schema change approval record (SOP §7):
--   Change        | New SECURITY DEFINER RPC decide_edit_suggestion(uuid, boolean, text).
--                 | No new tables, no column changes, no grant or policy changes.
--   Reason        | F078/F079 — admins need to settle pending edit suggestions:
--                 | approval applies the value, rejection records why it was not.
--   Compatibility | organisations writes go through the same six-column case UPDATE
--                 | shape resolve_field_discrepancy has used since F048; its
--                 | updated_at trigger fires as normal. Nothing existing is widened.
--   Data migration| None.
--   Security      | EXECUTE revoked from public/anon, granted to authenticated; the
--                 | body self-checks app.is_admin(), locks the row FOR UPDATE, and
--                 | refuses non-pending rows. RLS on edit_suggestions is untouched.
--   Documentation | Data Model tab 11 step 24.2 row (RPC only, no table). Tabs 02/04
--                 | unchanged — their decide_edit_suggestion references were written
--                 | when F077's dictionary rows landed.
--
-- NOTE — RE-DATED 22 Aug 2026 (#454): this file shipped as 20260822150000 in #451,
--   colliding with add_grant_preference_to_outreach_preferences (#400) at the same
--   timestamp. The second insert into supabase_migrations violated the version
--   primary key, breaking `supabase db reset` / `start` for everyone once both were
--   on dev. Moved to 20260822150500; anyone who applied the old name locally needs
--   one `supabase db reset` after pulling.
--
-- Reversibility: paired rollback in ../rollback/20260822150500_create_decide_edit_suggestion_rpc.down.sql

create or replace function public.decide_edit_suggestion(
  p_suggestion_id uuid,
  p_approve       boolean,
  p_reason        text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor       uuid := (select auth.uid());
  v_suggestion  public.edit_suggestions%rowtype;
  v_live_value  text;
  v_reason      text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if not app.is_active_user() then
    raise exception 'your account is not active'
      using errcode = '42501';
  end if;

  if not app.is_admin() then
    raise exception 'only an admin may decide a suggested edit'
      using errcode = '42501';
  end if;

  select * into v_suggestion
    from public.edit_suggestions
   where id = p_suggestion_id
     for update;

  if v_suggestion.id is null then
    raise exception 'suggested edit % not found', p_suggestion_id
      using errcode = 'P0002';
  end if;

  if v_suggestion.status <> 'pending' then
    raise exception 'suggested edit % has already been decided', p_suggestion_id
      using errcode = '55000';
  end if;

  -- p_reason is optional by design (F079 AC2 "allows the admin to LEAVE a reason"):
  -- the UI asks for it, this stores whatever was given. Blank strings are normalised
  -- to null so the column never carries whitespace masquerading as a reason.

  if p_approve then
    -- Stale-snapshot guard: read what the column says NOW, inside the same
    -- transaction that will write it.
    select case v_suggestion.field_name
             when 'legal_name'     then legal_name
             when 'website'        then website
             when 'contact_email'  then contact_email
             when 'address_line_1' then address_line_1
             when 'city'           then city
             when 'postcode'       then postcode
           end
      into v_live_value
      from public.organisations
     where id = v_suggestion.organisation_id;

    if v_live_value is distinct from v_suggestion.current_value then
      raise exception 'the live value changed since this was suggested — review the client and decide again'
        using errcode = '55000';
    end if;

    -- Same six-column shape as resolve_field_discrepancy's apply-back: explicit
    -- cases, never dynamic SQL built from a field name.
    update public.organisations set
      legal_name     = case when v_suggestion.field_name = 'legal_name'     then v_suggestion.proposed_value else legal_name end,
      website        = case when v_suggestion.field_name = 'website'        then v_suggestion.proposed_value else website end,
      contact_email  = case when v_suggestion.field_name = 'contact_email'  then v_suggestion.proposed_value else contact_email end,
      address_line_1 = case when v_suggestion.field_name = 'address_line_1' then v_suggestion.proposed_value else address_line_1 end,
      city           = case when v_suggestion.field_name = 'city'           then v_suggestion.proposed_value else city end,
      postcode       = case when v_suggestion.field_name = 'postcode'       then v_suggestion.proposed_value else postcode end
    where id = v_suggestion.organisation_id;
  end if;

  update public.edit_suggestions
     set status           = case when p_approve
                                 then 'approved'::public.edit_suggestion_status
                                 else 'rejected'::public.edit_suggestion_status end,
         decided_by       = v_actor,
         decided_at       = now(),
         rejection_reason = case when p_approve then null else v_reason end,
         updated_at       = now()
   where id = v_suggestion.id;

  insert into public.audit_log (actor_user_id, action, target_table, target_id, detail)
  values (
    v_actor,
    case when p_approve then 'edit_suggestion_approved' else 'edit_suggestion_rejected' end,
    'organisations', v_suggestion.organisation_id,
    jsonb_build_object(
      'suggestion_id', v_suggestion.id,
      'field',         v_suggestion.field_name,
      'from',          v_suggestion.current_value,
      'to',            case when p_approve then v_suggestion.proposed_value else null end,
      'requested_by',  v_suggestion.requested_by,
      'reason',        v_reason
    )
  );
end;
$$;

comment on function public.decide_edit_suggestion(uuid, boolean, text) is
  '#80/#81 (F078/F079): an admin approves or rejects a pending edit suggestion. '
  'Approval applies proposed_value onto organisations (six-column case UPDATE) after '
  'a stale-snapshot guard confirms the live value still matches what was captured at '
  'submission; rejection touches nothing and records the optional reason. Both '
  'branches settle the row and write one audit_log row in the same transaction. '
  'SECURITY DEFINER; self-checks app.is_admin() and refuses non-pending rows.';

revoke execute on function public.decide_edit_suggestion(uuid, boolean, text) from public;
revoke execute on function public.decide_edit_suggestion(uuid, boolean, text) from anon;
grant execute on function public.decide_edit_suggestion(uuid, boolean, text) to authenticated;
