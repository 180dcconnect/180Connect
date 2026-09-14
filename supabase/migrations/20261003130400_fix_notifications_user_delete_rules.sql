-- Cancelling a pending invite deletes the auth user (cancelInvite ->
-- adminClient.auth.admin.deleteUser), which cascades to public.users.
-- notifications.recipient_user_id / actor_user_id had no delete rule
-- (NO ACTION), so any user with a notification row could not be deleted:
-- the FK violation surfaced as an empty-bodied GoTrue error ("Could not
-- cancel the invite. Try again.").
--
-- recipient_user_id -> CASCADE: a notification has no meaning without its
-- recipient, so it goes with them (same shape as audit_log/actor tables
-- elsewhere in this schema for a "belongs to" relationship).
-- actor_user_id -> SET NULL: matches audit_log.actor_user_id -- the
-- notification survives, the actor becomes unknown.

alter table public.notifications
  drop constraint notifications_recipient_user_id_fkey,
  add constraint notifications_recipient_user_id_fkey
    foreign key (recipient_user_id) references public.users (id) on delete cascade;

alter table public.notifications
  drop constraint notifications_actor_user_id_fkey,
  add constraint notifications_actor_user_id_fkey
    foreign key (actor_user_id) references public.users (id) on delete set null;
