alter table public.notifications
  drop constraint notifications_recipient_user_id_fkey,
  add constraint notifications_recipient_user_id_fkey
    foreign key (recipient_user_id) references public.users (id);

alter table public.notifications
  drop constraint notifications_actor_user_id_fkey,
  add constraint notifications_actor_user_id_fkey
    foreign key (actor_user_id) references public.users (id);
