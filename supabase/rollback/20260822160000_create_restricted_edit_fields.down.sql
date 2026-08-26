-- Rollback: create_restricted_edit_fields
-- Reverses 20260822160000_create_restricted_edit_fields.sql (F020, #23).
--
-- Order matters: the FK on edit_suggestions.field_name must go before the table it
-- targets. suggest_organisation_edit is restored to its 20260822140000 body — the
-- inline six-field allowlist and the case-per-column snapshot.

create or replace function public.suggest_organisation_edit(
  p_organisation_id uuid,
  p_field_name      text,
  p_new_value       text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor     uuid := (select auth.uid());
  v_field     text := btrim(coalesce(p_field_name, ''));
  v_new_value text := coalesce(p_new_value, '');
  v_exists    boolean;
  v_current   text;
  v_pending   public.edit_suggestions%rowtype;
  v_id        uuid;
begin
  if not app.is_active_user() then
    raise exception 'your account is not active'
      using errcode = '42501';
  end if;

  if not app.is_cam() then
    raise exception 'only a CAM can suggest an edit'
      using errcode = '42501';
  end if;

  if v_field not in ('legal_name', 'website', 'contact_email',
                     'address_line_1', 'city', 'postcode') then
    raise exception 'this field does not accept suggested edits'
      using errcode = '23514';
  end if;

  if btrim(v_new_value) = '' then
    raise exception 'enter the corrected value — suggestions cannot clear a field'
      using errcode = '23514';
  end if;

  select exists (select 1 from public.organisations where id = p_organisation_id)
    into v_exists;

  if not v_exists then
    raise exception 'client % not found', p_organisation_id
      using errcode = 'P0002';
  end if;

  select case v_field
           when 'legal_name'    then legal_name
           when 'website'       then website
           when 'contact_email' then contact_email
           when 'address_line_1' then address_line_1
           when 'city'          then city
           when 'postcode'      then postcode
         end
    into v_current
    from public.organisations
   where id = p_organisation_id;

  if btrim(v_new_value) = btrim(coalesce(v_current, '')) then
    raise exception 'that is already the value on record'
      using errcode = '55000';
  end if;

  select * into v_pending
    from public.edit_suggestions
   where organisation_id = p_organisation_id
     and field_name = v_field
     and status = 'pending';

  if v_pending.id is not null then
    if v_pending.requested_by <> v_actor then
      raise exception 'another team member already has a pending suggestion for this field'
        using errcode = '23505';
    end if;
    update public.edit_suggestions
       set status = 'superseded',
           updated_at = now()
     where id = v_pending.id;
  end if;

  insert into public.edit_suggestions
    (organisation_id, field_name, current_value, proposed_value, requested_by)
  values
    (p_organisation_id, v_field, v_current, btrim(v_new_value), v_actor)
  returning id into v_id;

  if v_pending.id is not null then
    update public.edit_suggestions
       set superseded_by = v_id
     where id = v_pending.id;
  end if;

  return v_id;
end;
$$;

alter table public.edit_suggestions
  drop constraint if exists edit_suggestions_field_name_fkey;

alter table public.edit_suggestions
  add constraint edit_suggestions_field_name_check
  check (field_name in
    ('legal_name', 'website', 'contact_email',
     'address_line_1', 'city', 'postcode'));

drop function if exists public.deactivate_restricted_edit_field(text);
drop function if exists public.add_restricted_edit_field(text, text);

drop table if exists public.restricted_edit_fields;
