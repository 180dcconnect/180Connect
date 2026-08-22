-- Rollback: decide_edit_suggestion_dynamic_apply_back
-- Reverses 20260822160200_decide_edit_suggestion_dynamic_apply_back.sql by restoring
-- the F078/F079 body (20260822150000): case-per-column apply-back over the seeded six.

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

  if p_approve then
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
     set status           = case when p_approve then 'approved' else 'rejected' end,
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
