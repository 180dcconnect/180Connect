-- Rollback for 20260920090000_add_email_notification_types.sql (F179, #175).
--
-- Drops the users.email_notification_types column. Data loss on rollback:
-- every user's stored email-notification preference is lost. No NOTIFICATIONS
-- rows are affected — F179 never adds a notification producer (the in-app
-- half is F174's 20260912170300 trigger, untouched by this migration), and no
-- reply is re-captured or re-notified by reversing it.

alter table public.users drop column if exists email_notification_types;
