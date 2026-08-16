-- Rollback: create_field_sources
--
-- Restores record_field_discrepancy and resolve_field_discrepancy to their
-- pre-F044 bodies (20260815090000_create_field_discrepancies.sql) before dropping
-- what this migration added, so a rollback doesn't leave F048 calling a function
-- that no longer exists.

create or replace function public.record_field_discrepancy(
  p_organisation_id           uuid,
  p_field_name                 text,
  p_existing_value              text,
  p_existing_source              text,
  p_incoming_value               text,
  p_incoming_source               text,
  p_raw_source_record_id        uuid,
  p_entity_match_candidate_id   uuid default null,
  p_auto_resolved_choice        text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor            uuid := (select auth.uid());
  v_value            text;
  v_existing_open_id uuid;
begin
  if not app.is_admin() then
    raise exception 'only an admin may record a field discrepancy'
      using errcode = '42501';
  end if;

  if p_auto_resolved_choice is not null
     and p_auto_resolved_choice not in ('existing', 'incoming') then
    raise exception 'auto-resolved choice must be ''existing'' or ''incoming'''
      using errcode = '22023';
  end if;

  if exists (
    select 1 from public.field_discrepancies
     where organisation_id = p_organisation_id
       and field_name = p_field_name
       and status = 'resolved'
       and incoming_value = p_incoming_value
  ) then
    return;
  end if;

  if p_auto_resolved_choice is not null then
    v_value := case when p_auto_resolved_choice = 'existing'
                    then p_existing_value else p_incoming_value end;

    update public.organisations set
      legal_name      = case when p_field_name = 'legal_name'      then v_value else legal_name end,
      website          = case when p_field_name = 'website'          then v_value else website end,
      contact_email    = case when p_field_name = 'contact_email'    then v_value else contact_email end,
      address_line_1   = case when p_field_name = 'address_line_1'   then v_value else address_line_1 end,
      city              = case when p_field_name = 'city'              then v_value else city end,
      postcode          = case when p_field_name = 'postcode'          then v_value else postcode end
    where id = p_organisation_id;

    select id into v_existing_open_id
      from public.field_discrepancies
     where organisation_id = p_organisation_id
       and field_name = p_field_name
       and status = 'pending';

    if v_existing_open_id is not null then
      update public.field_discrepancies
         set existing_value = p_existing_value,
             existing_source = p_existing_source,
             incoming_value = p_incoming_value,
             incoming_source = p_incoming_source,
             raw_source_record_id = p_raw_source_record_id,
             entity_match_candidate_id = p_entity_match_candidate_id,
             status = 'resolved',
             resolved_choice = p_auto_resolved_choice,
             resolved_value = v_value,
             resolved_by_user_id = v_actor,
             resolved_at = now(),
             notes = 'Resolved automatically by source priority ('
                     || p_existing_source || ' vs ' || p_incoming_source || ').'
       where id = v_existing_open_id;
    else
      insert into public.field_discrepancies (
        organisation_id, field_name, existing_value, existing_source,
        incoming_value, incoming_source, raw_source_record_id,
        entity_match_candidate_id, status, resolved_choice, resolved_value,
        resolved_by_user_id, resolved_at, notes
      )
      values (
        p_organisation_id, p_field_name, p_existing_value, p_existing_source,
        p_incoming_value, p_incoming_source, p_raw_source_record_id,
        p_entity_match_candidate_id, 'resolved', p_auto_resolved_choice, v_value,
        v_actor, now(),
        'Resolved automatically by source priority ('
          || p_existing_source || ' vs ' || p_incoming_source || ').'
      );
    end if;

    insert into public.audit_log (actor_user_id, action, target_table, target_id, detail)
    values (
      v_actor,
      'field_discrepancy_auto_resolved',
      'organisations', p_organisation_id,
      jsonb_build_object(
        'field_name', p_field_name,
        'choice', p_auto_resolved_choice,
        'value', v_value,
        'existing_source', p_existing_source,
        'incoming_source', p_incoming_source,
        'entity_match_candidate_id', p_entity_match_candidate_id
      )
    );

    return;
  end if;

  insert into public.field_discrepancies (
    organisation_id, field_name, existing_value, existing_source,
    incoming_value, incoming_source, raw_source_record_id, entity_match_candidate_id
  )
  values (
    p_organisation_id, p_field_name, p_existing_value, p_existing_source,
    p_incoming_value, p_incoming_source, p_raw_source_record_id, p_entity_match_candidate_id
  )
  on conflict (organisation_id, field_name) where status = 'pending'
  do update set
    existing_value = excluded.existing_value,
    existing_source = excluded.existing_source,
    incoming_value = excluded.incoming_value,
    incoming_source = excluded.incoming_source,
    raw_source_record_id = excluded.raw_source_record_id,
    entity_match_candidate_id = excluded.entity_match_candidate_id;
end;
$$;

comment on function public.record_field_discrepancy(uuid, text, text, text, text, text, uuid, uuid, text) is
  'F048: flags (or refreshes) an open conflict between an organisation''s current
  field value and an incoming source''s value. SECURITY DEFINER; self-checks
  app.is_admin(); no-ops if this incoming_value was already resolved for this
  organisation+field. With p_auto_resolved_choice null this only flags, and writes
  no audit_log — flagging is not a decision. With it set (source priority settled
  the conflict) it instead writes an already-resolved row, applies the winning
  value onto organisations and writes audit_log
  (field_discrepancy_auto_resolved) in the same transaction — that path IS a
  decision. See migration header.';

revoke execute on function public.record_field_discrepancy(uuid, text, text, text, text, text, uuid, uuid, text) from public;
revoke execute on function public.record_field_discrepancy(uuid, text, text, text, text, text, uuid, uuid, text) from anon;
grant execute on function public.record_field_discrepancy(uuid, text, text, text, text, text, uuid, uuid, text) to authenticated;

create or replace function public.resolve_field_discrepancy(
  p_field_discrepancy_id uuid,
  p_choice                text,
  p_note                   text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor          uuid := (select auth.uid());
  v_org_id         uuid;
  v_field_name     text;
  v_existing_value  text;
  v_incoming_value  text;
  v_status         text;
  v_value          text;
begin
  if not app.is_admin() then
    raise exception 'only an admin may resolve a field discrepancy'
      using errcode = '42501';
  end if;

  if p_choice not in ('existing', 'incoming') then
    raise exception 'choice must be ''existing'' or ''incoming''' using errcode = '22023';
  end if;

  select organisation_id, field_name, existing_value, incoming_value, status
    into v_org_id, v_field_name, v_existing_value, v_incoming_value, v_status
    from public.field_discrepancies
   where id = p_field_discrepancy_id;

  if v_org_id is null then
    raise exception 'field discrepancy % not found', p_field_discrepancy_id
      using errcode = 'P0002';
  end if;

  if v_status <> 'pending' then
    raise exception 'field discrepancy % is not pending', p_field_discrepancy_id
      using errcode = '55000';
  end if;

  v_value := case when p_choice = 'existing' then v_existing_value else v_incoming_value end;

  update public.organisations set
    legal_name      = case when v_field_name = 'legal_name'      then v_value else legal_name end,
    website          = case when v_field_name = 'website'          then v_value else website end,
    contact_email    = case when v_field_name = 'contact_email'    then v_value else contact_email end,
    address_line_1   = case when v_field_name = 'address_line_1'   then v_value else address_line_1 end,
    city              = case when v_field_name = 'city'              then v_value else city end,
    postcode          = case when v_field_name = 'postcode'          then v_value else postcode end
  where id = v_org_id;

  update public.field_discrepancies
     set status = 'resolved',
         resolved_choice = p_choice,
         resolved_value = v_value,
         resolved_by_user_id = v_actor,
         resolved_at = now(),
         notes = p_note
   where id = p_field_discrepancy_id;

  insert into public.audit_log (actor_user_id, action, target_table, target_id, detail)
  values (
    v_actor,
    'field_discrepancy_resolved',
    'organisations', v_org_id,
    jsonb_build_object(
      'field_discrepancy_id', p_field_discrepancy_id,
      'field_name', v_field_name,
      'choice', p_choice,
      'value', v_value,
      'note', p_note
    )
  );
end;
$$;

comment on function public.resolve_field_discrepancy(uuid, text, text) is
  'F048: admin picks which of the two conflicting values to keep. SECURITY DEFINER;
  self-checks app.is_admin(), rejects a missing or already-resolved target, applies
  the chosen value back onto organisations and writes audit_log in the same
  transaction.';

revoke execute on function public.resolve_field_discrepancy(uuid, text, text) from public;
revoke execute on function public.resolve_field_discrepancy(uuid, text, text) from anon;
grant execute on function public.resolve_field_discrepancy(uuid, text, text) to authenticated;

drop function if exists public.get_field_sources(uuid);
drop function if exists public.record_field_source(uuid, text, text, text, uuid);

drop table if exists public.field_sources;
