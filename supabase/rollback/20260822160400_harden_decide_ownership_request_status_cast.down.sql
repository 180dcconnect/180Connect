-- Rollback: harden_decide_ownership_request_status_cast
-- Restores the #408 body of decide_ownership_request (20260818120000): untyped case
-- assigned into the typed variable.

create or replace function public.decide_ownership_request(
  p_request_id uuid,
  p_approve    boolean,
  p_note       text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor      uuid := (select auth.uid());
  v_request    public.ownership_requests%rowtype;
  v_live_owner uuid;
  v_new_status public.ownership_request_status;
begin
  if not app.is_admin() then
    raise exception 'only an admin may decide an ownership request'
      using errcode = '42501';
  end if;

  select * into v_request
    from public.ownership_requests
   where id = p_request_id
     for update;

  if v_request.id is null then
    raise exception 'ownership request % not found', p_request_id
      using errcode = 'P0002';
  end if;

  if v_request.status <> 'pending' then
    raise exception 'ownership request % has already been decided', p_request_id
      using errcode = '55000';
  end if;

  v_new_status := case when p_approve then 'approved' else 'rejected' end;

  update public.ownership_requests
     set status        = v_new_status,
         decided_by    = v_actor,
         decided_at    = now(),
         decision_note = p_note
   where id = p_request_id;

  if p_approve then
    select owner_id into v_live_owner
      from public.organisations
     where id = v_request.organisation_id;

    if v_live_owner is distinct from v_request.requested_by then
      perform public.reassign_ownership(
        array[v_request.organisation_id],
        v_request.requested_by,
        'Ownership request approved: ' || v_request.reason,
        null
      );
    end if;
  end if;

  insert into public.audit_log (actor_user_id, action, target_table, target_id, detail)
  values (
    v_actor,
    case when p_approve then 'ownership_request_approved' else 'ownership_request_rejected' end,
    'organisations', v_request.organisation_id,
    jsonb_build_object(
      'request_id',   p_request_id,
      'requested_by', v_request.requested_by,
      'note',         p_note
    )
  );
end;
$$;
