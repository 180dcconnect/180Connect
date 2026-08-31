-- Schema change approval record (SOP §7):
--   Change        | Add mark_organisation_responded(p_organisation_id), a
--                 | system-triggered status transition to 'responded',
--                 | separate from the existing manual set_outreach_status.
--   Reason        | F149 AC1: the status must update automatically when a
--                 | reply is detected and linked (F131/F132) — not through
--                 | a CAM manually picking a status. set_outreach_status
--                 | requires an authenticated actor who owns the client or
--                 | is admin; a background reply-detection process has no
--                 | such actor, so it needs its own function rather than
--                 | reusing the manual one.
--   Compatibility | Additive only, a new function. Does not change
--                 | set_outreach_status or the outreach_status enum
--                 | (responded already exists, added by F145's migration).
--   Data migration| None.
--   Security      | security definer, service-role only (granted to
--                 | service_role, not authenticated) — this is meant to be
--                 | called by a backend reply-processing job, not directly
--                 | by a CAM's browser session.
create or replace function public.mark_organisation_responded(
  p_organisation_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current_status public.outreach_status;
begin
  select outreach_status into v_current_status
    from public.organisations
   where id = p_organisation_id
     for update;

  if v_current_status is null then
    raise exception 'that client could not be found'
      using errcode = 'P0002';
  end if;

  -- AC2: never override a manual, final decision — a reply arriving after
  -- a CAM already closed the engagement must not silently reopen it.
  -- Mirrors shouldTransitionToResponded's own rule set
  -- (src/lib/responded-status.ts) at the database layer, so the guarantee
  -- holds even if this function is ever called from somewhere that skips
  -- the application-side check.
  if v_current_status in (
    'converted', 'future_potential', 'soft_no',
    'hard_no', 'no_response', 'loss_due_timing', 'responded'
  ) then
    return false;
  end if;

  update public.organisations
    set outreach_status = 'responded',
        updated_at = now()
    where id = p_organisation_id;

  -- Same audit shape set_outreach_status uses (action: 'status_changed'),
  -- actor_user_id null since this is a system, not a CAM, action — matches
  -- the table's own documented convention ("Null means a system /
  -- service-role action with no end user").
  insert into public.audit_log (actor_user_id, action, target_table, target_id, detail)
  values (
    null,
    'status_changed',
    'organisations',
    p_organisation_id,
    jsonb_build_object('from', v_current_status, 'to', 'responded', 'trigger', 'reply_detected')
  );

  return true;
end;
$$;
comment on function public.mark_organisation_responded(uuid) is
  'F149: system-triggered transition to responded when a reply is detected '
  'and linked. Never overrides a manual/final status (AC2). Service-role '
  'only — not callable directly from an authenticated CAM session.';

grant execute on function public.mark_organisation_responded(uuid) to service_role;
