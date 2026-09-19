-- Rollback for 20261019100000_expand_onboarding_steps.sql
--
-- Narrows USER_ONBOARDING_STEPS.step_key back to the original 2 keys.
-- Drops any new keys' rows first so the tightened check is satisfied — on a
-- genuine rollback those rows are ephemeral onboarding state (append-only, no
-- other FK), losing them returns viewers and newly-onboarded CAMs to step
-- zero, same caveat as 20260805100000's rollback. Do not run casually against
-- a workspace that has been using the 7-step guide.

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

DELETE FROM public.user_onboarding_steps
WHERE step_key NOT IN ('outreach_preferences', 'review_clients');

ALTER TABLE public.user_onboarding_steps
  ADD CONSTRAINT user_onboarding_steps_step_key_check
  CHECK (step_key IN ('outreach_preferences', 'review_clients'));

COMMENT ON COLUMN public.user_onboarding_steps.step_key IS
  'Which checklist step. outreach_preferences -> F195 settings screen; review_clients -> F057 owner-filtered client list. A third key is added when F100 makes the email-draft step buildable.';
