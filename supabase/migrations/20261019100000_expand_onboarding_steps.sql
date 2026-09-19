-- Migration: expand_onboarding_steps
-- Story: F255 follow-up — Getting started for viewers + 3-step cam/admin track
-- Purpose: expand USER_ONBOARDING_STEPS.step_key to the full working set.
--
-- Before: outreach_preferences, review_clients (2-step CAM-only guide)
-- After:  + my_tasks (open your Tasks, cam/admin 3rd step)
--         + invite_team (conditional 4th for admin when team < 3 active users)
--         + view_clients, view_inbox, view_analytics (viewer/leadership overview track)
--
-- The check constraint was originally an inline `check (step_key in (...))`
-- with the system name user_onboarding_steps_step_key_check. The name is kept
-- so the existing RLS tests keep referencing the same constraint.
--
-- Compatibility: widening only — existing rows keep their two keys, no backfill.
-- guideProgressForRole ignores keys not in the role's current list, so an admin
-- who had completed 2/2 stays 2/3 (or 3/3) after the widening rather than 2/7,
-- and invite_team vanishing when the team grows past 3 shrinks the denominator.
-- No stream, job or dashboard affected.
--
-- Reversibility: paired rollback in ../rollback/20261019100000_expand_onboarding_steps.down.sql
-- Security: no grant/RLS change — table stays own-row SELECT/INSERT, append-only.
-- Documentation: Data Model USER_ONBOARDING_STEPS.step_key allowlist now 7 values.
-- TODO (spreadsheet, not code): add 7-value allowlist to Data Model tab.

-- Drop whatever check currently gates step_key — handles both the original
-- auto-named constraint and any prior expansion that kept the same name.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.user_onboarding_steps'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%step_key%in%''outreach_preferences''%'
  LOOP
    EXECUTE format('ALTER TABLE public.user_onboarding_steps DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

-- Recreate with the full set, keeping the canonical constraint name.
ALTER TABLE public.user_onboarding_steps
  ADD CONSTRAINT user_onboarding_steps_step_key_check
  CHECK (step_key IN (
    'outreach_preferences',
    'review_clients',
    'my_tasks',
    'invite_team',
    'view_clients',
    'view_inbox',
    'view_analytics'
  ));

COMMENT ON COLUMN public.user_onboarding_steps.step_key IS
  'Which first-run Getting started step. Cam/admin track: outreach_preferences → F195 settings; review_clients → claim clients (F057); my_tasks → /actions queue; invite_team → /admin/users (only when team < 3). Viewer track: view_clients (/clients), view_inbox (/inbox), view_analytics (/admin/analytics).';
