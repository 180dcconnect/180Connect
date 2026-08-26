-- Migration: notify_on_gmail_reply
-- Story: F133 Reply Notification.
--
-- Every successfully linked reply enters the approved REPLY_EVENTS table through
-- F131's atomic, deduplicated capture RPC. This AFTER INSERT trigger adds the
-- corresponding realtime in-app notification in that same transaction: one for the
-- active client owner, or one for every active admin when the client is unowned or
-- its recorded owner is inactive. A duplicate Gmail message inserts no reply row,
-- therefore fires no notification trigger.
--
-- No table/column change. NOTIFICATIONS.notification_type is deliberately an open
-- token (20260822090000) and create_notification is its approved producer RPC.
-- Reversibility: ../rollback/20260912170300_notify_on_gmail_reply.down.sql

create function public.notify_on_reply_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_id uuid;
  v_legal_name text;
  v_admin record;
  v_link_path text := '/clients/' || new.organisation_id::text || '#timeline-heading';
  v_notification_body text := left(regexp_replace(btrim(new.reply_body), '\s+', ' ', 'g'), 240);
begin
  select o.legal_name, case when owner.is_active then owner.id else null end
    into v_legal_name, v_owner_id
    from public.organisations o
    left join public.users owner on owner.id = o.owner_id
   where o.id = new.organisation_id;

  if v_owner_id is not null then
    perform public.create_notification(
      v_owner_id, 'client_reply_received', v_legal_name || ' replied',
      v_notification_body, v_link_path, 'reply_events', new.id, null
    );
  else
    for v_admin in
      select id from public.users where role = 'admin' and is_active
    loop
      perform public.create_notification(
        v_admin.id, 'unowned_client_reply_received', v_legal_name || ' replied — no owner',
        v_notification_body, v_link_path, 'reply_events', new.id, null
      );
    end loop;
  end if;

  return new;
end;
$$;

comment on function public.notify_on_reply_event() is
  'F133: notifies the active client owner after a linked reply, or all active '
  'admins when no active owner exists. Runs in the reply insert transaction.';

revoke execute on function public.notify_on_reply_event() from public, anon, authenticated;

create trigger reply_events_notify_recipient
  after insert on public.reply_events
  for each row execute function public.notify_on_reply_event();
