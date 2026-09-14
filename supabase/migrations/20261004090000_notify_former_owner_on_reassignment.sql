-- Migration: notify_former_owner_on_reassignment
-- Sequence: addition (trigger-only; needs public.organisations, public.users,
--   public.create_notification). Not a numbered step — no schema object is added to
--   Data Model tab 04, same as notify_on_reply_event (20260912170300).
-- Story: inbox ownership banner — an admin changes ownership from a thread they do not
--   own; the CAM who owned it must hear about it rather than discover it later.
-- Spec: docs/rls-permission-matrix.md §3.19 ("Producer: ownership change")
--
-- WHY A TRIGGER ON ORGANISATIONS, NOT A CALL INSIDE reassign_ownership:
--   owner_id moves through several audited doors — reassign_ownership (F163 assign form,
--   F253 bulk assign, F257 offboarding, #408 request approval, and now the inbox banner)
--   and release/claim paths. A notification added to one RPC would silently miss the
--   others. An AFTER UPDATE OF owner_id trigger is the one place every move passes.
--
-- WHO IS TOLD: only the former owner. The new owner either made the move themselves
--   (the inbox banner) or is told by the surface that assigned it. create_notification
--   already skips a deactivated recipient (so F257 offboarding notifies nobody) and a
--   recipient who is also the actor (a CAM releasing their own client).
--
-- NOT AUDITED HERE: the move itself is already audited by whichever RPC made it
--   (docs/audit-log-pattern.md). A notification is a signal about that event, not a
--   state change (matrix §3.19).
--
-- Schema change approval record (SOP §7):
--   Change        | Add notify_on_owner_change() trigger function + AFTER UPDATE OF
--                 | owner_id trigger on public.organisations.
--   Reason        | Former owners get no signal when a client is moved away from them.
--   Compatibility | No table, column or grant change. New notification_type string
--                 | 'client_ownership_changed'; not in anyone's email_notification_types
--                 | default, so in-app only unless a user opts in.
--   Data migration| None.
--   Security      | SECURITY DEFINER, search_path pinned, EXECUTE revoked from every
--                 | interactive role (it only ever runs as a trigger).
--   Documentation | Matrix §3.19 producer note. No Data Model tab change.
--
-- Reversibility: paired rollback in ../rollback/20261004090000_notify_former_owner_on_reassignment.down.sql

create or replace function public.notify_on_owner_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor          uuid := (select auth.uid());
  v_actor_name     text;
  v_new_owner_name text;
  v_body           text;
begin
  -- A claim of an unowned client has nobody to tell.
  if old.owner_id is null or old.owner_id is not distinct from new.owner_id then
    return new;
  end if;

  select coalesce(nullif(btrim(u.full_name), ''), u.email)
    into v_actor_name
    from public.users u
   where u.id = v_actor;

  if new.owner_id is null then
    v_body := 'It was returned to the unowned pool';
  else
    select coalesce(nullif(btrim(u.full_name), ''), u.email)
      into v_new_owner_name
      from public.users u
     where u.id = new.owner_id;
    v_body := 'It is now owned by ' || coalesce(v_new_owner_name, 'another team member');
  end if;

  if v_actor_name is not null and v_actor is distinct from new.owner_id then
    v_body := v_body || ' — changed by ' || v_actor_name;
  end if;

  perform public.create_notification(
    old.owner_id,
    'client_ownership_changed',
    new.legal_name || ' is no longer your client',
    v_body || '.',
    '/clients/' || new.id::text,
    'organisations',
    new.id,
    v_actor
  );

  return new;
end;
$$;

comment on function public.notify_on_owner_change() is
  'Notifies the former owner (in-app) whenever organisations.owner_id moves away from '
  'them, whichever audited RPC moved it. Skips inactive recipients and self-moves via '
  'create_notification.';

revoke execute on function public.notify_on_owner_change() from public, anon, authenticated;

drop trigger if exists organisations_notify_owner_change on public.organisations;
create trigger organisations_notify_owner_change
  after update of owner_id on public.organisations
  for each row
  when (old.owner_id is distinct from new.owner_id)
  execute function public.notify_on_owner_change();
