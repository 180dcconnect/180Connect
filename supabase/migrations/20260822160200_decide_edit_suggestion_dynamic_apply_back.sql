-- Migration: decide_edit_suggestion_dynamic_apply_back
-- Story: F020 Restricted Editing (#23)
-- Spec: docs/rls-permission-matrix.md §3.2
--
-- WHY THIS REWRITE EXISTS: decide_edit_suggestion (20260822150500) applies an
--   approved suggestion through a case-per-column UPDATE over exactly the six
--   signed-off fields — deliberately no dynamic SQL when that list was fixed code.
--   F020 makes the restricted set data (restricted_edit_fields, 20260822160000): an
--   admin can now restrict any text column of organisations. A suggestion against
--   such a field would sail through approval, mark the row approved... and silently
--   write nothing, because no `case` branch matches its column. That silent no-op is
--   worse than either refusing or applying.
--
-- THE APPLY-BACK IS NOW GUARDED DYNAMIC SQL:
--     execute format('update public.organisations set %I = $1 where id = $2', ...)
--   The injection surface the original comment worried about was form input; here
--   the identifier comes from the edit_suggestions row, whose field_name has been
--   FK-validated against restricted_edit_fields since submission, and restricted
--   fields were themselves validated at add time against information_schema as real
--   text columns of organisations. Two guards remain in this body anyway:
--     1. the column must still exist on public.organisations (a later migration may
--        have dropped it while a suggestion sat pending);
--     2. %I quoting means even a pathological value cannot leave identifier space.
--   Everything else — admin-only check, FOR UPDATE lock, pending-only refusal,
--   stale-snapshot guard on approval, rejection touching nothing, one audit_log row
--   per decision in-transaction — is byte-for-byte the F078/F079 contract and keeps
--   its errcodes (42501 / P0002 / 55000).
--
-- ONE DELIBERATE DEVIATION, NOT BYTE-FOR-BYTE: the final UPDATE casts the two
--   literals to public.edit_suggestion_status explicitly. The F078/F079 body wrote
--   `case when p_approve then 'approved' else 'rejected' end` untyped; whether the
--   parser resolves those unknown literals to the enum or to text depends on how
--   the statement gets planned (constant-inlined vs parameterised call), and there
--   is no implicit text->enum cast — so a first execution through some planning
--   paths dies with 42804 "column status is of type edit_suggestion_status but
--   expression is of type text". The full pgTAP suite masks this by warming the
--   plan cache before the reject path runs; a direct API call does not. The casts
--   make typing deterministic everywhere.
--
-- NOTIFICATION (AC3): after the audit insert, both branches notify the submitting CAM
--   through create_notification (F173) — approval ("your correction is live") and
--   rejection (with the admin's reason, when given), linked back to the client
--   profile. The producer skips deactivated recipients and self-notifications
--   itself; a decision always has an actor distinct from the requester, so the row's
--   actor <> recipient CHECK cannot bite.
--
-- Schema change approval record (SOP §7):
--   Change        | Replace body of decide_edit_suggestion(uuid, boolean, text).
--                 | Signature, return type, grants unchanged.
--   Reason        | F020's configurable restricted set needs an apply-back that is
--                 | not hardcoded to the seeded six; #23 AC3 needs the CAM told of
--                 | the outcome.
--   Compatibility | Identical behaviour for all six seeded fields. New behaviour
--                 | only for suggestions against fields restricted after F020.
--   Data migration| None.
--   Security      | Same self-checks as before: app.is_admin(), row lock,
--                 | non-pending refusal. EXECUTE grants untouched (revoked from
--                 | public/anon, granted to authenticated by 20260822150500).
--   Documentation | Tab 11 step 24.5; matrix §3.2 paragraph notes the dynamic path.
--
-- Reversibility: paired rollback in ../rollback/20260822160200_decide_edit_suggestion_dynamic_apply_back.down.sql

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
  -- blank strings are normalised to null so the column never carries whitespace
  -- masquerading as a reason.

  if p_approve then
    -- Stale-snapshot guard: read what the column says NOW, inside the same
    -- transaction that will write it.
    select to_jsonb(o) ->> v_suggestion.field_name
      into v_live_value
      from public.organisations o
     where o.id = v_suggestion.organisation_id;

    if v_live_value is distinct from v_suggestion.current_value then
      raise exception 'the live value changed since this was suggested — review the client and decide again'
        using errcode = '55000';
    end if;

    -- Guarded dynamic apply-back (see header): FK-validated identifier, existence
    -- check, %-quoted identifier, parameterised values. The organisations
    -- updated_at trigger fires as normal.
    if not exists (
      select 1
        from information_schema.columns
       where table_schema = 'public'
         and table_name   = 'organisations'
         and column_name  = v_suggestion.field_name
    ) then
      raise exception 'restricted field % no longer exists on the client record', v_suggestion.field_name
        using errcode = '55000';
    end if;

    execute format(
      'update public.organisations set %I = $1 where id = $2',
      v_suggestion.field_name
    ) using v_suggestion.proposed_value, v_suggestion.organisation_id;
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

  -- AC3: tell the submitting CAM which way it went. create_notification is also
  -- SECURITY DEFINER and self-checking; it silently skips a deactivated recipient.
  perform public.create_notification(
    v_suggestion.requested_by,
    'edit_suggestion_decided',
    case when p_approve
         then 'Your suggested edit was approved'
         else 'Your suggested edit was not applied' end,
    case when p_approve
         then 'The correction to ' || v_suggestion.field_name || ' is now live on the client record.'
         else 'The proposed change to ' || v_suggestion.field_name || ' was reviewed and not applied.'
              || coalesce(' Reason: ' || v_reason, '')
    end,
    '/clients/' || v_suggestion.organisation_id,
    'organisations',
    v_suggestion.organisation_id,
    v_actor
  );
end;
$$;

comment on function public.decide_edit_suggestion(uuid, boolean, text) is
  '#80/#81 (F078/F079), rewritten by F020 (#23): an admin approves or rejects a '
  'pending edit suggestion. Approval re-checks the live value still matches the '
  'submission snapshot, then applies proposed_value through a guarded dynamic '
  'identifier (%I, FK-validated against restricted_edit_fields, existence-checked) '
  'so admin-added restricted fields are applied too. Rejection touches nothing and '
  'records the optional reason. Both branches settle the row, write one audit_log '
  'row in-transaction, and notify the submitting CAM via create_notification (#23 '
  'AC3). SECURITY DEFINER; self-checks app.is_admin().';
