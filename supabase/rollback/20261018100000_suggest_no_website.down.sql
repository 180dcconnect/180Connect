-- Rollback: suggest_no_website
-- Reverses 20261018100000_suggest_no_website.sql by restoring the decide body from
-- 20260822160200, dropping the CAM's RPC and removing the column and constraints.

drop function if exists public.suggest_website_absent(uuid, text);

-- Rows carrying the flag describe a state the rolled-back schema cannot hold: an
-- ordinary suggestion always has a value, and the restored not-blank check below
-- would refuse them anyway. They go, so the check can be re-added; the audit_log
-- rows for any that were decided stay, because those changes really happened.
delete from public.edit_suggestions where proposed_absent;

alter table public.edit_suggestions
  drop constraint if exists edit_suggestions_absent_is_website;

alter table public.edit_suggestions
  drop constraint edit_suggestions_proposed_not_blank;

alter table public.edit_suggestions
  drop column if exists proposed_absent;

alter table public.edit_suggestions
  add constraint edit_suggestions_proposed_not_blank
    check (btrim(proposed_value) <> '');

-- The 20260822160200 body, verbatim.
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
    select to_jsonb(o) ->> v_suggestion.field_name
      into v_live_value
      from public.organisations o
     where o.id = v_suggestion.organisation_id;

    if v_live_value is distinct from v_suggestion.current_value then
      raise exception 'the live value changed since this was suggested — review the client and decide again'
        using errcode = '55000';
    end if;

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
