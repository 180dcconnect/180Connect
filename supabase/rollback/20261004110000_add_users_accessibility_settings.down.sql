-- Rollback for 20261004110000_add_users_accessibility_settings.sql (F205).
--
-- Drops users.accessibility_settings. Data loss on rollback: every user's
-- account-stored accessibility preferences. Each browser's cookies still hold
-- the last settings used there, so nobody's current device changes; only the
-- cross-device sync is lost.

revoke update (accessibility_settings) on public.users from authenticated;

alter table public.users drop column if exists accessibility_settings;
