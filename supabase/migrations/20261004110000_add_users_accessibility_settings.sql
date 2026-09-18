-- Migration: add_users_accessibility_settings
-- Story: F205 — Accessibility settings.
--
-- WHAT THIS ADDS:
--   users.accessibility_settings — the user's accessibility preferences (text
--   size, contrast, line spacing, motion, link underlines, focus indicator,
--   status colours) as one JSON object.
--
-- WHY: F205 shipped these as browser cookies only, so they did not follow the
--   person — a second device, a cleared browser or a new laptop started from
--   the defaults, which for someone who needs large text or no motion means a
--   broken first page on every new device. Cookies stay (the root layout reads
--   them to paint <html> with no flash); this column is the source they are
--   reconciled from once per session.
--
-- WHY JSONB, NOT ONE COLUMN PER SETTING: the set of settings is presentation,
--   validated and defaulted in src/lib/accessibility.ts (unknown keys ignored,
--   invalid values fall back to the default). Adding a setting should not need
--   a migration. NULL means "never saved" — distinct from "saved the defaults",
--   because a NULL account adopts the browser's existing choices instead of
--   overwriting them.
--
-- SIZE: ~200 bytes per user. Negligible against the 500 MB budget.
--
-- Schema change approval record (SOP §7):
--   Change        | Add users.accessibility_settings (jsonb, nullable, must be
--                 | a JSON object when set).
--   Reason        | F205 — settings follow the account across devices.
--   Compatibility | Additive nullable column; no table, RPC or policy touched.
--   Data migration| None. Existing users are NULL until they next save, or
--                 | until their browser's cookies are pushed up on sign-in.
--   Security      | Same grant shape as notification_frequency (20260828130000)
--                 | and email_notification_types (20260920090000): column-level
--                 | UPDATE to authenticated, row-scoped by the existing
--                 | users_update_self_or_admin policy. SELECT on users is
--                 | already granted (20260722103000). Not ownership, status,
--                 | role or approval state, so no audit log entry.
--   Documentation | Data Model USERS tab needs the new column.
--
-- Reversibility: paired rollback in
-- ../rollback/20261004110000_add_users_accessibility_settings.down.sql

alter table public.users
  add column accessibility_settings jsonb
    constraint users_accessibility_settings_is_object
    check (accessibility_settings is null or jsonb_typeof(accessibility_settings) = 'object');

comment on column public.users.accessibility_settings is
  'F205: accessibility preferences as a JSON object, validated in '
  'src/lib/accessibility.ts. NULL = never saved (the browser''s cookies are '
  'adopted), not "defaults".';

grant update (accessibility_settings) on public.users to authenticated;
