-- Reverses 20260923100000_add_reason_to_edit_suggestions.sql.
--
-- Drops the four-argument overload first (the three-arg wrapper depends on it),
-- then restores the three-arg form to the self-contained body it had in
-- 20260822160000_create_restricted_edit_fields.sql, then drops the column.
-- Dropping the column discards any notes already submitted — they exist nowhere
-- else, so this is a real loss, not a no-op.

drop function if exists public.suggest_organisation_edit(uuid, text, text, text);

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

  if not exists (
    select 1
      from public.restricted_edit_fields
     where field_name = v_field
       and active
  ) then
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

  select to_jsonb(o) ->> v_field
    into v_current
    from public.organisations o
   where o.id = p_organisation_id;

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

revoke all on function public.suggest_organisation_edit(uuid, text, text) from public;
grant execute on function public.suggest_organisation_edit(uuid, text, text) to authenticated;

alter table public.edit_suggestions
  drop constraint if exists edit_suggestions_reason_shape;

alter table public.edit_suggestions
  drop column if exists reason;
